import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 900, height: 1600 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto('http://localhost:5199/?seed=9&lite=1');
await p.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await p.evaluate(() => window.__game.startChaos());
await p.waitForFunction(() => window.__game.game.chaos, null, { timeout: 10000 });
await p.waitForTimeout(2500);                      // let the patients bleed a bit
await p.screenshot({ path: 'scripts/_shot_blood.png' });  // blood radiating from patients
// hand over the mop and drag it through the ward in daylight
await p.evaluate(() => {
  const g = window.__game.game;
  g._lockNoon = true; g._chaosAlarms = false;
  const ch = g.active;
  g.__x = g._spawnMop(ch.pos.x + 1, ch.pos.z);
  g._mop = g.__x; g._mop.heldBy = ch; ch.carrying = g._mop;
  g.teleport?.('doctor', -18, 2);
});
await p.evaluate(() => {
  const g = window.__game;
  const a = g.game.active;
  g.game._rh = setInterval(() => g.inject({ type: 'MOVE', actorId: a.id, payload: { x: -0.4, z: 0.4 } }), 30);
});
await p.waitForTimeout(1600);
await p.screenshot({ path: 'scripts/_shot_mop.png' });    // dragging the mop
await p.evaluate(() => clearInterval(window.__game.game._rh));
console.log('OK');
await b.close();
