// One-time PWA icon generator: renders the icon on a canvas in headless
// Chromium and saves PNGs. Run: node scripts/gen-icons.mjs
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const exe = process.env.PW_CHROMIUM_PATH || undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();

for (const size of [192, 512]) {
  const dataUrl = await page.evaluate((s) => {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const u = s / 100;
    // rounded dark tile
    g.fillStyle = '#0e1420';
    g.beginPath(); g.roundRect(0, 0, s, s, 18 * u); g.fill();
    // teal blob shadow + cross
    g.fillStyle = '#17513f';
    g.beginPath(); g.arc(52 * u, 56 * u, 34 * u, 0, 7); g.fill();
    g.fillStyle = '#2fb59e';
    g.beginPath(); g.arc(48 * u, 50 * u, 34 * u, 0, 7); g.fill();
    g.fillStyle = '#ff5d5d';
    g.fillRect(40 * u, 22 * u, 18 * u, 56 * u);
    g.fillRect(21 * u, 41 * u, 56 * u, 18 * u);
    g.fillStyle = '#fff';
    g.fillRect(44 * u, 26 * u, 10 * u, 48 * u);
    g.fillRect(25 * u, 45 * u, 48 * u, 10 * u);
    return c.toDataURL('image/png');
  }, size);
  mkdirSync('public/icons', { recursive: true });
  writeFileSync(`public/icons/icon-${size}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`icon-${size}.png written`);
}
await browser.close();
