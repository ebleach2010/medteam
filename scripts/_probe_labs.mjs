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
  const until = async (fn, ms, tag) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return 'TIMEOUT:' + tag; await sleep(150); } return null; };
  const patient = (id) => g.state().patients.find((p) => p.id === id);
  const id = g.spawnCase('sepsis', -20, 8);
  await sleep(300);
  g.bedPatientTo(id, 1);          // Room 2
  g.orderLabs(id);
  const steps = [];
  let e;
  e = await until(() => g.taskPhases().includes('labs:toLab'), 20000, 'grab'); if (e) return { e, steps };
  steps.push('aide dragging to lab');
  e = await until(() => g.taskPhases().includes('labs:waitSpin'), 40000, 'draw'); if (e) return { e, steps, phases: g.taskPhases() };
  steps.push('drawn + spinning');
  g.centrifugeFastForward();
  e = await until(() => g.taskPhases().includes('labs:toRoomBack'), 20000, 'paper'); if (e) return { e, steps };
  steps.push('dragging back with results');
  e = await until(() => patient(id)?.state === 'inbed' &&
    g.state().items.some((i) => i.kind === 'paper' && !i.held), 60000, 'rebed'); if (e) return { e, steps, st: patient(id)?.state, phases: g.taskPhases() };
  steps.push('re-bedded, clipboard on desk');
  return { ok: true, steps, lab: patient(id).lab };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
