// Probe the drop-7 fixes: doctor default, seated staff, yes/no talk engine,
// vitals cards not clamped on-screen, prop labels suppressed.
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERR:', m.text()); });
await page.goto('http://localhost:5199/?seed=7&lite=1');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await page.locator('#screen .go').click();
await page.waitForFunction(() => window.__game.state().mode === 'playing');

const out = await page.evaluate(() => {
  const g = window.__game.game;
  const r = {};
  r.active = g.active.role;
  r.homes = ['aide', 'porter', 'tech', 'surgeon'].map((k) => ({ k, home: !!g[k].home }));
  return r;
});
console.log('active:', out.active, '| homes:', JSON.stringify(out.homes));

// let staff walk home and sit
await page.evaluate(() => window.__game.setTimeScale(6));
await page.waitForTimeout(6000);
await page.evaluate(() => window.__game.setTimeScale(1));
const posts = await page.evaluate(() => {
  const g = window.__game.game;
  return ['aide', 'porter', 'tech', 'surgeon'].map((k) => {
    const c = g[k], h = c.home, p = c.pos;
    return { k, atPost: !!c.atPost, d: h ? +Math.hypot(h.x - p.x, h.z - p.z).toFixed(2) : -1 };
  });
});
console.log('posts:', JSON.stringify(posts));

// yes/no talk engine — spawn a tinea (oozing toe-adjacent) + strep
const talk = await page.evaluate(() => {
  const g = window.__game.game;
  const id = window.__game.spawnCase('tinea', -20, 8);
  const p = [...g.world.byTag('patients')].find((q) => q.id === id);
  const mod = (q) => {
    const { answerQuestion } = window.__talkDbg ?? {};
    return null;
  };
  return { case: p.sim.case.id, physical: p.sim.case.physical };
});
console.log('tinea physical:', JSON.stringify(talk));

await page.screenshot({ path: 'test-results/probe7-station.png' });

// teleport doctor to the nurses station for a look
await page.evaluate(() => window.__game.teleport('doctor', -16, 2));
await page.waitForTimeout(800);
await page.screenshot({ path: 'test-results/probe7-station-close.png' });

// vitals cards: bed a patient, walk far away, card should disappear
const cardCheck = await page.evaluate(async () => {
  const g = window.__game.game;
  const id = window.__game.spawnCase('strep', -3, -8);
  const p = [...g.world.byTag('patients')].find((q) => q.id === id);
  p.sim.hooked = true;
  p.sim.bed = g.map.beds?.[0] ?? { x: -3, z: -9 };
  window.__game.teleport('doctor', -3, -6);
  await new Promise((r) => setTimeout(r, 700));
  const nearVis = [...document.querySelectorAll('.mon')].some((el) => el.style.display !== 'none');
  window.__game.teleport('doctor', 24, 16);
  await new Promise((r) => setTimeout(r, 700));
  const farVis = [...document.querySelectorAll('.mon')].some((el) => el.style.display !== 'none');
  return { nearVis, farVis };
});
console.log('vitals card near/far:', JSON.stringify(cardCheck));

// prop labels: stand in the lobby among the props — no name tags for props
const labels = await page.evaluate(async () => {
  window.__game.teleport('doctor', -21, 13);
  await new Promise((r) => setTimeout(r, 700));
  return [...document.querySelectorAll('.item-label')].filter((el) => el.style.display !== 'none').map((el) => el.textContent);
});
console.log('visible item tags in lobby:', JSON.stringify(labels));
await page.screenshot({ path: 'test-results/probe7-lobby.png' });

await browser.close();
console.log('PROBE DONE');
