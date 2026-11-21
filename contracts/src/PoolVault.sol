// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title PoolVault — SpendSeal's shared budget pool for a TEAM of AI agents.
/// @notice Evolution of PassportVault (single agent) to the case hackathon judges
///         kept asking about: one owner, MANY agents, ONE shared budget.
///         A "passport" here is a pool: shared USDC balance, shared per-payment cap
///         and shared daily cap (UTC). Under the pool hang multiple agent "cards",
///         each with its own daily sub-cap and its own daily spend ledger, so the
///         owner can see exactly which agent spent what. A payment must pass BOTH
///         the pool rules and the card's sub-cap. When a card hits a cap, the agent
///         may file an on-chain approval request instead; the owner approves it in
///         the console and the payment executes as a human-granted exception —
///         still whitelist-bound, still single-cap-bound, still balance-bound, and
///         still accounted against the card and the pool. Kill switch and owner
///         withdrawal semantics are unchanged from PassportVault: revocation stops
///         every card at once and never traps the owner's money.
contract PoolVault {
    struct Passport {
        address owner;
        address agent; // primary card holder (display + legacy checkPay)
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

    struct Card {
        bool listed; // ever added (cardList membership)
        bool active;
        uint256 dailyCap;
        uint256 spentToday;
        uint64 currentDay;
    }

    struct ApprovalRequest {
        address agent;
        address payee;
        uint256 amount;
        bytes32 ref;
        uint8 state; // 0 none, 1 pending, 2 executed, 3 rejected
    }

    IERC20 public immutable usdc;
    uint256 public nextPassportId = 1;
    mapping(uint256 => Passport) public passports;
    mapping(uint256 => mapping(address => bool)) public isPayee;
    mapping(uint256 => mapping(address => Card)) public cards;
    mapping(uint256 => address[]) internal _cardList;
    mapping(uint256 => uint256) public nextRequestId;
    mapping(uint256 => mapping(uint256 => ApprovalRequest)) public requests;

    // --- errors (reason codes shared with checkPay/tryPay/PaymentRejected) ---
    error InvalidRef();
    error PassportNotFound();
    error PassportIsRevoked();
    error PassportExpired();
    error PayeeNotWhitelisted();
    error OverSingleLimit();
    error OverDailyLimit();
    error OverCardLimit();
    error InsufficientBalance();
    error NotAgent();
    error NotOwner();
    error InvalidLimits();
    error InvalidAgent();
    error InvalidCard();
    error RequestNotFound();
    error RequestNotPending();

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
    event CardAdded(uint256 indexed passportId, address indexed agent, uint256 dailyCap);
    event CardRemoved(uint256 indexed passportId, address indexed agent);
    event CardCapUpdated(uint256 indexed passportId, address indexed agent, uint256 dailyCap);
    event ApprovalRequested(uint256 indexed passportId, uint256 indexed requestId, address indexed agent,
                            address payee, uint256 amount, bytes32 ref);
    event ApprovalExecuted(uint256 indexed passportId, uint256 indexed requestId);
    event ApprovalRejected(uint256 indexed passportId, uint256 indexed requestId);

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
        nextRequestId[passportId] = 1;
        emit PassportCreated(passportId, msg.sender, agent, singleLimit, dailyLimit, expiry);
        _addCard(passportId, agent, dailyLimit); // primary agent = first card
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
        p.singleLimit = singleLimit;
        p.dailyLimit = dailyLimit;
        emit LimitsUpdated(passportId, singleLimit, dailyLimit);
    }

    function rotateAgent(uint256 passportId, address newAgent) external {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        if (newAgent == address(0) || newAgent == p.owner) revert InvalidAgent();
        Card storage old = cards[passportId][p.agent];
        uint256 cap = old.active ? old.dailyCap : p.dailyLimit;
        old.active = false;
        p.agent = newAgent;
        emit AgentRotated(passportId, newAgent);
        _addCard(passportId, newAgent, cap);
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

    // ---------- cards (owner) ----------

    function addCard(uint256 passportId, address agent, uint256 dailyCap) external {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        if (agent == address(0) || agent == p.owner) revert InvalidCard();
        _addCard(passportId, agent, dailyCap);
    }

    function removeCard(uint256 passportId, address agent) external {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        Card storage c = cards[passportId][agent];
        if (!c.listed) revert InvalidCard();
        c.active = false;
        emit CardRemoved(passportId, agent);
    }

    function setCardCap(uint256 passportId, address agent, uint256 dailyCap) external {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        Card storage c = cards[passportId][agent];
        if (!c.listed) revert InvalidCard();
        c.dailyCap = dailyCap;
        emit CardCapUpdated(passportId, agent, dailyCap);
    }

    function _addCard(uint256 passportId, address agent, uint256 dailyCap) internal {
        Card storage c = cards[passportId][agent];
        if (!c.listed) {
            c.listed = true;
            c.currentDay = uint64(block.timestamp / 86400);
            _cardList[passportId].push(agent);
        }
        c.active = true;
        c.dailyCap = dailyCap;
        emit CardAdded(passportId, agent, dailyCap);
    }

    function cardCount(uint256 passportId) external view returns (uint256) {
        return _cardList[passportId].length;
    }

    function cardAt(uint256 passportId, uint256 index) external view returns (address) {
        return _cardList[passportId][index];
    }

    function getCard(uint256 passportId, address agent)
        external view returns (bool active, uint256 dailyCap, uint256 spentToday)
    {
        Card storage c = cards[passportId][agent];
        return (c.active, c.dailyCap, _effCardSpent(c));
    }

    // ---------- agent payment paths ----------

    /// @notice Strict payment path: any failed check reverts with the mapped custom error.
    function pay(uint256 passportId, address payee, uint256 amount, bytes32 ref) external nonReentrant {
        if (ref == bytes32(0)) revert InvalidRef();
        Passport storage p = _mustExist(passportId);
        if (!cards[passportId][msg.sender].active) revert NotAgent();
        uint8 code = _validate(p, passportId, msg.sender, payee, amount);
        if (code != 0) _revertFor(code);
        _settle(passportId, p, msg.sender, payee, amount, ref);
    }

    /// @notice Audit payment path: business-rule failures do NOT revert. When the pool
    ///         has logRejections enabled, the rejection is recorded on-chain.
    function tryPay(uint256 passportId, address payee, uint256 amount, bytes32 ref)
        external nonReentrant returns (bool ok, uint8 reasonCode)
    {
        if (ref == bytes32(0)) revert InvalidRef();
        Passport storage p = _mustExist(passportId);
        if (!cards[passportId][msg.sender].active) revert NotAgent();
        uint8 code = _validate(p, passportId, msg.sender, payee, amount);
        if (code != 0) {
            if (p.logRejections) emit PaymentRejected(passportId, payee, amount, ref, code);
            return (false, code);
        }
        _settle(passportId, p, msg.sender, payee, amount, ref);
        return (true, 0);
    }

    // ---------- approval flow: over-cap spending needs a human ----------

    /// @notice A card agent files an over-cap payment request. The request itself is
    ///         bound by the hard rules (whitelist, per-payment cap, live pool) — the
    ///         ONLY things an approval may override are the two daily caps.
    function requestApproval(uint256 passportId, address payee, uint256 amount, bytes32 ref)
        external returns (uint256 requestId)
    {
        if (ref == bytes32(0)) revert InvalidRef();
        Passport storage p = _mustExist(passportId);
        if (!cards[passportId][msg.sender].active) revert NotAgent();
        if (p.revoked) revert PassportIsRevoked();
        if (p.expiry != 0 && block.timestamp > p.expiry) revert PassportExpired();
        if (!isPayee[passportId][payee]) revert PayeeNotWhitelisted();
        if (amount > p.singleLimit) revert OverSingleLimit();
        requestId = nextRequestId[passportId]++;
        ApprovalRequest storage r = requests[passportId][requestId];
        r.agent = msg.sender;
        r.payee = payee;
        r.amount = amount;
        r.ref = ref;
        r.state = 1;
        emit ApprovalRequested(passportId, requestId, msg.sender, payee, amount, ref);
    }

    /// @notice Owner approves: the payment executes immediately, bypassing the pool
    ///         daily cap and the card sub-cap — and ONLY those. Accounting still
    ///         charges both ledgers, so an approved exception is visible as such.
    function approveRequest(uint256 passportId, uint256 requestId) external nonReentrant {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        ApprovalRequest storage r = requests[passportId][requestId];
        if (r.state == 0) revert RequestNotFound();
        if (r.state != 1) revert RequestNotPending();
        if (p.revoked) revert PassportIsRevoked();
        if (p.expiry != 0 && block.timestamp > p.expiry) revert PassportExpired();
        if (!isPayee[passportId][r.payee]) revert PayeeNotWhitelisted();
        if (r.amount > p.balance) revert InsufficientBalance();
        r.state = 2;
        _settle(passportId, p, r.agent, r.payee, r.amount, r.ref);
        emit ApprovalExecuted(passportId, requestId);
    }

    function rejectRequest(uint256 passportId, uint256 requestId) external {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        ApprovalRequest storage r = requests[passportId][requestId];
        if (r.state == 0) revert RequestNotFound();
        if (r.state != 1) revert RequestNotPending();
        r.state = 3;
        emit ApprovalRejected(passportId, requestId);
    }

    function getRequest(uint256 passportId, uint256 requestId)
        external view returns (ApprovalRequest memory)
    {
        return requests[passportId][requestId];
    }

    // ---------- owner escape hatches ----------

    /// @notice Kill switch: stops every card at once, immediately and irreversibly.
    function revoke(uint256 passportId) external {
        Passport storage p = _mustExist(passportId);
        if (msg.sender != p.owner) revert NotOwner();
        p.revoked = true;
        emit PassportRevoked(passportId);
    }

    /// @notice Withdraw USDC back to the owner. Works on revoked pools too.
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

    /// @notice Pool-level remaining allowance for the primary agent (legacy view):
    ///         min(singleLimit, pool daily remaining, primary card remaining, balance).
    function remainingAllowance(uint256 passportId) external view returns (uint256) {
        Passport storage p = passports[passportId];
        if (p.owner == address(0) || p.revoked) return 0;
        if (p.expiry != 0 && block.timestamp > p.expiry) return 0;
        uint256 m = p.dailyLimit - _effSpent(p);
        Card storage c = cards[passportId][p.agent];
        if (!c.active) return 0;
        uint256 cardRem = c.dailyCap - _effCardSpent(c);
        if (cardRem < m) m = cardRem;
        if (p.singleLimit < m) m = p.singleLimit;
        return m < p.balance ? m : p.balance;
    }

    /// @notice Legacy pre-flight (agent = primary card), kept for the MCP bridge.
    function checkPay(uint256 passportId, address payee, uint256 amount)
        external view returns (bool ok, uint8 code, string memory reason)
    {
        Passport storage p = passports[passportId];
        if (p.owner == address(0)) return (false, 1, "passport_not_found");
        code = _validate(p, passportId, p.agent, payee, amount);
        return (code == 0, code, _reason(code));
    }

    function checkPayFor(uint256 passportId, address agent, address payee, uint256 amount)
        external view returns (bool ok, uint8 code, string memory reason)
    {
        Passport storage p = passports[passportId];
        if (p.owner == address(0)) return (false, 1, "passport_not_found");
        if (!cards[passportId][agent].active) return (false, 10, "agent_not_card");
        code = _validate(p, passportId, agent, payee, amount);
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

    function _effCardSpent(Card storage c) internal view returns (uint256) {
        return (uint64(block.timestamp / 86400) == c.currentDay) ? c.spentToday : 0;
    }

    /// @dev Validation order: pool rules keep the PassportVault v1.3 order; the card
    ///      sub-cap check (code 9) runs after the pool daily check so a rejection
    ///      blames the pool when the POOL is what ran dry.
    function _validate(Passport storage p, uint256 passportId, address agent, address payee, uint256 amount)
        internal view returns (uint8)
    {
        if (p.revoked) return 2;
        if (p.expiry != 0 && block.timestamp > p.expiry) return 3;
        if (!isPayee[passportId][payee]) return 4;
        if (amount > p.singleLimit) return 5;
        if (_effSpent(p) + amount > p.dailyLimit) return 6;
        Card storage c = cards[passportId][agent];
        if (_effCardSpent(c) + amount > c.dailyCap) return 9;
        if (amount > p.balance) return 7;
        return 0;
    }

    function _settle(uint256 passportId, Passport storage p, address agent, address payee, uint256 amount, bytes32 ref) internal {
        uint64 today = uint64(block.timestamp / 86400);
        if (today != p.currentDay) {
            p.currentDay = today;
            p.spentToday = 0;
        }
        p.spentToday += amount;
        p.spentTotal += amount;
        p.balance -= amount;
        Card storage c = cards[passportId][agent];
        if (today != c.currentDay) {
            c.currentDay = today;
            c.spentToday = 0;
        }
        c.spentToday += amount;
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
        if (code == 9) revert OverCardLimit();
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
        if (code == 9) return "over_card_limit";
        if (code == 10) return "agent_not_card";
        return "unknown";
    }
}
