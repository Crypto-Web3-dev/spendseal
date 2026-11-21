// Pool act 4a: the pool is dry, so Agent A files an ON-CHAIN approval request
// for one more purchase instead of paying. The owner approves in pool.html;
// then run pool-claim.mjs to collect the delivery.
// Usage: node demo/pool-request.mjs <poolId>
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEventLogs } from "viem";
import { pub, agentAWallet, poolAbi, POOL, SELLER_BASE, verifyPoolInvoice, usdc } from "./pool-lib.mjs";

const id = process.argv[2];
if (!id) { console.error("usage: node demo/pool-request.mjs <poolId>"); process.exit(1); }
const here = dirname(fileURLToPath(import.meta.url));
const url = `${SELLER_BASE}/api/screenshot?url=${encodeURIComponent("https://example.com")}&w=800`;

const first = await fetch(url);
if (first.status !== 402) { console.error(`卖家返回 HTTP ${first.status}，不是 402`); process.exit(1); }
const invoice = await first.json();
const sig = await verifyPoolInvoice(invoice);
if (!sig.ok) { console.error(`发票验签失败：${sig.code}`); process.exit(1); }

const hash = await agentAWallet.writeContract({
  address: POOL, abi: poolAbi, functionName: "requestApproval",
  args: [BigInt(id), invoice.payTo, BigInt(invoice.amountUnits), invoice.ref],
});
const receipt = await pub.waitForTransactionReceipt({ hash });
const logs = parseEventLogs({ abi: poolAbi, logs: receipt.logs, eventName: "ApprovalRequested" });
const requestId = logs[0]?.args?.requestId;
if (requestId === undefined) { console.error("没从回执里解析出 requestId"); process.exit(1); }

writeFileSync(resolve(here, "pool-request.json"), JSON.stringify({
  poolId: id, requestId: requestId.toString(), url, ref: invoice.ref,
  amount: invoice.amountUnits, requestTx: hash,
}, null, 2));
console.log(`=== Agent A 已提交超额申请 #${requestId}：${usdc(BigInt(invoice.amountUnits))} → 卖家 ===`);
console.log(`申请交易：${hash}`);
console.log("→ 请主人在控制台池子页点「批准」。批准后运行 pool-claim.mjs 取货。");
