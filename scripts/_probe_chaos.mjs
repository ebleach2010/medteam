// angry rampage + prop shoving + lab panel flow + pinned monitor smoke test
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:5199/?seed=7&lite=1');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(500);
const out = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, tag) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return 'TIMEOUT:' + tag; await sleep(150); } return null; };
  const res = {};
  // props spawned?
  res.props = g.state().items.filter((i) => i.kind === 'prop').length;
  // force a patient angry → should rampage the lobby and move props
  const id = g.spawnCase('strep', -22, 13);
  await sleep(400);
  const p = [...g.game.world.byTag('patients')].find((q) => q.id === id);
  p.sim.state = 'angry'; p.setFace('angry');
  const before = g.state().items.filter((i) => i.kind === 'prop').map((i) => [i.pos.x, i.pos.z]);
  await sleep(9000);
  const after = g.state().items.filter((i) => i.kind === 'prop').map((i) => [i.pos.x, i.pos.z]);
  res.propMoved = before.some((b, i) => Math.hypot(b[0] - after[i][0], b[1] - after[i][1]) > 0.5);
  const pp = p.body.translation();
  res.angryInLobby = pp.z > 8; // still rampaging the waiting area, not chasing staff
  p.sim.state = 'waiting';
  // labs await-choice flow
  const id2 = g.spawnCase('sepsis', -20, 8);
  await sleep(300);
  g.bedPatientTo(id2, 1);
  g.game.orderLabs([...g.game.world.byTag('patients')].find((q) => q.id === id2)); // NO panels
  res.e1 = await until(() => g.taskPhases().includes('labs:awaitChoice'), 30000, 'awaitChoice');
  const bed = g.game.map.beds[1];
  g.teleport('nurse', bed.x + 1.0, bed.z + 1.1);
  res.e2 = await until(() => g.state().modal === 'labs_order', 8000, 'labboard');
  g.inject({ type: 'SELECT', actorId: g.game.nurse.id, payload: { modal: 'labs_order', choice: ['CBC', 'LACT', 'INFECT'] } });
  res.e3 = await until(() => g.taskPhases().includes('labs:toLab') || g.taskPhases().includes('labs:draw'), 8000, 'grab');
  return res;
});
console.log(JSON.stringify(out));
await browser.close();
