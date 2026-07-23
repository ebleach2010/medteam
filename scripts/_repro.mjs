import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 844, height: 390 } });
p.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0, 300)));
await p.goto('http://localhost:5199/?seed=1337'); // the artifact's default seed
await p.waitForFunction(() => window.__game?.ready, null, { timeout: 30000 });
await p.evaluate(() => window.__game.start());
// watch the first two natural arrivals for 40s — where do they end up?
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(5000);
  const st = await p.evaluate(() => {
    const s = window.__game.state();
    return {
      min: Math.round(s.minutes),
      pts: s.patients.map(q => ({
        st: q.state, sit: window.__game.game.world.entities.get(q.id)?.sim.sitting ?? null,
        x: +q.pos.x.toFixed(1), z: +q.pos.z.toFixed(1),
      })),
    };
  });
  console.log(JSON.stringify(st));
  if (st.pts.length >= 2 && i >= 4) break;
}
// teleport nurse to the first patient and check what interaction is available
const check = await p.evaluate(() => {
  const g = window.__game;
  const pt = g.state().patients[0];
  if (!pt) return null;
  g.teleport('nurse', pt.pos.x, pt.pos.z + 1.0);
  return new Promise(res => setTimeout(() => {
    const ctx = g.game.actionContext(g.game.nurse);
    g.inject({ type: 'GRAB', actorId: g.game.nurse.id });
    setTimeout(() => res({
      actionLabel: ctx?.label ?? null,
      dragging: !!g.game.nurse.dragging,
      ptState: g.state().patients[0]?.state,
    }), 800);
  }, 300));
});
console.log('INTERACT:', JSON.stringify(check));
await p.screenshot({ path: 'test-results/shots/repro.png' });
await b.close();
