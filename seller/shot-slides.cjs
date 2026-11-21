// Render the 16:9 slide template to per-slide PNGs at exactly 1920x1080.
// Usage: node shot-slides.cjs [theme]
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const theme = process.argv[2] || 'light';
const SRC = 'file://' + path.resolve(__dirname, 'slides-template.html');
const OUT = path.resolve(__dirname, '../docs/submission/slides');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await page.goto(SRC, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1200));

  const slides = await page.$$('section.slide');
  for (let i = 0; i < slides.length; i += 1) {
    const name = await slides[i].evaluate((el) => el.dataset.slide);
    const file = path.join(OUT, `${String(i).padStart(2, '0')}-${name}-${theme}.png`);
    await slides[i].screenshot({ path: file });
    const box = await slides[i].boundingBox();
    console.log(`${path.basename(file)}: ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  await browser.close();
})();
