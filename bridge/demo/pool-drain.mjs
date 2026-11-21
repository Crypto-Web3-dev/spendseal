// Pool act 2: Agent B runs a batch job and drains the shared pool — with REAL
// purchases through the seller's 402 flow (invoice → verify → tryPay → delivery).
// Usage: node demo/pool-drain.mjs <poolId> [count=3]
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentBWallet, ADDR, SELLER_BASE, buyWithWallet, getPool, getCard, usdc } from "./pool-lib.mjs";

const id = process.argv[2];
const count = Number(process.argv[3] ?? 3);
if (!id) { console.error("usage: node demo/pool-drain.mjs <poolId> [count]"); process.exit(1); }
const here = dirname(fileURLToPath(import.meta.url));
const url = `${SELLER_BASE}/api/screenshot?url=${encodeURIComponent("https://example.com")}&w=800`;

const before = await getPool(id);
const cardB0 = await getCard(id, ADDR.agentB);
console.log(`=== 池 #${id}：Agent B 开始批量采购（${count} 次）===`);
console.log(`采购前：池今日已花 ${usdc(before.spentToday)} / ${usdc(before.dailyLimit)}；B 卡已花 ${usdc(cardB0.spentToday)} / ${usdc(cardB0.dailyCap)}`);

for (let i = 1; i <= count; i++) {
  const r = await buyWithWallet(agentBWallet, id, url);
  writeFileSync(resolve(here, `pool-drain-${i}.png`), r.bytes);
  const p = await getPool(id);
  console.log(`  第 ${i} 次：付款 ${usdc(r.amount)} 成功（tx ${r.txHash.slice(0, 18)}…），截图已交付 pool-drain-${i}.png；池今日累计 ${usdc(p.spentToday)}`);
}

const after = await getPool(id);
const cardB = await getCard(id, ADDR.agentB);
const cardA = await getCard(id, ADDR.agentA);
console.log(`采购后：池今日已花 ${usdc(after.spentToday)} / ${usdc(after.dailyLimit)}（池余额 ${usdc(after.balance)}）`);
console.log(`分账：卡 A 已花 ${usdc(cardA.spentToday)} / ${usdc(cardA.dailyCap)}；卡 B 已花 ${usdc(cardB.spentToday)} / ${usdc(cardB.dailyCap)}`);
console.log("→ 池子的日限额已经被 B 打满。接下来让 A 再买一次，看会发生什么。");
