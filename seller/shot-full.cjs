// Export the demo diagrams page as full-page PNGs (light + dark) at 2x.
// Usage: node shot-full.cjs
const puppeteer = require('puppeteer');
const path = require('path');

const SRC = 'file://' + path.resolve(
  __dirname,
  '../docs/submission/diagrams.html',
);

const OUT = path.resolve(__dirname, '../docs/submission');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1100, deviceScaleFactor: 2 });
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: theme },
    ]);
    await page.goto(SRC, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 1200));

    const file =
      theme === 'light' ? 'diagrams.png' : 'diagrams-dark.png';
    await page.screenshot({
      path: path.join(OUT, file),
      fullPage: true,
      captureBeyondViewport: true,
    });
    const box = await page.evaluate(() => ({
      h: document.documentElement.scrollHeight,
      w: document.documentElement.scrollWidth,
    }));
    console.log(`${file}: css ${box.w}x${box.h}`);
    await page.close();
  }

  await browser.close();
})();
