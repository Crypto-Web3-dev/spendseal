// Pool act 4b: wait for the owner's approval, then claim the delivery from the
// seller using the APPROVAL transaction as the payment proof (it carries the
// PaymentExecuted event the seller verifies).
// Usage: node demo/pool-claim.mjs   (reads pool-request.json written by pool-request.mjs)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEventLogs } from "viem";
import { pub, poolAbi, POOL, getPool, getCard, ADDR, usdc } from "./pool-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const saved = JSON.parse(readFileSync(resolve(here, "pool-request.json"), "utf8"));
const id = BigInt(saved.poolId);
const rid = BigInt(saved.requestId);

console.log(`等待主人批准申请 #${rid}…（在池子页点「批准」，最长等 3 分钟）`);
let state = 0;
for (let i = 0; i < 90; i++) {
  const r = await pub.readContract({ address: POOL, abi: poolAbi, functionName: "getRequest", args: [id, rid] });
  state = r.state;
  if (state !== 1) break;
  await new Promise((r2) => setTimeout(r2, 2000));
}
if (state === 3) { console.log("✋ 主人拒绝了这笔申请。Agent 拿不到钱——这就是「超额要人批」。"); process.exit(0); }
if (state !== 2) { console.log("等待超时，申请仍未批准。"); process.exit(1); }

// Find the approval transaction (it holds the PaymentExecuted log).
const latest = await pub.getBlockNumber();
const from = latest > 5000n ? latest - 5000n : 0n;
const logs = await pub.getLogs({
  address: POOL, fromBlock: from, toBlock: latest,
  event: poolAbi.find((x) => x.type === "event" && x.name === "ApprovalExecuted"),
  args: { passportId: id, requestId: rid },
});
if (!logs.length) { console.error("找不到 ApprovalExecuted 日志"); process.exit(1); }
const payTx = logs[0].transactionHash;
console.log(`✅ 已批准，付款交易：${payTx}`);

const paid = await fetch(saved.url, { headers: { "X-PAYMENT-TX": payTx } });
if (!paid.ok) { console.error(`取货失败：HTTP ${paid.status}`); process.exit(1); }
const buf = Buffer.from(await paid.arrayBuffer());
writeFileSync(resolve(here, "pool-claim.png"), buf);
const p = await getPool(saved.poolId);
const cardA = await getCard(saved.poolId, ADDR.agentA);
console.log(`截图已交付 → pool-claim.png（${buf.length} bytes）`);
console.log(`分账更新：池今日已花 ${usdc(p.spentToday)}（日限额 ${usdc(p.dailyLimit)}，超出部分 = 主人批准的例外）；卡 A 已花 ${usdc(cardA.spentToday)}`);
