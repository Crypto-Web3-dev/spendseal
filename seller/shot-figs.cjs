// Export each demo figure as its own PNG (light + dark), sized for a slide.
// Usage: node shot-figs.cjs
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SRC = 'file://' + path.resolve(
  __dirname,
  '../docs/submission/diagrams.html',
);
const OUT = path.resolve(__dirname, '../docs/submission/figs');

const NAMES = ['A-architecture', 'B-flow', 'C-compare'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage();
    // Wide enough that the figures are never inside a horizontal scroll.
    await page.setViewport({ width: 1240, height: 1000, deviceScaleFactor: 2 });
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: theme },
    ]);
    await page.goto(SRC, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 1200));

    // Capture the scroll wrapper, not the <figure>: the figcaption is
    // already shown by the page beside the figure, and a slide carries
    // its own takeaway line instead.
    const figs = await page.$$('figure.fig .fig-scroll');
    for (let i = 0; i < figs.length; i += 1) {
      const name = NAMES[i] || `fig${i}`;
      const file = path.join(OUT, `${name}-${theme}.png`);
      await figs[i].screenshot({ path: file });
      const box = await figs[i].boundingBox();
      console.log(`${path.basename(file)}: ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    await page.close();
  }

  await browser.close();
})();
