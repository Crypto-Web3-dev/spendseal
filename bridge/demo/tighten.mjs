// S-F backup demo: the owner tightens the daily limit mid-day and it bites
// immediately (same UTC day, no waiting for a reset).
//   node demo/tighten.mjs <passportId>            tighten daily limit to today's spent
//   node demo/tighten.mjs <passportId> --restore  restore daily limit to 0.20 USDC
import { parseUnits } from "viem";
import { pub, ownerWallet, ADDR, vaultAbi, getPassport, checkPay, usdc } from "./lib.mjs";

const id = process.argv[2];
const restore = process.argv.includes("--restore");
if (!id) { console.error("usage: node demo/tighten.mjs <passportId> [--restore]"); process.exit(1); }

const fullAbi = [
  ...vaultAbi,
  { type: "function", name: "updateLimits", stateMutability: "nonpayable",
    inputs: [
      { name: "passportId", type: "uint256" }, { name: "newSingleLimit", type: "uint256" },
      { name: "newDailyLimit", type: "uint256" },
    ], outputs: [] },
];

const p = await getPassport(id);
const before = await checkPay(id, ADDR.seller, parseUnits("0.05", 6));
console.log(`当前：今日已付 ${usdc(p.spentToday)} / 日限额 ${usdc(p.dailyLimit)}；再付 0.05 预检 = ${before.ok ? "可付" : before.reason}`);

const newDaily = restore ? parseUnits("0.20", 6) : p.spentToday;
const hash = await ownerWallet.writeContract({
  address: ADDR.vault, abi: fullAbi, functionName: "updateLimits",
  args: [BigInt(id), p.singleLimit, newDaily],
});
await pub.waitForTransactionReceipt({ hash });
const after = await checkPay(id, ADDR.seller, parseUnits("0.05", 6));
console.log(restore
  ? `已恢复日限额 0.20 USDC；再付 0.05 预检 = ${after.ok ? "可付 ✅" : after.reason + "（今日已付较多、剩余额度不足 0.05 时这是算术结果，不是故障）"}`
  : `主人刚把日限额收紧到 ${usdc(newDaily)}（= 今日已付）；再付 0.05 预检 = ${after.ok ? "仍可付 ⚠️" : "被拒：" + after.reason + " ✅ 当日即时生效，明日自动恢复"}`);
