// Capture each top-level section as a PNG for visual review.
// Usage: node shot-sections.cjs [light|dark]
const puppeteer = require('puppeteer');
const path = require('path');

const theme = process.argv[2] || 'light';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1150, deviceScaleFactor: 1.6 });
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: theme },
  ]);
  await page.goto(
    'file://' + path.resolve(__dirname, '../docs/submission/diagrams.html'),
    { waitUntil: 'networkidle0', timeout: 60000 },
  );
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await new Promise((r) => setTimeout(r, 1500));

  const sections = await page.$$('header, section');
  for (let i = 0; i < sections.length; i += 1) {
    await sections[i].screenshot({ path: `/tmp/${theme}/sec${i}.png` });
  }
  console.log('sections captured:', sections.length, theme);
  await browser.close();
})();
