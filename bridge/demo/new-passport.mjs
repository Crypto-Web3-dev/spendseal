// Create a fresh demo passport with the standard stage parameters
// (single 0.05 / daily 0.20 USDC, seller whitelisted, 1.00 USDC deposited).
// Every full rehearsal run consumes one passport-day, so runs use these
// disposable passports and the stage keeps passport #1 untouched.
// Usage: node demo/new-passport.mjs
import { parseUnits } from "viem";
import { pub, ownerWallet, ADDR, vaultAbi, usdc } from "./lib.mjs";

const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
];
const vaultWrite = [
  ...vaultAbi,
  { type: "function", name: "createPassport", stateMutability: "nonpayable",
    inputs: [
      { name: "agent", type: "address" }, { name: "singleLimit", type: "uint256" },
      { name: "dailyLimit", type: "uint256" }, { name: "expiry", type: "uint64" },
    ], outputs: [{ name: "passportId", type: "uint256" }] },
  { type: "function", name: "addPayee", stateMutability: "nonpayable",
    inputs: [{ name: "passportId", type: "uint256" }, { name: "payee", type: "address" }], outputs: [] },
  { type: "function", name: "depositUSDC", stateMutability: "nonpayable",
    inputs: [{ name: "passportId", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [] },
];

const { result: id } = await pub.simulateContract({
  address: ADDR.vault, abi: vaultWrite, functionName: "createPassport",
  args: [ADDR.agent, parseUnits("0.05", 6), parseUnits("0.20", 6), 0n],
  account: ownerWallet.account,
});
let hash = await ownerWallet.writeContract({
  address: ADDR.vault, abi: vaultWrite, functionName: "createPassport",
  args: [ADDR.agent, parseUnits("0.05", 6), parseUnits("0.20", 6), 0n],
});
await pub.waitForTransactionReceipt({ hash });
console.log(`护照 #${id} 已创建（单笔 0.05 / 日限额 0.20 USDC）`);

hash = await ownerWallet.writeContract({
  address: ADDR.vault, abi: vaultWrite, functionName: "addPayee", args: [id, ADDR.seller],
});
await pub.waitForTransactionReceipt({ hash });
console.log("卖家已加入白名单");

hash = await ownerWallet.writeContract({
  address: ADDR.usdc, abi: erc20Abi, functionName: "approve", args: [ADDR.vault, parseUnits("1", 6)],
});
await pub.waitForTransactionReceipt({ hash });
hash = await ownerWallet.writeContract({
  address: ADDR.vault, abi: vaultWrite, functionName: "depositUSDC", args: [id, parseUnits("1", 6)],
});
await pub.waitForTransactionReceipt({ hash });
console.log(`已存入 ${usdc(parseUnits("1", 6))}。彩排/演示时把桥的 PASSPORT_ID 设为 ${id} 即可。`);
