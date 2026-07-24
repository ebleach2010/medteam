import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
let printed = 0;
page.on('pageerror', (e) => { if (printed++ < 2) console.log('PAGEERROR:', e.stack); });
await page.goto('http://localhost:5199/?lite=1&seed=7');
await page.waitForFunction(() => window.__game?.ready);
await page.evaluate(() => { document.querySelector('.go')?.click(); });
await page.waitForTimeout(500);
await page.evaluate(() => {
  const g = window.__game;
  const id = g.spawnCase('od', -24, -4.2);
  g.teleport('nurse', -24, -3.4);
  g.inject({ type: 'GRAB', actorId: g.game.nurse.id });
});
await page.waitForTimeout(3000);
console.log('errors seen:', printed);
await browser.close();
