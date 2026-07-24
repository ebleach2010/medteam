import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:5199/?seed=7&lite=1');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(400);
const out = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const id = g.spawnCase('sepsis', -20, 8);
  await sleep(300);
  g.bedPatientTo(id, 2);
  g.teleport('nurse', -20, -8.5);
  await sleep(2600);
  const p = g.state().patients.find((q) => q.id === id);
  const card = document.querySelector('.mon');
  const bed = g.game.map.beds[2];
  const s = g.game.renderer.project({ x: bed.x, y: 1.7, z: -11.8 });
  return { state: p.state, hooked: p.hooked, cardDisplay: card.style.display,
    cardXform: card.style.transform, proj: s ? [s.x | 0, s.y | 0] : null };
});
console.log(JSON.stringify(out)); await page.screenshot({ path: 'test-results/shots/mon-probe.png' });
await browser.close();
