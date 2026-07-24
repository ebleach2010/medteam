import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:5199/?seed=7');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(400);

// 1: drag loops → thin heel skid lines
await page.evaluate(() => {
  const g = window.__game;
  g.spawnCase('strep', -24, 6);
  g.teleport('nurse', -24, 6.8);
  setTimeout(() => g.inject({ type: 'GRAB', actorId: g.game.nurse.id }), 200);
  const pts = [[-20, 8], [-17, 5], [-20, 2], [-24, 4], [-20, 8]];
  let i = 0;
  window.__drv = setInterval(() => {
    const c = g.game.nurse.pos;
    const [x, z] = pts[i % pts.length];
    const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
    if (d < 0.8) { i++; return; }
    g.inject({ type: 'MOVE', actorId: g.game.nurse.id, payload: { x: dx / d, z: dz / d } });
  }, 50);
});
await page.waitForTimeout(4500);
await page.screenshot({ path: 'test-results/shots/v3-skids.png' });
await page.evaluate(() => { clearInterval(window.__drv); const g = window.__game;
  g.inject({ type: 'MOVE', actorId: g.game.nurse.id, payload: { x: 0, z: 0 } });
  g.inject({ type: 'RELEASE', actorId: g.game.nurse.id }); });

// 2: clipboard peek near the pharmacy shelf
await page.evaluate(() => window.__game.teleport('nurse', -6, 17.7));
await page.waitForTimeout(600);
await page.screenshot({ path: 'test-results/shots/v3-peek.png' });

// 3: the tech's study board (auto-opens when you arrive at the machine)
await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const id = g.spawnCase('stroke_sah', -20, 8);
  await sleep(300);
  g.bedPatientTo(id, 7);
  g.orderImaging(id);
  while (!g.taskPhases().includes('imaging:awaitChoice')) await sleep(300);
  g.teleport('nurse', 7.2, -1.2);
});
await page.waitForFunction(() => window.__game.state().modal === 'study', null, { timeout: 30000 });
await page.waitForTimeout(600);
await page.screenshot({ path: 'test-results/shots/v3-studyboard.png' });
await browser.close();
