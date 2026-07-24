import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
let printed = 0;
page.on('pageerror', (e) => { if (printed++ < 3) console.log('PAGEERROR:', e.stack); });
await page.goto('http://localhost:5199/?lite=1&seed=7');
await page.waitForFunction(() => window.__game?.ready);
await page.evaluate(() => { document.querySelector('.go')?.click(); });
await page.waitForTimeout(600);
const out = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 9000) => { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) return false; await sleep(80); } return true; };
  const patient = (id) => g.state().patients.find((p) => p.id === id);
  const id = g.spawnCase('od', -24, -4.2);
  g.teleport('nurse', -24, -3.4);
  g.inject({ type: 'GRAB', actorId: g.game.nurse.id });
  const gotDrag = await until(() => g.game.nurse.dragging);
  const p = patient(id);
  return { gotDrag, pstate: p?.state, grabbable: g.game.world ? undefined : undefined,
           npos: g.game.nurse.pos, ppos: p?.pos, grabHeld: g.game.nurse.grabHeld };
});
console.log(JSON.stringify(out));
console.log('errors seen:', printed);
await browser.close();
