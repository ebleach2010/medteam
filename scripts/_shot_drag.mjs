import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:5199/?seed=7');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const g = window.__game;
  const id = g.spawnCase('strep', -24, 6);
  g.teleport('nurse', -24, 6.8);
  setTimeout(() => g.inject({ type: 'GRAB', actorId: g.game.nurse.id }), 200);
  // endless figure-eight haul through open triage floor
  const pts = [[-20, 8], [-17, 5], [-20, 2], [-24, 4], [-20, 8]];
  let i = 0;
  setInterval(() => {
    const c = g.game.nurse.pos;
    const [x, z] = pts[i % pts.length];
    const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
    if (d < 0.8) { i++; return; }
    g.inject({ type: 'MOVE', actorId: g.game.nurse.id, payload: { x: dx / d, z: dz / d } });
  }, 50);
});
await page.waitForTimeout(4500);
await page.screenshot({ path: 'test-results/shots/drag-skids.png' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'test-results/shots/drag-skids2.png' });
await browser.close();
