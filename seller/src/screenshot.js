import puppeteer from "puppeteer";

// One shared headless Chromium for the seller process. Viewport matches the
// demo framing: 1280x800, above-the-fold capture (what a human would see first).

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    const args = ["--no-sandbox", "--disable-dev-shm-usage"];
    // Some hosts (like this dev VM) can only egress through a proxy that curl
    // and node honor via env vars, but Chromium ignores env proxies unless
    // told explicitly. On a normal cloud host there is no proxy env and
    // Chromium connects directly.
    const proxy = process.env.https_proxy || process.env.http_proxy || process.env.HTTP_PROXY;
    if (proxy) {
      // Chromium rejects proxy URLs whose password contains a raw "@"
      // (ERR_NO_SUPPORTED_PROXIES) — re-encode userinfo before handing it over.
      try {
        const u = new URL(proxy);
        const auth = u.username
          ? `${encodeURIComponent(decodeURIComponent(u.username))}:${encodeURIComponent(decodeURIComponent(u.password))}@`
          : "";
        args.push(`--proxy-server=${u.protocol}//${auth}${u.host}`);
      } catch {
        args.push(`--proxy-server=${proxy}`);
      }
    }
    browserPromise = puppeteer.launch({ headless: true, args });
  }
  return browserPromise;
}

export async function takeScreenshot(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
    return await page.screenshot({ type: "png" });
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    await b?.close().catch(() => {});
    browserPromise = null;
  }
}
