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

test('chaos: the fuses kill the untreated, and the ending is a mop that only smears', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await page.evaluate(() => window.__game.startChaos());
  await page.waitForFunction(() => window.__game.game.chaos === true, null, { timeout: 10000 });

  const out = await page.evaluate(async () => {
    const g = window.__game.game;
    const until = async (fn, ms) => {
      const t0 = Date.now();
      while (!fn()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 100)); }
      return true;
    };
    // burn every fuse now — nobody was treated in time
    for (const t of g.timers) t.at = g.timeReal;
    const allDead = await until(() => [...g.world.byTag('patients')].every((p) => p.sim.state === 'dead'), 15000);
    // ...and the ending arrives: silence, and a mop
    const mopped = await until(() => !!g._mop, 10000);
    const poolsBefore = g.blood.pools.length;
    // carrying the mop across the blood only makes MORE blood
    const ch = g.active;
    g._mop.heldBy = ch; ch.carrying = g._mop;
    const pool = g.blood.pools[0];
    ch.body.setTranslation({ x: pool.x, y: 1, z: pool.z }, true);
    ch.body.setLinvel({ x: 2.5, y: 0, z: 0 }, true);
    let grew = false;
    for (let i = 0; i < 240; i++) {
      g.blood._mopSmear();
      if (g.blood.pools.length > poolsBefore) { grew = true; break; }
      await new Promise((r) => setTimeout(r, 10));
    }
    return { allDead, mopped, alarmsOff: !g._chaosAlarms, grew, poolsBefore, poolsAfter: g.blood.pools.length };
  });

  expect(out.allDead).toBe(true);
  expect(out.mopped).toBe(true);        // failure is also rewarded with a mop
  expect(out.alarmsOff).toBe(true);     // the silent part of the silent ending
  expect(out.grew).toBe(true);          // the mop only ever spreads it
});
