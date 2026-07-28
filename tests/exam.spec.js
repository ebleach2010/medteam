import { test, expect } from '@playwright/test';

// The A-DUMB COMPUTER — IQ Boards exam. The opening screen every real player
// sees: an unpassable quiz whose only exit is ten simultaneously crashing
// patients. These tests walk the REAL DOM the way a thumb would.
const url = '/?seed=9&lite=1';

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.setItem('medteam.seenTutorial', '1'); } catch {} });
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
}

// wait until the newest .resp line contains the text (typewriter needs time)
async function awaitResp(page, text, ms = 8000) {
  await page.waitForFunction(
    (t) => [...document.querySelectorAll('#adumb .resp')].some((el) => el.textContent.includes(t)),
    text, { timeout: ms },
  );
}

test('the exam is unpassable and every scripted answer is wrong on cue', async ({ page }) => {
  test.setTimeout(180000);
  await boot(page);

  // the shutdown notice + the blinking .exe button
  await page.waitForSelector('#adumb', { timeout: 8000 });
  await page.waitForSelector('#adumb button.exe', { timeout: 30000 });
  const notice = await page.locator('#adumb .crt-body').textContent();
  expect(notice).toContain('SHUT DOWN');
  await page.locator('#adumb button.exe').click();

  // timer is running
  await page.waitForFunction(() => /9:5\d/.test(document.querySelector('#adtimer')?.textContent ?? ''), null, { timeout: 15000 });

  // Q1 — A is wrong, and so is trying again
  await page.waitForFunction(() => [...document.querySelectorAll('#adumb button')].some((b) => b.textContent === 'A'), null, { timeout: 30000 });
  await page.locator('#adumb button', { hasText: /^A$/ }).click();
  await awaitResp(page, 'Wring answer. Correct answer: C');
  await awaitResp(page, 'try the question again');
  await page.locator('#adumb button', { hasText: /^Y$/ }).click();
  await awaitResp(page, 'There’s no time. Next question');

  // Q2 — emotional intelligence is on the z axis, obviously
  await page.waitForSelector('#adumb input[type=range]', { timeout: 20000 });
  await page.locator('#adumb .inrow button').click();
  await awaitResp(page, 'z axis because it requires depth');
  await awaitResp(page, 'this isn’t looking good');

  // Q3 — even "orange" is not the slant rhyme it was looking for
  await page.waitForSelector('#adumb input[type=text]', { timeout: 20000 });
  await page.locator('#adumb input[type=text]').fill('orange');
  await page.locator('#adumb .inrow button').click();
  await awaitResp(page, 'not the slant rhyme I was looking for');

  // Q4 — no points for being clever
  await page.waitForSelector('#adumb input[type=text]', { timeout: 20000 });
  await page.locator('#adumb input[type=text]').fill('a plunger');
  await page.locator('#adumb .inrow button').click();
  await awaitResp(page, 'no points for being clever');

  // Q4 again — zero is correct and worth nothing
  await page.waitForSelector('#adumb input[type=range]', { timeout: 20000 });
  await page.locator('#adumb input[type=range]').fill('0');
  await page.locator('#adumb .inrow button').click();
  await awaitResp(page, 'No points awarded for that correct answer');

  // Q5 — the only correct age is 'this many'
  await page.waitForSelector('#adumb input[type=text]', { timeout: 20000 });
  await page.locator('#adumb input[type=text]').fill('34');
  await page.locator('#adumb .inrow button').click();
  await awaitResp(page, 'this many');

  // QUESTION SIX — and the mask comes off
  await page.waitForSelector('#adumb input[type=text]', { timeout: 20000 });
  await page.locator('#adumb input[type=text]').fill('666');
  await page.locator('#adumb .inrow button').click();
  await page.waitForFunction(
    () => [...document.querySelectorAll('#adumb .wtf')].some((el) => el.textContent.includes('TEN PATIENTS STARTED CRASHING')),
    null, { timeout: 20000 },
  );

  // the CRT powers down onto the disaster: chaos mode, ten patients, all dire
  await page.waitForFunction(() => window.__game.game.chaos === true, null, { timeout: 15000 });
  const state = await page.evaluate(() => {
    const g = window.__game.game;
    const pts = [...g.world.byTag('patients')];
    return {
      n: pts.length,
      critical: pts.filter((p) => p.sim.critical).length,
      bedded: pts.filter((p) => p.sim.bed).length,
      pools: g.blood.pools.length,
      alarms: g._chaosAlarms,
    };
  });
  expect(state.n).toBe(10);
  expect(state.critical).toBe(10);
  expect(state.bedded).toBe(6);         // every bed full; the rest dying in the lobby
  expect(state.pools).toBeGreaterThan(5); // the floor is already wet
  expect(state.alarms).toBe(true);
});

test('chaos: 10-min grace, then janitor → mop → gunman → You Died → BSOD', async ({ page }) => {
  test.setTimeout(150000);
  await boot(page);
  await page.evaluate(() => window.__game.startChaos());
  await page.waitForFunction(() => window.__game.game.chaos === true, null, { timeout: 10000 });

  // nobody dies inside the ten-minute grace window — every fuse sits out past it
  const graceOk = await page.evaluate(() => {
    const g = window.__game.game;
    return g.timers.filter((t) => t.at - g.timeReal > 500).length >= 10;
  });
  expect(graceOk).toBe(true);

  // burn every fuse → they die off → the janitor scene begins
  await page.evaluate(() => { const g = window.__game.game; for (const t of g.timers) t.at = g.timeReal; });
  await page.waitForFunction(() =>
    [...window.__game.game.world.byTag('patients')].every((p) => p.sim.state === 'dead'), null, { timeout: 15000 });
  await page.waitForFunction(() => !!window.__game.game._cut, null, { timeout: 12000 });
  // skip the long walk: put the janitor at the player's elbow
  await page.evaluate(() => {
    const g = window.__game.game, c = g._cut, ap = g.active.pos;
    c.route = [];
    c.npc.body.setTranslation({ x: ap.x + 1.2, y: 1, z: ap.z }, true);
  });
  // the line is said, the mop is handed over, daylight locks over the wreckage
  await page.waitForFunction(() => !!window.__game.game._mop?.heldBy, null, { timeout: 20000 });
  expect(await page.evaluate(() => window.__game.game._lockNoon)).toBe(true);
  expect(await page.evaluate(() => !window.__game.game._chaosAlarms)).toBe(true);

  // the mop only ever spreads the blood — drag the head through a pool on
  // open floor and the pool count goes UP, never down
  const smear = await page.evaluate(async () => {
    const g = window.__game.game;
    for (let k = 0; k < 6; k++) g.blood.addAt(-20 + k * 0.01, 8, 0.3); // a saturated pool, clear of furniture
    const poolsBefore = g.blood.pools.length;
    const ch = g._mop.heldBy;
    let grew = false;
    for (let i = 0; i < 300; i++) {
      ch.body.setTranslation({ x: -20.6, y: 1, z: 8 }, true);
      ch.yaw = Math.PI / 2;                                  // pushing the mop toward +x
      ch.body.setLinvel({ x: 2.5, y: 0, z: 0 }, true);
      g._mop.body.setTranslation({ x: -20.0, y: 0.18, z: 8 }, true);
      g.blood._mopSmear();
      if (g.blood.pools.length > poolsBefore) { grew = true; break; }
      await new Promise((r) => setTimeout(r, 10));
    }
    return { grew, poolsBefore, poolsAfter: g.blood.pools.length };
  });
  expect(smear.grew).toBe(true);

  // three minutes of mopping later: the gunman
  await page.evaluate(() => {
    const g = window.__game.game;
    if (g._cut) { g._despawnConsultant(g._cut.npc); g._cut = null; }  // hurry the janitor out
    g._mopT = 180;
  });
  await page.waitForFunction(() => window.__game.game._cut?.phase?.startsWith('gunman'), null, { timeout: 10000 });
  await page.evaluate(() => {
    const g = window.__game.game, c = g._cut, ap = g.active.pos;
    c.route = [];
    c.npc.body.setTranslation({ x: ap.x + 3.4, y: 1, z: ap.z }, true);
  });
  await page.waitForFunction(() => window.__game.game._shotFired === true, null, { timeout: 15000 });

  // ten seconds later: the slow fade, You Died, and both answers are the BSOD
  await page.evaluate(() => { const g = window.__game.game; for (const t of g.timers) t.at = g.timeReal; });
  await page.waitForSelector('#youdied', { timeout: 15000 });
  await page.locator('#yd-y').click();
  await page.waitForSelector('#bsod', { timeout: 5000 });
  expect(await page.locator('#bsod').textContent()).toContain('CRITICAL PROCESS DIED');
  expect(await page.evaluate(() => window.__game.game.paused)).toBe(true); // nothing runs behind the blue
});
