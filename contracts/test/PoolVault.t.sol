// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PoolVault} from "../src/PoolVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

// Minimal cheatcode interface (same no-forge-std philosophy as PassportVault.t.sol).
interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert() external;
}

/// @notice PoolVault tests P1–P10: cards, shared pool accounting, approval flow.
contract PoolVaultTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    address owner = address(0x1001);
    address agentA = address(0x1002);
    address agentB = address(0x1005);
    address seller = address(0x1003);
    address stranger = address(0x1004);
    address rando = address(0x1006); // never whitelisted

    MockUSDC usdc;
    PoolVault vault;
    uint256 pid;
    bytes32 ref1 = bytes32(uint256(0xBEEF));

    uint256 constant SHOT = 50_000;       // 0.05 USDC (pool per-payment cap)
    uint256 constant DAILY = 200_000;     // 0.20 USDC (pool daily cap)
    uint256 constant CAP_A = 100_000;     // card A daily sub-cap 0.10
    uint256 constant CAP_B = 150_000;     // card B daily sub-cap 0.15
    uint256 constant DEPOSIT = 1_000_000; // 1.00 USDC

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        vault = new PoolVault(address(usdc));
        vm.prank(owner);
        pid = vault.createPassport(agentA, SHOT, DAILY, 0);
        vm.prank(owner);
        vault.setCardCap(pid, agentA, CAP_A);
        vm.prank(owner);
        vault.addCard(pid, agentB, CAP_B);
        vm.prank(owner);
        vault.addPayee(pid, seller);
        usdc.mint(owner, DEPOSIT);
        vm.prank(owner);
        usdc.approve(address(vault), DEPOSIT);
        vm.prank(owner);
        vault.depositUSDC(pid, DEPOSIT);
    }

    function _pay(address agent, uint256 amount) internal {
        vm.prank(agent);
        vault.pay(pid, seller, amount, ref1);
    }

    function _tryPay(address agent, uint256 amount) internal returns (bool ok, uint8 code) {
        vm.prank(agent);
        return vault.tryPay(pid, seller, amount, ref1);
    }

    // P1: creation registers the primary card; addCard registers B; enumeration works.
    function testP1_CardsRegistered() public {
        (bool activeA, uint256 capA,) = vault.getCard(pid, agentA);
        require(activeA && capA == CAP_A, "P1 A card");
        (bool activeB, uint256 capB,) = vault.getCard(pid, agentB);
        require(activeB && capB == CAP_B, "P1 B card");
        require(vault.cardCount(pid) == 2, "P1 count");
        require(vault.cardAt(pid, 0) == agentA && vault.cardAt(pid, 1) == agentB, "P1 list");
    }

    // P2: a normal payment charges BOTH ledgers (pool + card).
    function testP2_BothLedgersCharged() public {
        _pay(agentA, SHOT);
        PoolVault.Passport memory p = vault.getPassport(pid);
        require(p.spentToday == SHOT && p.balance == DEPOSIT - SHOT, "P2 pool ledger");
        (, , uint256 spentA) = vault.getCard(pid, agentA);
        require(spentA == SHOT, "P2 card ledger");
        require(usdc.balanceOf(seller) == SHOT, "P2 seller paid");
    }

    // P3: card sub-cap binds even when the pool has room (code 9).
    function testP3_CardCapBinds() public {
        _pay(agentB, SHOT);
        _pay(agentB, SHOT);
        _pay(agentB, SHOT); // B at 0.15 = its cap; pool at 0.15 of 0.20
        (bool ok, uint8 code) = _tryPay(agentB, SHOT);
        require(!ok && code == 9, "P3 expected over_card_limit");
    }

    // P4: pool exhaustion blames the POOL (code 6), not the card with room left.
    function testP4_PoolCapBlamesPool() public {
        _pay(agentA, SHOT); // A 0.05 (card room: 0.05 left)
        _pay(agentB, SHOT);
        _pay(agentB, SHOT);
        _pay(agentB, SHOT); // pool now 0.20 = full
        (bool ok, uint8 code) = _tryPay(agentA, SHOT);
        require(!ok && code == 6, "P4 expected over_daily_limit");
    }

    // P5: a non-card address cannot pay at all.
    function testP5_NonCardCannotPay() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.pay(pid, seller, SHOT, ref1);
    }

    // P6: approval happy path — over-cap request, owner approves, payment executes,
    //     delivery-grade PaymentExecuted fires, both ledgers show the exception.
    function testP6_ApprovalExecutes() public {
        _pay(agentA, SHOT);
        _pay(agentB, SHOT);
        _pay(agentB, SHOT);
        _pay(agentB, SHOT); // pool full at 0.20
        vm.prank(agentA);
        uint256 rid = vault.requestApproval(pid, seller, SHOT, ref1);
        require(rid == 1, "P6 rid");
        vm.prank(owner);
        vault.approveRequest(pid, rid);
        PoolVault.ApprovalRequest memory r = vault.getRequest(pid, rid);
        require(r.state == 2, "P6 state executed");
        require(usdc.balanceOf(seller) == DAILY + SHOT, "P6 seller got exception payment");
        PoolVault.Passport memory p = vault.getPassport(pid);
        require(p.spentToday == DAILY + SHOT, "P6 pool ledger above cap (approved)");
        (, , uint256 spentA) = vault.getCard(pid, agentA);
        require(spentA == SHOT * 2, "P6 card ledger charged");
    }

    // P7: an approval may NOT break the hard rules (whitelist, per-payment cap).
    function testP7_ApprovalHardRules() public {
        vm.prank(agentA);
        vm.expectRevert();
        vault.requestApproval(pid, rando, SHOT, ref1); // not whitelisted
        vm.prank(agentA);
        vm.expectRevert();
        vault.requestApproval(pid, seller, SHOT + 1, ref1); // over single cap
    }

    // P8: rejection is final; only the owner decides.
    function testP8_RejectAndOwnerOnly() public {
        vm.prank(agentA);
        uint256 rid = vault.requestApproval(pid, seller, SHOT, ref1);
        vm.prank(stranger);
        vm.expectRevert();
        vault.approveRequest(pid, rid); // not owner
        vm.prank(owner);
        vault.rejectRequest(pid, rid);
        PoolVault.ApprovalRequest memory r = vault.getRequest(pid, rid);
        require(r.state == 3, "P8 state rejected");
        vm.prank(owner);
        vm.expectRevert();
        vault.approveRequest(pid, rid); // no longer pending
    }

    // P9: removing a card cuts its spending immediately; cap tightening too.
    function testP9_RemoveCardAndTighten() public {
        vm.prank(owner);
        vault.removeCard(pid, agentB);
        vm.prank(agentB);
        vm.expectRevert();
        vault.pay(pid, seller, SHOT, ref1);
        vm.prank(owner);
        vault.setCardCap(pid, agentA, SHOT); // A may now spend only 0.05/day
        _pay(agentA, SHOT);
        (bool ok, uint8 code) = _tryPay(agentA, SHOT);
        require(!ok && code == 9, "P9 tightened cap binds");
    }

    // P10: revoke stops payments AND approvals; the owner's money is never trapped.
    function testP10_RevokeStopsAllWithdrawWorks() public {
        vm.prank(agentA);
        uint256 rid = vault.requestApproval(pid, seller, SHOT, ref1);
        vm.prank(owner);
        vault.revoke(pid);
        (bool ok, uint8 code) = _tryPay(agentA, SHOT);
        require(!ok && code == 2, "P10 pay blocked by revoke");
        vm.prank(owner);
        vm.expectRevert();
        vault.approveRequest(pid, rid);
        uint256 before = usdc.balanceOf(owner);
        vm.prank(owner);
        vault.withdraw(pid, DEPOSIT);
        require(usdc.balanceOf(owner) == before + DEPOSIT, "P10 withdraw after revoke");
    }
}
