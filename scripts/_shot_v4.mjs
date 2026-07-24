import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:5199/?seed=7');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(500);
// 1: reception + lobby dressing
await page.evaluate(() => window.__game.teleport('nurse', -23.5, 11.5));
await page.waitForTimeout(700);
await page.screenshot({ path: 'test-results/shots/v4-lobby.png' });
// 2: angry rampage mid-chaos
await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const cid of ['strep', 'gout']) {
    const id = g.spawnCase(cid, -22 + Math.random() * 2, 13);
    await sleep(200);
    const p = [...g.game.world.byTag('patients')].find((q) => q.id === id);
    p.sim.state = 'angry'; p.setFace('angry');
  }
});
await page.waitForTimeout(6000);
await page.screenshot({ path: 'test-results/shots/v4-rampage.png' });
// 3: pinned wall monitor in a room
await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const id = g.spawnCase('sepsis', -20, 8);
  await sleep(200);
  g.bedPatientTo(id, 2);
  g.teleport('nurse', -20, -8.5);
  await sleep(2500); // monitor hooks itself
});
await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/shots/v4-monitor.png' });
// 4: fullscreen vitals via tap
await page.locator('.mon').first().dispatchEvent('pointerdown');
await page.waitForTimeout(600);
await page.screenshot({ path: 'test-results/shots/v4-vitalsfull.png' });
await browser.close();
