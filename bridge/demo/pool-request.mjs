// Pool act 4a: the pool is at its cap, so a card files an ON-CHAIN approval
// request for one more purchase instead of paying. The owner approves in the
// console; then run pool-claim.mjs to collect the delivery.
// Usage: node demo/pool-request.mjs <poolId> [a|b]   — which card asks (default a)
//   Either card works: requestApproval ignores both daily caps by design, so a
//   card that is already maxed out can still ask. That is the point of the act.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEventLogs } from "viem";
import { pub, agentAWallet, agentBWallet, poolAbi, POOL, SELLER_BASE, verifyPoolInvoice, usdc } from "./pool-lib.mjs";

const id = process.argv[2];
const who = (process.argv[3] ?? "a").toLowerCase();
if (!id) { console.error("usage: node demo/pool-request.mjs <poolId> [a|b]"); process.exit(1); }
if (who !== "a" && who !== "b") { console.error("第二参数只能是 a 或 b（用哪张卡发起申请）"); process.exit(1); }
const wallet = who === "b" ? agentBWallet : agentAWallet;
const card = who === "b" ? "B" : "A";
const here = dirname(fileURLToPath(import.meta.url));
const url = `${SELLER_BASE}/api/screenshot?url=${encodeURIComponent("https://example.com")}&w=800`;

const first = await fetch(url);
if (first.status !== 402) { console.error(`卖家返回 HTTP ${first.status}，不是 402`); process.exit(1); }
const invoice = await first.json();
const sig = await verifyPoolInvoice(invoice);
if (!sig.ok) { console.error(`发票验签失败：${sig.code}`); process.exit(1); }

const hash = await wallet.writeContract({
  address: POOL, abi: poolAbi, functionName: "requestApproval",
  args: [BigInt(id), invoice.payTo, BigInt(invoice.amountUnits), invoice.ref],
});
const receipt = await pub.waitForTransactionReceipt({ hash });
const logs = parseEventLogs({ abi: poolAbi, logs: receipt.logs, eventName: "ApprovalRequested" });
const requestId = logs[0]?.args?.requestId;
if (requestId === undefined) { console.error("没从回执里解析出 requestId"); process.exit(1); }

writeFileSync(resolve(here, "pool-request.json"), JSON.stringify({
  poolId: id, requestId: requestId.toString(), url, ref: invoice.ref,
  amount: invoice.amountUnits, requestTx: hash, card,
}, null, 2));
console.log(`=== 卡 ${card} 已提交超额申请 #${requestId}：${usdc(BigInt(invoice.amountUnits))} → 卖家 ===`);
console.log(`申请交易：${hash}`);
console.log("→ 请主人在控制台池子页点「批准」。批准后运行 pool-claim.mjs 取货。");
