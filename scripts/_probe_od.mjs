// Reproduce the OD test's naloxone step and log positions/state every 500ms.
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
let peCount = 0;
page.on('pageerror', (e) => { if (peCount++ < 2) console.log('PAGEERROR:', e.stack); });
await page.goto('http://localhost:5199/?seed=7&lite=1');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(300);

const out = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(60); } return true; };
  const patient = (id) => g.state().patients.find((p) => p.id === id);
  const drive = async (role, pts) => {
    const ch = g.game[role];
    for (const [x, z] of pts) {
      await new Promise((res) => {
        const t = setInterval(() => {
          const c = ch.pos;
          const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
          if (d < 0.8) { clearInterval(t); g.inject({ type: 'MOVE', actorId: ch.id, payload: { x: 0, z: 0 } }); res(); return; }
          g.inject({ type: 'MOVE', actorId: ch.id, payload: { x: dx / d, z: dz / d } });
        }, 16);
        setTimeout(() => { clearInterval(t); res(); }, 14000);
      });
    }
  };

  const id = g.spawnCase('od', -24, -4.2);
  g.teleport('nurse', -24, -3.4);
  g.inject({ type: 'GRAB', actorId: g.game.nurse.id });
  const gotDrag = await until(() => g.game.nurse.dragging);
  if (!gotDrag) return { fail: 'no drag' };
  await drive('nurse', [[-24, -3.8], [-24, -5.8], [-24.5, -9.2]]);
  g.inject({ type: 'RELEASE', actorId: g.game.nurse.id });
  const bedded = await until(() => patient(id).state === 'inbed', 15000);
  if (!bedded) {
    const p = patient(id); const n = g.game.nurse.pos;
    return { fail: 'never inbed', state: p.state, ppos: p.pos, npos: { x: n.x, z: n.z } };
  }

  const bp0 = patient(id).pos;
  g.teleport('nurse', bp0.x + 1.0, bp0.z + 1.1);
  const fine = [];
  for (let i = 0; i < 14; i++) {
    const n = g.game.nurse.pos, v = g.game.nurse.body.linvel();
    fine.push({ ms: i * 100, n: [n.x.toFixed(2), n.z.toFixed(2)],
      v: [v.x.toFixed(1), v.z.toFixed(1)], mv: [g.game.nurse.move.x.toFixed(2), g.game.nurse.move.z.toFixed(2)] });
    await sleep(100);
  }
  window.__fine = fine;
  const { spawnCarryable } = await import('/src/entities/Carryable.js');
  const c = g.game.nurse.pos;
  const item = spawnCarryable(g.game, 'med', c.x, 1, c.z, { medId: 'naloxone', color: 0x5da8ff, label: 'Naloxone' });
  g.game.nurse.carrying = item; item.heldBy = g.game.nurse;

  const log = [];
  for (let i = 0; i < 30; i++) {
    const p = patient(id);
    const n = g.game.nurse.pos;
    log.push({ t: i * 0.5, state: p.state,
      n: [n.x.toFixed(2), n.z.toFixed(2)], pp: [p.pos.x.toFixed(2), p.pos.z.toFixed(2)],
      dist: Math.hypot(p.pos.x - n.x, p.pos.z - n.z).toFixed(2),
      dwell: g.game.nurse.medDwell.toFixed(2),
      kind: g.game.nurse.carrying?.itemKind ?? null });
    if (p.state === 'agitated') break;
    await sleep(500);
  }
  return { log, fine: window.__fine };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
