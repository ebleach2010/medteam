import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:5199/?seed=7');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(400);
await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const staff = [g.game.doctor, g.game.aide, g.game.porter, g.game.tech, g.game.surgeon];
  staff.forEach((c, i) => {
    c.body.setTranslation({ x: -25 + i * 1.3, y: 1, z: 11.6 }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    c.yaw = 0;
  });
  for (let i = 0; i < 6; i++) g.spawnCase(['ankle', 'gout', 'strep', 'uti', 'migraine', 'concuss'][i], -26 + i * 1.4, 14.2);
  g.teleport('nurse', -21.5, 13.2);
  g.game.nurse.yaw = 0;
  await sleep(2500);
});
await page.screenshot({ path: 'test-results/shots/rigs-group.png' });
await browser.close();
