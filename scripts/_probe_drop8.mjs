// Drop-8 probe: 4 staff seated at the station, porter answers an imaging
// order (gets up, transports, board opens), wall screens show vitals, no
// DOM vitals cards exist.
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
page.on('pageerror', (e) => console.log('PAGE ERR:', String(e).slice(0, 300)));
await page.goto('http://localhost:5199/?seed=7&lite=1');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await page.locator('#screen .go').click();
await page.waitForFunction(() => window.__game.state().mode === 'playing');

// wait for everyone to sit
await page.waitForFunction(() => {
  const g = window.__game.game;
  return ['aide', 'porter', 'tech', 'surgeon'].every((k) => g[k].atPost);
}, null, { timeout: 30000 });
const seated = await page.evaluate(() => {
  const g = window.__game.game;
  return ['aide', 'surgeon', 'porter', 'tech'].map((k) => {
    const p = g[k].pos, h = g[k].home;
    return { k, d: +Math.hypot(p.x - h.x, p.z - h.z).toFixed(2) };
  });
});
console.log('seated:', JSON.stringify(seated));

// no DOM vitals cards should exist at all
console.log('DOM .mon cards:', await page.evaluate(() => document.querySelectorAll('.mon').length));

// bed a patient, check the wall screen paints, then order imaging
const res = await page.evaluate(async () => {
  const g = window.__game;
  const id = g.spawnCase('stroke_sah', -20, 8);
  await new Promise((r) => setTimeout(r, 400));
  g.bedPatientTo(id, 2); // Room 3
  await new Promise((r) => setTimeout(r, 2500));
  const gm = g.game;
  const rm = gm.map.roomMonitors[2];
  const px = rm.canvas.getContext('2d').getImageData(20, 55, 1, 1).data; // HR digit zone
  const painted = px[1] > 60; // green channel lit
  g.orderImaging(id);
  return { painted, hooked: [...gm.world.byTag('patients')][0].sim.hooked };
});
console.log('wall screen painted:', JSON.stringify(res));

// porter should rise and complete transport to the dock, then await choice
await page.waitForFunction(() => window.__game.taskPhases().includes('imaging:awaitChoice'), null, { timeout: 60000 });
console.log('porter delivered patient to diagnostics — awaitChoice reached');
const porterState = await page.evaluate(() => {
  const g = window.__game.game;
  return { atPost: g.porter.atPost, pos: { x: +g.porter.pos.x.toFixed(1), z: +g.porter.pos.z.toFixed(1) } };
});
console.log('porter:', JSON.stringify(porterState));

// player walks up, board should open, pick CT, scan completes
await page.evaluate(() => window.__game.teleport('doctor', 7.2, -1.2));
await page.waitForFunction(() => window.__game.state().modal === 'study', null, { timeout: 10000 });
await page.evaluate(() => {
  const g = window.__game;
  g.inject({ type: 'SELECT', actorId: g.game.doctor.id, payload: { modal: 'study', choice: 'CT' } });
});
await page.waitForFunction(() => window.__game.taskPhases().includes('imaging:scanning'), null, { timeout: 10000 });
await page.evaluate(() => window.__game.fastForwardImaging());
await page.waitForFunction(() => {
  const s = window.__game.state();
  return s.patients[0]?.state === 'inbed' && s.items.some((i) => i.label.startsWith('Imaging:'));
}, null, { timeout: 60000 });
console.log('scan done, report delivered, patient back in bed');

// porter heads home and sits again
await page.waitForFunction(() => window.__game.game.porter.atPost, null, { timeout: 40000 });
console.log('porter re-seated');

await browser.close();
console.log('PROBE 8 DONE');
