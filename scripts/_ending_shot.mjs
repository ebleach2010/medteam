import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 900, height: 1600 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto('http://localhost:5199/?seed=9&lite=1');
await p.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await p.evaluate(() => window.__game.startChaos());
await p.waitForFunction(() => window.__game.game.chaos, null, { timeout: 10000 });
await p.evaluate(() => { const g = window.__game.game; for (const t of g.timers) t.at = g.timeReal; });
await p.waitForFunction(() => !!window.__game.game._cut, null, { timeout: 15000 });
await p.evaluate(() => {
  const g = window.__game.game, c = g._cut, ap = g.active.pos;
  c.route = []; c.npc.body.setTranslation({ x: ap.x + 1.2, y: 1, z: ap.z }, true);
});
await p.waitForFunction(() => !!window.__game.game._mop?.heldBy, null, { timeout: 20000 });
await p.waitForTimeout(1200);
await p.screenshot({ path: 'scripts/_shot_janitor.png' });   // daytime wreck + janitor + mop
await p.evaluate(() => {
  const g = window.__game.game;
  if (g._cut) { g._despawnConsultant(g._cut.npc); g._cut = null; }
  g._mopT = 180;
});
await p.waitForFunction(() => window.__game.game._cut?.phase?.startsWith('gunman'), null, { timeout: 10000 });
await p.evaluate(() => {
  const g = window.__game.game, c = g._cut, ap = g.active.pos;
  c.route = []; c.npc.body.setTranslation({ x: ap.x + 3.4, y: 1, z: ap.z }, true);
});
await p.waitForFunction(() => window.__game.game._shotFired, null, { timeout: 15000 });
await p.waitForTimeout(1100);   // mid-ragdoll through the blood
await p.screenshot({ path: 'scripts/_shot_ragdoll.png' });
await p.evaluate(() => { const g = window.__game.game; for (const t of g.timers) t.at = g.timeReal; });
await p.waitForSelector('#youdied', { timeout: 15000 });
await p.screenshot({ path: 'scripts/_shot_youdied.png' });
await p.locator('#yd-n').click();
await p.waitForSelector('#bsod', { timeout: 5000 });
await p.screenshot({ path: 'scripts/_shot_bsod.png' });
console.log('OK all scenes captured');
await b.close();
