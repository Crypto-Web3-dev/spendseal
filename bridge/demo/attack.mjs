// S-B stage script: "the agent's private key just leaked."
// Run WITH the leaked (agent) key and try to do maximum damage:
//   1) withdraw the passport's USDC        -> NotOwner
//   2) raise my own limits                 -> NotOwner
//   3) pay the whitelisted seller nonstop  -> works until the daily cap,
//      then the vault itself refuses. Worst case = the daily limit. QED.
// Usage: node demo/attack.mjs <passportId>
import { randomBytes } from "node:crypto";
import { keccak256, parseUnits } from "viem";
import { pub, agentWallet, ADDR, vaultAbi, getPassport, checkPay, agentTryPay, usdc } from "./lib.mjs";

const id = process.argv[2];
if (!id) { console.error("usage: node demo/attack.mjs <passportId>"); process.exit(1); }

const fullAbi = [
  ...vaultAbi,
  { type: "function", name: "withdraw", stateMutability: "nonpayable",
    inputs: [{ name: "passportId", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "updateLimits", stateMutability: "nonpayable",
    inputs: [
      { name: "passportId", type: "uint256" }, { name: "newSingleLimit", type: "uint256" },
      { name: "newDailyLimit", type: "uint256" },
    ], outputs: [] },
  // custom errors included so viem decodes the exact revert reason by name
  { type: "error", name: "NotOwner", inputs: [] },
  { type: "error", name: "NotAgent", inputs: [] },
  { type: "error", name: "OverDailyLimit", inputs: [] },
  { type: "error", name: "OverSingleLimit", inputs: [] },
];

async function expectRevert(label, fn, args) {
  try {
    await pub.simulateContract({ address: ADDR.vault, abi: fullAbi, functionName: fn, args, account: agentWallet.account });
    console.log(`!! ${label}：居然模拟通过了（不该发生）`);
  } catch (e) {
    const name = e?.cause?.data?.errorName
      ?? String(e).match(/(NotOwner|NotAgent|OverDailyLimit|OverSingleLimit)/)?.[1]
      ?? "revert";
    console.log(`✋ ${label} → 被拒：${name}`);
  }
}

console.log(`=== S-B：假设 Agent 私钥已泄露（护照 #${id}）===`);
const before = await getPassport(id);
console.log(`泄露前：余额 ${usdc(before.balance)}，今日已付 ${usdc(before.spentToday)} / 日限额 ${usdc(before.dailyLimit)}`);

await expectRevert("用 Agent 密钥提走护照里的钱", "withdraw", [BigInt(id), before.balance]);
await expectRevert("用 Agent 密钥把自己的日限额改成 1000 USDC", "updateLimits",
  [BigInt(id), parseUnits("1000", 6), parseUnits("1000", 6)]);

console.log("改不了、提不走。那就狂付白名单卖家，能付多少付多少：");
for (let i = 1; ; i++) {
  const pre = await checkPay(id, ADDR.seller, parseUnits("0.05", 6));
  if (!pre.ok) { console.log(`第 ${i} 笔被护照拒绝：${pre.reason}`); break; }
  const ref = keccak256("0x" + randomBytes(32).toString("hex"));
  await agentTryPay(id, ADDR.seller, parseUnits("0.05", 6), ref);
  const now = await getPassport(id);
  console.log(`第 ${i} 笔付成，今日累计 ${usdc(now.spentToday)}`);
  if (i > 12) { console.log("!! 超过预期笔数，停"); break; }
}
const after = await getPassport(id);
console.log("");
console.log(`最坏损失 = 今日被付走 ${usdc(after.spentToday - before.spentToday)}（日限额封顶），护照里还剩 ${usdc(after.balance)} 完好无损。`);
console.log("结论：密钥泄露 ≠ 钱包被盗。Agent 从来就只有「在护照规则内付钱」这一种权力。");
