// Render docs/submission/architecture.html to architecture.png (2x for crisp text).
import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
await page.goto("file://" + new URL("../../docs/submission/architecture.html", import.meta.url).pathname,
  { waitUntil: "networkidle0" });
await page.screenshot({ path: new URL("../../docs/submission/architecture.png", import.meta.url).pathname });
await browser.close();
console.log("rendered docs/submission/architecture.png");
