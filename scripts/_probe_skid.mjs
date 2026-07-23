import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
await page.goto('http://localhost:5199/?seed=7');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(400);
const out = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  g.spawnCase('strep', -24, 6);
  g.teleport('nurse', -24, 6.8);
  await sleep(250);
  g.inject({ type: 'GRAB', actorId: g.game.nurse.id });
  await sleep(400);
  const pts = [[-20, 8], [-17, 5], [-20, 2], [-24, 4]];
  let i = 0;
  const samples = [];
  for (let t = 0; t < 120; t++) {
    const c = g.game.nurse.pos;
    const [x, z] = pts[i % pts.length];
    const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
    if (d < 0.8) i++;
    else g.inject({ type: 'MOVE', actorId: g.game.nurse.id, payload: { x: dx / d, z: dz / d } });
    if (t % 20 === 19) {
      const vis = g.game.fx.skids.filter((f) => f.mesh.visible).length;
      const drag = !!g.game.nurse.dragging;
      const pp = g.game.nurse.dragging?.body.translation();
      samples.push({ t, vis, drag, npos: [c.x.toFixed(1), c.z.toFixed(1)],
        pp: pp ? [pp.x.toFixed(1), pp.y.toFixed(2), pp.z.toFixed(1)] : null,
        lastSkid: g.game.nurse._lastSkid ? 1 : 0 });
    }
    await sleep(50);
  }
  return samples;
});
console.log(JSON.stringify(out));
await browser.close();
