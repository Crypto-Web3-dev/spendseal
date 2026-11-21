// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title PassportVault — SpendSeal's single-contract spending guard for AI agents.
/// @notice An owner creates a "passport" for one agent: per-payment cap, daily cap (UTC),
///         payee whitelist, expiry, and an instant kill switch. The passport's USDC balance
///         is held and accounted per-passport inside this vault; the agent address itself
///         holds no USDC, so every agent payment must pass through these checks.
///         Interface frozen per docs: monad-hackathon/plan-a-interface-spec.md v1.3.
contract PassportVault {
    struct Passport {
        address owner;
        address agent;
        uint256 singleLimit;
        uint256 dailyLimit;
        uint256 spentToday;
        uint64 currentDay;
        uint256 spentTotal;
        uint64 expiry;
        bool revoked;
        bool logRejections;
        uint256 balance;
    }

    IERC20 public immutable usdc;
    uint256 public nextPassportId = 1;
    mapping(uint256 => Passport) public passports;
    mapping(uint256 => mapping(address => bool)) public isPayee;

    // --- errors (pay path; reason codes shared with checkPay/tryPay/PaymentRejected) ---
    error InvalidRef();
    error PassportNotFound();
    error PassportIsRevoked();
    error PassportExpired();
    error PayeeNotWhitelisted();
    error OverSingleLimit();
    error OverDailyLimit();
    error InsufficientBalance();
    error NotAgent();
    error NotOwner();
    error InvalidLimits();
    error InvalidAgent();

    // --- events ---
    event PassportCreated(uint256 indexed passportId, address indexed owner, address indexed agent,
                          uint256 singleLimit, uint256 dailyLimit, uint64 expiry);
    event PayeeAdded(uint256 indexed passportId, address payee);
    event PayeeRemoved(uint256 indexed passportId, address payee);
    event LimitsUpdated(uint256 indexed passportId, uint256 singleLimit, uint256 dailyLimit);
    event AgentRotated(uint256 indexed passportId, address newAgent);
    event RejectionLoggingSet(uint256 indexed passportId, bool enabled);
    event Deposited(uint256 indexed passportId, address from, uint256 amount);
    event PaymentExecuted(uint256 indexed passportId, address indexed payee, uint256 amount,
                          bytes32 indexed ref, uint256 spentTodayAfter);
    event PaymentRejected(uint256 indexed passportId, address indexed payee, uint256 amount,
                          bytes32 indexed ref, uint8 reasonCode);
    event PassportRevoked(uint256 indexed passportId);
    event Withdrawn(uint256 indexed passportId, address indexed owner, uint256 amount);

    uint256 private _locked;
    modifier nonReentrant() {
        require(_locked == 0, "reentrant");
        _locked = 1;
        _;
        _locked = 0;
    }

    constructor(address usdc_) {
        require(usdc_ != address(0), "usdc=0");
        usdc = IERC20(usdc_);
    }

    // ---------- owner / setup ----------

    function createPassport(address agent, uint256 singleLimit, uint256 dailyLimit, uint64 expiry)
        external returns (uint256 passportId)
    {
        if (agent == address(0) || agent == msg.sender) revert InvalidAgent();
        if (singleLimit > dailyLimit) revert InvalidLimits();
        passportId = nextPassportId++;
        Passport storage p = passports[passportId];
        p.owner = msg.sender;
        p.agent = agent;
        p.singleLimit = singleLimit;
        p.dailyLimit = dailyLimit;
        p.currentDay = uint64(block.timestamp / 86400);
        p.expiry = expiry;
        emit PassportCreated(passportId, msg.sender, agent, singleLimit, dailyLimit, expiry);
    }

    function addPayee(uint256 passportId, address payee) external {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        if (!isPayee[passportId][payee]) {
            isPayee[passportId][payee] = true;
            emit PayeeAdded(passportId, payee);
        }
    }

    function removePayee(uint256 passportId, address payee) external {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        if (isPayee[passportId][payee]) {
            isPayee[passportId][payee] = false;
            emit PayeeRemoved(passportId, payee);
        }
    }

    function updateLimits(uint256 passportId, uint256 singleLimit, uint256 dailyLimit) external {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        if (singleLimit > dailyLimit) revert InvalidLimits();
        // Tightening dailyLimit below spentToday is allowed on purpose: it takes
        // effect immediately (all further payments today are rejected) and the
        // allowance recovers automatically at the next UTC day rollover.
        p.singleLimit = singleLimit;
        p.dailyLimit = dailyLimit;
        emit LimitsUpdated(passportId, singleLimit, dailyLimit);
    }

    function rotateAgent(uint256 passportId, address newAgent) external {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        if (newAgent == address(0) || newAgent == p.owner) revert InvalidAgent();
        p.agent = newAgent;
        emit AgentRotated(passportId, newAgent);
    }

    function setRejectionLogging(uint256 passportId, bool enabled) external {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        p.logRejections = enabled;
        emit RejectionLoggingSet(passportId, enabled);
    }

    function depositUSDC(uint256 passportId, uint256 amount) external nonReentrant {
        Passport storage p = _mustExist(passportId);
        require(usdc.transferFrom(msg.sender, address(this), amount), "transferFrom");
        p.balance += amount;
        emit Deposited(passportId, msg.sender, amount);
    }

    // ---------- agent payment paths ----------

    /// @notice Strict payment path: any failed check reverts with the mapped custom error.
    function pay(uint256 passportId, address payee, uint256 amount, bytes32 ref) external nonReentrant {
        if (ref == bytes32(0)) revert InvalidRef();
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.agent) revert NotAgent();
        uint8 code = _validate(p, passportId, payee, amount);
        if (code != 0) _revertFor(code);
        _settle(passportId, p, payee, amount, ref);
    }

    /// @notice Audit payment path: business-rule failures do NOT revert. When the passport
    ///         has logRejections enabled, the rejection is recorded on-chain as a
    ///         PaymentRejected event (costs gas — that is why it is opt-in per passport).
    ///         Parameter-level errors (zero ref, unknown passport, wrong caller) still revert.
    function tryPay(uint256 passportId, address payee, uint256 amount, bytes32 ref)
        external nonReentrant returns (bool ok, uint8 reasonCode)
    {
        if (ref == bytes32(0)) revert InvalidRef();
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.agent) revert NotAgent();
        uint8 code = _validate(p, passportId, payee, amount);
        if (code != 0) {
            if (p.logRejections) emit PaymentRejected(passportId, payee, amount, ref, code);
            return (false, code);
        }
        _settle(passportId, p, payee, amount, ref);
        return (true, 0);
    }

    // ---------- owner escape hatches ----------

    /// @notice Kill switch: stops all payments immediately and irreversibly.
    ///         The balance is NOT auto-returned; it stays withdrawable by the owner.
    function revoke(uint256 passportId) external {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        p.revoked = true;
        emit PassportRevoked(passportId);
    }

    /// @notice Withdraw USDC back to the owner. Works on revoked passports too —
    ///         the kill switch stops the agent, it never traps the owner's money.
    function withdraw(uint256 passportId, uint256 amount) external nonReentrant {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        if (amount > p.balance) revert InsufficientBalance();
        p.balance -= amount;
        require(usdc.transfer(msg.sender, amount), "transfer");
        emit Withdrawn(passportId, msg.sender, amount);
    }

    // ---------- reads ----------

    function getPassport(uint256 passportId) external view returns (Passport memory) {
        return passports[passportId];
    }

    /// @notice How much the agent can still pay in one shot right now:
    ///         min(singleLimit, dailyLimit - effectiveSpentToday, balance).
    function remainingAllowance(uint256 passportId) external view returns (uint256) {
        Passport storage p = passports[passportId];
        if (p.owner == address(0) || p.revoked) return 0;
        if (p.expiry != 0 && block.timestamp > p.expiry) return 0;
        uint256 remainingDaily = p.dailyLimit - _effSpent(p);
        uint256 m = p.singleLimit < remainingDaily ? p.singleLimit : remainingDaily;
        return m < p.balance ? m : p.balance;
    }

    /// @notice Pre-flight check used by the MCP bridge before sending any transaction.
    ///         Same checks, same order as pay (minus the ref, which the bridge checks itself).
    function checkPay(uint256 passportId, address payee, uint256 amount)
        external view returns (bool ok, uint8 code, string memory reason)
    {
        Passport storage p = passports[passportId];
        if (p.owner == address(0)) return (false, 1, "passport_not_found");
        code = _validate(p, passportId, payee, amount);
        return (code == 0, code, _reason(code));
    }

    // ---------- internals ----------

    function _mustExist(uint256 passportId) internal view returns (Passport storage p) {
        p = passports[passportId];
        if (p.owner == address(0)) revert PassportNotFound();
    }

    function _effSpent(Passport storage p) internal view returns (uint256) {
        return (uint64(block.timestamp / 86400) == p.currentDay) ? p.spentToday : 0;
    }

    /// @dev Validation order is part of the spec (v1.3 §1.4) — do not reorder.
    ///      code 8 (invalid_ref) is checked by the callers before this, ref is not a parameter here.
    function _validate(Passport storage p, uint256 passportId, address payee, uint256 amount)
        internal view returns (uint8)
    {
        if (p.revoked) return 2;
        if (p.expiry != 0 && block.timestamp > p.expiry) return 3;
        if (!isPayee[passportId][payee]) return 4;
        if (amount > p.singleLimit) return 5;
        if (_effSpent(p) + amount > p.dailyLimit) return 6;
        if (amount > p.balance) return 7;
        return 0;
    }

    function _settle(uint256 passportId, Passport storage p, address payee, uint256 amount, bytes32 ref) internal {
        uint64 today = uint64(block.timestamp / 86400);
        if (today != p.currentDay) {
            p.currentDay = today;
            p.spentToday = 0;
        }
        p.spentToday += amount;
        p.spentTotal += amount;
        p.balance -= amount;
        require(usdc.transfer(payee, amount), "transfer");
        emit PaymentExecuted(passportId, payee, amount, ref, p.spentToday);
    }

    function _revertFor(uint8 code) internal pure {
        if (code == 2) revert PassportIsRevoked();
        if (code == 3) revert PassportExpired();
        if (code == 4) revert PayeeNotWhitelisted();
        if (code == 5) revert OverSingleLimit();
        if (code == 6) revert OverDailyLimit();
        if (code == 7) revert InsufficientBalance();
        revert("unreachable");
    }

    function _reason(uint8 code) internal pure returns (string memory) {
        if (code == 0) return "ok";
        if (code == 1) return "passport_not_found";
        if (code == 2) return "passport_revoked";
        if (code == 3) return "passport_expired";
        if (code == 4) return "payee_not_whitelisted";
        if (code == 5) return "over_single_limit";
        if (code == 6) return "over_daily_limit";
        if (code == 7) return "insufficient_balance";
        if (code == 8) return "invalid_ref";
        return "unknown";
    }
}
