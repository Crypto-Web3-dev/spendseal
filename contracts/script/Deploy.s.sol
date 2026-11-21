// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PassportVault} from "../src/PassportVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

// Minimal script harness (no forge-std dependency).
interface Vm {
    function envOr(string calldata, address) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

abstract contract Script {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    function run() public virtual;
}

/// @notice Deploy PassportVault.
/// Monad testnet (default): uses Circle's testnet USDC unless USDC_ADDRESS overrides.
///   forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast --private-key $OWNER_PRIVATE_KEY
/// Local rehearsal: set DEPLOY_MOCK=1 (via USDC_ADDRESS unset + MOCK flag is not read here;
/// instead pass USDC_ADDRESS=0x0000000000000000000000000000000000000000 to force a MockUSDC deploy).
contract Deploy is Script {
    address internal constant CIRCLE_USDC_MONAD_TESTNET = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    function run() public override {
        address usdcAddr = vm.envOr("USDC_ADDRESS", CIRCLE_USDC_MONAD_TESTNET);
        vm.startBroadcast();
        if (usdcAddr == address(0)) {
            usdcAddr = address(new MockUSDC());
        }
        new PassportVault(usdcAddr);
        vm.stopBroadcast();
    }
}
