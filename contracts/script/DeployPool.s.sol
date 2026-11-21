// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PoolVault} from "../src/PoolVault.sol";

// Minimal script harness (no forge-std dependency), same as Deploy.s.sol.
interface Vm {
    function envOr(string calldata, address) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

abstract contract Script {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    function run() public virtual;
}

/// @notice Deploy PoolVault (shared team budget pool) to Monad testnet with
///         Circle's testnet USDC unless USDC_ADDRESS overrides.
///   forge script script/DeployPool.s.sol:DeployPool --rpc-url https://testnet-rpc.monad.xyz --broadcast --private-key $OWNER_PRIVATE_KEY
contract DeployPool is Script {
    address internal constant CIRCLE_USDC_MONAD_TESTNET = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    function run() public override {
        address usdcAddr = vm.envOr("USDC_ADDRESS", CIRCLE_USDC_MONAD_TESTNET);
        vm.startBroadcast();
        new PoolVault(usdcAddr);
        vm.stopBroadcast();
    }
}
