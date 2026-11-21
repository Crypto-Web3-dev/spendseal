// Console page verification: loads web/index.html (the pool console) in headless
// Chromium against the live Monad testnet, asserts the rendered numbers match the
// chain, and saves a screenshot for eyeballing.
// Prereqs: static server for ../../web on :8080. No fork needed — the page reads
// the public RPC directly.
// Note: the first load scans logs in ~30 sequential eth_getLogs calls against a
// rate-limited public RPC, so this test is deliberately patient.
import puppeteer from "puppeteer";

const PAGE_URL = "http://localhost:8080/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(PAGE_URL, { waitUntil: "networkidle2", timeout: 60_000 });
await page.waitForFunction(() => document.getElementById("pBalance").textContent !== "— USDC", { timeout: 90_000 });
await page.waitForFunction(() => !document.getElementById("feed").textContent.includes("加载中"), { timeout: 90_000 });
await new Promise((r) => setTimeout(r, 1500));

const grab = (id) => page.$eval("#" + id, (el) => el.textContent);
const data = {
  status: await grab("poolStatus"),
  balance: await grab("pBalance"),
  daily: await grab("pDaily"),
  single: await grab("pSingle"),
  total: await grab("pTotal"),
  addr: await grab("pAddr"),
  cardCount: await page.$$eval("#cards .card", (els) => els.length),
  cards: await page.$eval("#cards", (el) => el.textContent),
  feed: await page.$eval("#feed", (el) => el.textContent),
  err: await grab("errBox"),
};
console.log(JSON.stringify(data, null, 1).slice(0, 1200));
const assert = (c, m) => { console.log((c ? "ok - " : "FAIL - ") + m); if (!c) process.exitCode = 1; };

// Expected values track the live demo pool. Update these together with the
// deployment, otherwise the test fails for the wrong reason (state drift).
assert(data.addr === "0xc3cd8c06377401574f8825443f60a18ac748963c",
  `page points at the deployed pool (got ${data.addr})`);
assert(data.status.includes("Monad 测试网") || data.status.includes("熔断"),
  `pool status resolved, not stuck on 连接中… (got "${data.status}")`);
assert(/^\d+\.\d{2} USDC$/.test(data.balance), `balance renders in USDC (got ${data.balance})`);
assert(data.daily.includes(" / "), `pool daily renders spent / limit (got ${data.daily})`);
assert(data.single === "0.05 USDC", `single limit renders 0.05 USDC (got ${data.single})`);
assert(data.cardCount === 2, `two cards rendered (got ${data.cardCount})`);
assert(data.cards.includes("子额度"), "each card shows its own sub-cap and ledger");
assert(!data.feed.includes("加载中"), "event feed finished loading");
assert(data.err === "", `no read error surfaced (got "${data.err.slice(0, 120)}")`);
assert(errors.length === 0, `no page JS errors (${errors.join("; ").slice(0, 200)})`);

await page.screenshot({ path: new URL("../../web/test/console.png", import.meta.url).pathname, fullPage: true });
console.log("screenshot -> web/test/console.png");
await browser.close();
