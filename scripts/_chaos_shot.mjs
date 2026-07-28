import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 900, height: 1600 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto('http://localhost:5199/?seed=9&lite=1');
await p.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await p.waitForSelector('#adumb button.exe', { timeout: 20000 });
await p.screenshot({ path: 'scripts/_shot_exam.png' });
await p.locator('#adumb button.exe').click();
await p.waitForTimeout(3500);
await p.screenshot({ path: 'scripts/_shot_examq1.png' });
// jump into chaos and let it settle
await p.evaluate(() => window.__game.startChaos());
await p.waitForTimeout(2500);
await p.screenshot({ path: 'scripts/_shot_chaos.png' });
const s = await p.evaluate(() => {
  const g = window.__game.game;
  return { chaos: g.chaos, pts: [...g.world.byTag('patients')].length,
    dead: [...g.world.byTag('patients')].filter((q) => q.sim.state === 'dead').length,
    pools: g.blood.pools.length, flames: g._chaosFx?.flames.length };
});
console.log('CHAOS', JSON.stringify(s));
await b.close();
