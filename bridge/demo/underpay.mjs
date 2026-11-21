// S-E backup demo: paying LESS than the invoice says.
// The vault happily executes a 0.01 payment carrying the 0.05 invoice's ref —
// but the seller verifies amount >= invoice amount and refuses delivery.
// Usage: node demo/underpay.mjs <passportId>   (seller must be running)
import { parseUnits } from "viem";
import { agentTryPay, SELLER_BASE } from "./lib.mjs";

const id = process.argv[2];
if (!id) { console.error("usage: node demo/underpay.mjs <passportId>"); process.exit(1); }
const target = `${SELLER_BASE}/demo-page`;
const api = `${SELLER_BASE}/api/screenshot?url=${encodeURIComponent(target)}`;

const first = await fetch(api);
const invoice = await first.json();
console.log(`发票金额：${invoice.amountUnits} 单位（0.05 USDC）。现在只付 0.01，却带上这张发票的 ref：`);
const tx = await agentTryPay(id, invoice.payTo, parseUnits("0.01", 6), invoice.ref);
console.log(`少付交易已上链：${tx}`);
const res = await fetch(api, { headers: { "x-payment-tx": tx } });
const body = await res.json().catch(() => ({}));
console.log(`卖家兑付：HTTP ${res.status}，reason = ${body.reason}`);
console.log(res.status === 402 && body.reason === "amount_too_low"
  ? "✅ S-E 成立：付了钱 ≠ 能骗到货，卖家按发票金额验付。"
  : "⚠️ 结果与预期不符，检查卖家状态。");
