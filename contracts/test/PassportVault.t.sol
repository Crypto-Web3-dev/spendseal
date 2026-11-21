// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PassportVault} from "../src/PassportVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

// Minimal cheatcode interface (avoids the forge-std dependency; the test
// harness philosophy matches the product: as few external deps as possible).
interface Vm {
    struct Log { bytes32[] topics; bytes data; address emitter; }
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert() external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool, address) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

/// @notice Malicious token for T17: tries to re-enter depositUSDC from transferFrom.
contract EvilUSDC is MockUSDC {
    PassportVault public vault;
    uint256 public passportId;
    bool public armed = true;

    function arm(PassportVault vault_, uint256 passportId_) external {
        vault = vault_;
        passportId = passportId_;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (armed && address(vault) != address(0)) {
            armed = false;
            try vault.depositUSDC(passportId, amount) {} catch {}
        }
        return super.transferFrom(from, to, amount);
    }
}

contract PassportVaultTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    address owner = address(0x1001);
    address agent = address(0x1002);
    address seller = address(0x1003);
    address attacker = address(0x1004);

    MockUSDC usdc;
    PassportVault vault;
    uint256 pid;
    bytes32 ref1 = bytes32(uint256(0xBEEF));

    uint256 constant SHOT = 50_000;      // 0.05 USDC
    uint256 constant DAILY = 200_000;    // 0.20 USDC
    uint256 constant DEPOSIT = 1_000_000; // 1.00 USDC

    // redeclare for expectEmit matching
    event PaymentRejected(uint256 indexed passportId, address indexed payee, uint256 amount,
                          bytes32 indexed ref, uint8 reasonCode);

    function setUp() public {
        vm.warp(1_800_000_000); // stable day boundary math
        usdc = new MockUSDC();
        vault = new PassportVault(address(usdc));
        vm.prank(owner);
        pid = vault.createPassport(agent, SHOT, DAILY, 0);
        vm.prank(owner);
        vault.addPayee(pid, seller);
        usdc.mint(owner, DEPOSIT);
        vm.prank(owner);
        usdc.approve(address(vault), DEPOSIT);
        vm.prank(owner);
        vault.depositUSDC(pid, DEPOSIT);
    }

    // --- assertion helpers ---
    function assertEq(uint256 a, uint256 b, string memory m) internal pure {
        require(a == b, m);
    }
    function assertEq(bool a, bool b, string memory m) internal pure {
        require(a == b, m);
    }
    function assertTrue(bool a, string memory m) internal pure {
        require(a, m);
    }

    function _pay(uint256 amount) internal {
        vm.prank(agent);
        vault.pay(pid, seller, amount, ref1);
    }

    // T1 happy path: pay exactly one shot; balances and counters move once.
    function test_T01_happyPath() public {
        _pay(SHOT);
        assertEq(usdc.balanceOf(seller), SHOT, "seller paid");
        PassportVault.Passport memory p = vault.getPassport(pid);
        assertEq(p.balance, DEPOSIT - SHOT, "vault balance");
        assertEq(p.spentToday, SHOT, "spentToday");
        assertEq(p.spentTotal, SHOT, "spentTotal");
    }

    // T2 zero ref rejected before anything else.
    function test_T02_zeroRef() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.InvalidRef.selector));
        vault.pay(pid, seller, SHOT, bytes32(0));
    }

    // T3 payee outside whitelist.
    function test_T03_notWhitelisted() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.PayeeNotWhitelisted.selector));
        vault.pay(pid, attacker, SHOT, ref1);
        (bool ok, uint8 code, ) = vault.checkPay(pid, attacker, SHOT);
        assertTrue(!ok && code == 4, "checkPay code 4");
    }

    // T4 amount above single limit.
    function test_T04_overSingle() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.OverSingleLimit.selector));
        vault.pay(pid, seller, SHOT + 1, ref1);
    }

    // T5 daily limit: 4 shots OK, 5th rejected.
    function test_T05_dailyLimit() public {
        for (uint256 i = 0; i < 4; i++) _pay(SHOT);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.OverDailyLimit.selector));
        vault.pay(pid, seller, SHOT, ref1);
    }

    // T6 next UTC day resets the daily allowance (lazy rollover, no keeper).
    function test_T06_crossDayReset() public {
        for (uint256 i = 0; i < 4; i++) _pay(SHOT);
        vm.warp(block.timestamp + 86401);
        _pay(SHOT);
        PassportVault.Passport memory p = vault.getPassport(pid);
        assertEq(p.spentToday, SHOT, "spentToday reset then one shot");
    }

    // T7 tightening the daily limit below spentToday takes effect immediately,
    //    and the allowance recovers next day.
    function test_T07_tightenDaily() public {
        for (uint256 i = 0; i < 3; i++) _pay(SHOT); // spent 150k
        vm.prank(owner);
        vault.updateLimits(pid, SHOT, 100_000);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.OverDailyLimit.selector));
        vault.pay(pid, seller, SHOT, ref1);
        vm.warp(block.timestamp + 86401);
        _pay(SHOT); // works again under the tightened daily cap
    }

    // T8 expired passport rejects.
    function test_T08_expired() public {
        vm.prank(owner);
        uint256 pid2 = vault.createPassport(agent, SHOT, DAILY, uint64(block.timestamp + 100));
        vm.prank(owner);
        vault.addPayee(pid2, seller);
        vm.warp(block.timestamp + 101);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.PassportExpired.selector));
        vault.pay(pid2, seller, SHOT, ref1);
    }

    // T9 revoked: payments stop, owner can still withdraw everything.
    function test_T09_revokeAndWithdraw() public {
        vm.prank(owner);
        vault.revoke(pid);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.PassportIsRevoked.selector));
        vault.pay(pid, seller, SHOT, ref1);
        uint256 before = usdc.balanceOf(owner);
        vm.prank(owner);
        vault.withdraw(pid, DEPOSIT);
        assertEq(usdc.balanceOf(owner) - before, DEPOSIT, "owner recovered all");
    }

    // T10 only the agent may pay.
    function test_T10_notAgent() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.NotAgent.selector));
        vault.pay(pid, seller, SHOT, ref1);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.NotAgent.selector));
        vault.pay(pid, seller, SHOT, ref1);
    }

    // T11 only the owner may manage (the agent gets NO management surface).
    function test_T11_notOwner() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.NotOwner.selector));
        vault.updateLimits(pid, SHOT, DAILY);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.NotOwner.selector));
        vault.addPayee(pid, attacker);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.NotOwner.selector));
        vault.revoke(pid);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.NotOwner.selector));
        vault.withdraw(pid, 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.NotOwner.selector));
        vault.setRejectionLogging(pid, true);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.NotOwner.selector));
        vault.rotateAgent(pid, attacker);
    }

    // T12 tryPay with rejection logging ON: returns (false, 4) and records on-chain.
    function test_T12_tryPayLoggingOn() public {
        vm.prank(owner);
        vault.setRejectionLogging(pid, true);
        vm.expectEmit(true, true, true, true, address(vault));
        emit PaymentRejected(pid, attacker, SHOT, ref1, 4);
        vm.prank(agent);
        (bool ok, uint8 code) = vault.tryPay(pid, attacker, SHOT, ref1);
        assertTrue(!ok && code == 4, "tryPay returns (false,4)");
        assertEq(usdc.balanceOf(attacker), 0, "nothing paid");
    }

    // T13 tryPay with logging OFF: returns (false, 4) and emits NO PaymentRejected.
    function test_T13_tryPayLoggingOff() public {
        vm.recordLogs();
        vm.prank(agent);
        (bool ok, uint8 code) = vault.tryPay(pid, attacker, SHOT, ref1);
        assertTrue(!ok && code == 4, "tryPay returns (false,4)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("PaymentRejected(uint256,address,uint256,bytes32,uint8)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(vault) && logs[i].topics.length > 0) {
                require(logs[i].topics[0] != topic, "PaymentRejected must not be emitted");
            }
        }
    }

    // T14 deposit without approve fails at transferFrom and credits nothing.
    function test_T14_depositNeedsApprove() public {
        address stranger = address(0x1005);
        usdc.mint(stranger, SHOT);
        vm.prank(stranger);
        vm.expectRevert();
        vault.depositUSDC(pid, SHOT);
        PassportVault.Passport memory p = vault.getPassport(pid);
        assertEq(p.balance, DEPOSIT, "balance unchanged");
    }

    // T15 invalid limits rejected at create and at update.
    function test_T15_invalidLimits() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.InvalidLimits.selector));
        vault.createPassport(agent, DAILY + 1, DAILY, 0);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PassportVault.InvalidLimits.selector));
        vault.updateLimits(pid, DAILY + 1, DAILY);
    }

    // T16 read paths: checkPay ok + remainingAllowance = min(single, daily, balance).
    function test_T16_reads() public {
        (bool ok, uint8 code, string memory reason) = vault.checkPay(pid, seller, SHOT);
        assertTrue(ok && code == 0, "checkPay ok");
        assertTrue(keccak256(bytes(reason)) == keccak256("ok"), "reason ok");
        assertEq(vault.remainingAllowance(pid), SHOT, "allowance = singleLimit here");
        _pay(SHOT);
        assertEq(vault.remainingAllowance(pid), SHOT, "allowance still singleLimit-capped");
    }

    // T17 malicious token re-entering depositUSDC cannot double-credit the passport.
    function test_T17_reentrancy() public {
        EvilUSDC evil = new EvilUSDC();
        PassportVault v2 = new PassportVault(address(evil));
        vm.prank(owner);
        uint256 pid2 = v2.createPassport(agent, SHOT, DAILY, 0);
        evil.arm(v2, pid2);
        evil.mint(owner, SHOT);
        vm.prank(owner);
        evil.approve(address(v2), SHOT);
        vm.prank(owner);
        v2.depositUSDC(pid2, SHOT);
        PassportVault.Passport memory p = v2.getPassport(pid2);
        assertEq(p.balance, SHOT, "credited exactly once despite reentry attempt");
    }
}
