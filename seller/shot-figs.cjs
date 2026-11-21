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

// Map by section id, not by document order: inserting a figure anywhere in
// the page must not silently re-label every export that follows it.
const NAMES = { arch: 'A-architecture', flow: 'B-flow', compare: 'C-compare', pool: 'D-pool' };

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

    for (const [sectionId, name] of Object.entries(NAMES)) {
      const el = await page.$(`#${sectionId} figure.fig .fig-scroll`);
      if (!el) {
        console.log(`skip ${sectionId}: no figure with that section id`);
        continue;
      }
      const file = path.join(OUT, `${name}-${theme}.png`);
      await el.screenshot({ path: file });
      const box = await el.boundingBox();
      console.log(`${path.basename(file)}: ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    await page.close();
  }

  await browser.close();
})();
