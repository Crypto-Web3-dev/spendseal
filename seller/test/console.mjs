// Console page verification: loads web/index.html in headless Chromium against
// an anvil fork of Monad testnet (real deployed vault state), asserts the
// rendered numbers match the chain, and saves a screenshot for eyeballing.
// Prereqs: anvil fork on :8545 + static server for ../../web on :8080.
import puppeteer from "puppeteer";

const PAGE_URL = "http://localhost:8080/?rpc=http://localhost:8545&passport=1";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(PAGE_URL, { waitUntil: "networkidle2", timeout: 30_000 });
await page.waitForFunction(() => document.getElementById("balance").textContent !== "–", { timeout: 20_000 });
await page.waitForFunction(() => !document.getElementById("feedBody").textContent.includes("读取中"), { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 1500));

const grab = (id) => page.$eval("#" + id, (el) => el.textContent);
const data = {
  balance: await grab("balance"),
  spentToday: await grab("spentToday"),
  dailyLimit: await grab("dailyLimit"),
  singleLimit: await grab("singleLimit"),
  status: await grab("statusPill"),
  feed: await page.$eval("#feedBody", (el) => el.textContent),
  payees: await page.$eval("#payeeList", (el) => el.textContent),
};
console.log(JSON.stringify(data, null, 1).slice(0, 900));
const assert = (c, m) => { console.log((c ? "ok - " : "FAIL - ") + m); if (!c) process.exitCode = 1; };
// Expected values track the live chain state of passport #1 on the current
// vault. Update these together with the deployment, otherwise the console
// test fails for the wrong reason (state drift, not a rendering bug).
assert(data.balance === "1.00", `balance renders 1.00 USDC (got ${data.balance})`);
assert(data.spentToday === "0.00", `spentToday renders effective 0.00 on a fresh UTC day (got ${data.spentToday})`);
assert(data.dailyLimit === "0.20", `dailyLimit renders 0.20 (got ${data.dailyLimit})`);
assert(data.status.includes("有效"), "passport #1 shows active");
assert(data.feed.includes("0.05") || data.feed.includes("暂无付款"),
  "payment feed renders (recent rows, or empty state when payments fall outside the scan window)");
assert(data.payees.includes("白名单内"), "payee list shows seller whitelisted");
assert(errors.length === 0, `no page JS errors (${errors.join("; ").slice(0, 200)})`);
await page.screenshot({ path: new URL("../../web/test/console.png", import.meta.url).pathname, fullPage: true });
console.log("screenshot -> web/test/console.png");
await browser.close();
