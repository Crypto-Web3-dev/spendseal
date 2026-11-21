// S-C backup demo: replaying one payment proof twice.
// Buys one screenshot honestly, then presents the SAME tx hash again —
// the seller must refuse with nonce_already_consumed.
// Usage: node demo/replay.mjs <passportId>   (seller must be running)
import { agentTryPay, SELLER_BASE } from "./lib.mjs";

const id = process.argv[2];
if (!id) { console.error("usage: node demo/replay.mjs <passportId>"); process.exit(1); }
const target = `${SELLER_BASE}/demo-page`;
const api = `${SELLER_BASE}/api/screenshot?url=${encodeURIComponent(target)}`;

const first = await fetch(api);
const invoice = await first.json();
console.log(`拿到发票：${invoice.amountUnits} 单位，ref ${invoice.ref.slice(0, 14)}…`);
const tx = await agentTryPay(id, invoice.payTo, BigInt(invoice.amountUnits), invoice.ref);
console.log(`正常付款：${tx}`);

const okRes = await fetch(api, { headers: { "x-payment-tx": tx } });
console.log(`第一次兑付：HTTP ${okRes.status}（${okRes.headers.get("content-type")}）——截图已发货`);

const replay = await fetch(api, { headers: { "x-payment-tx": tx } });
const body = await replay.json().catch(() => ({}));
console.log(`同一 tx 重放：HTTP ${replay.status}，reason = ${body.reason}`);
console.log(replay.status === 402 && body.reason === "nonce_already_consumed"
  ? "✅ S-C 成立：一份付款证明只能买一次。"
  : "⚠️ 结果与预期不符，检查卖家状态（发票可能已过期或卖家重启过）。");
