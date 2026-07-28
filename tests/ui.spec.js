import { test, expect } from '@playwright/test';

// REAL UI-layer tests: press the actual DOM buttons like a thumb would.
// (The intent-injection tests bypass the UI — these exist because a CSS
// specificity bug once made every button ignore taps on devices.)
const url = '/?seed=11&lite=1';

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.setItem('medteam.seenTutorial', '1'); } catch { /* private */ } });
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
}

test('boot starts the game; SWAP toggles roles', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.start());
  await page.waitForFunction(() => window.__game.state().mode === 'playing');
  // you ARE the physician — the nurse is the swap-in sidekick
  expect((await page.evaluate(() => window.__game.state().active))).toBe('doctor');
  await page.locator('#btn-swap').dispatchEvent('pointerdown');
  await page.waitForFunction(() => window.__game.state().active === 'nurse');
});

test('joystick drag moves the character', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.start());
  const before = await page.evaluate(() => window.__game.state().chars[1].pos.x);
  // drag on the joystick zone with the mouse (same pointer pipeline)
  await page.mouse.move(180, 250);
  await page.mouse.down();
  await page.mouse.move(260, 250, { steps: 5 });
  await page.waitForTimeout(1500);
  await page.mouse.up();
  const after = await page.evaluate(() => window.__game.state().chars[1].pos.x);
  expect(after).toBeGreaterThan(before + 1);
});

test('GRAB button toggles: tap grabs, tap again lets go', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.start());
  await page.evaluate(() => {
    const g = window.__game;
    const id = g.spawnCase('strep', -19.5, 8.8);
    g.teleport('doctor', -20, 8);
    window.__pid = id;
  });
  await page.waitForTimeout(400);
  const grab = page.locator('#btn-grab');
  await grab.dispatchEvent('pointerdown');
  await page.waitForFunction(() => !!window.__game.game.doctor.dragging, null, { timeout: 5000 });
  await grab.dispatchEvent('pointerup');   // lifting the finger must NOT release
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => !!window.__game.game.doctor.dragging)).toBe(true);
  await grab.dispatchEvent('pointerdown'); // second tap lets go
  await page.waitForFunction(() => !window.__game.game.doctor.dragging);
});

test('contextual prompt button opens the med cabinet', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.start());
  await page.evaluate(() => window.__game.teleport('doctor', -6, 17.7));
  await page.waitForSelector('#prompt', { state: 'visible' });
  await page.locator('#prompt').dispatchEvent('pointerdown');
  await page.waitForFunction(() => window.__game.state().modal === 'cabinet');
  // pick a med through the real modal button
  await page.locator('#modal .medbtn').first().click();
  await page.waitForFunction(() => !!window.__game.state().chars[1].carrying);
});

test('MED-DOC is coin-op: sit → no credit blocks, coins boot the terminal', async ({ page }) => {
  test.setTimeout(45000);
  await boot(page);
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(400);

  // sit down at the green terminal's chair — the context action is SIT
  await page.evaluate(() => {
    const g = window.__game.game;
    const s = g.map.termSeats.find((t) => t.kind === 'meddoc');
    g.active.body.setTranslation({ x: s.x, y: g.active.pos.y, z: s.z + 0.9 }, true);
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__game.game.actionContext(window.__game.game.active)?.run());
  await page.waitForFunction(() => window.__game.game.active.seatedAt);

  // broke → INSERT COINS, and the slot click throws the red error screen
  expect(await page.locator('#modal .blink').textContent()).toContain('INSERT COINS');
  await page.locator('#slotbtn').click();
  await page.waitForSelector('#modal.errbox');
  expect(await page.locator('#modal .big').textContent()).toContain('INSUFFICIENT');

  // fund it, re-enter, insert — three-second boot, then the live terminal
  await page.evaluate(() => { window.__game.game.coins = 6; window.__game.game.ui.modals._medDocInsert(); });
  await page.locator('#slotbtn').click();
  await page.waitForSelector('.bootbar');                       // booting
  expect(await page.evaluate(() => window.__game.game.coins)).toBe(1); // five taken
  await page.waitForSelector('#crtbar', { timeout: 5000 });     // terminal up
  expect(await page.evaluate(() => window.__game.game.medDocSession)).toBe('live');

  // EXIT stands you up and burns the session — sitting again would cost 5 more
  await page.locator('#modal .close').click();
  await page.waitForFunction(() => !window.__game.game.active.seatedAt);
  expect(await page.evaluate(() => window.__game.game.medDocSession)).toBe(null);
});

test('treating a patient well drops a coin in the counter', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.start());
  const before = await page.evaluate(() => window.__game.game.coins);
  await page.evaluate(() => {
    const g = window.__game.game;
    g.awardCoin(g.active);
  });
  expect(await page.evaluate(() => window.__game.game.coins)).toBe(before + 1);
  // the flying coin element is live and the HUD tally moved
  await page.waitForFunction(() => document.querySelector('.coinfly')?.style.display === 'block');
  expect(await page.locator('#hud .coins .n').textContent()).toBe(String(before + 1));
});

test('quota met shows End-shift button; it ends the day', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(300);
  // not met yet → hidden
  expect(await page.locator('#endshift').isVisible()).toBe(false);
  await page.evaluate(() => { window.__game.game.dayStats.treated = window.__game.game.quota; });
  await page.waitForFunction(() => document.querySelector('#endshift')?.offsetParent !== null, null, { timeout: 4000 });
  await page.locator('#endshift').click();
  await page.waitForFunction(() => window.__game.game.mode === 'summary', null, { timeout: 4000 });
});

test('empty ED gets topped up mid-shift instead of going dead', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(300);
  const refilled = await page.evaluate(async () => {
    const g = window.__game.game;
    for (const pt of [...g.world.byTag('patients')]) g.removePatient(pt);
    g.clock.minutes = 700;                              // a historically dead stretch
    g.spawner.schedule.forEach((s) => { if (s.at < 700) s.done = true; });
    let peak = 0;
    for (let i = 0; i < 400; i++) { g.clock.minutes += 0.5; g.spawner.tick(); peak = Math.max(peak, g.spawner.activeCount()); }
    return peak;
  });
  expect(refilled).toBeGreaterThan(0);   // the department refilled itself
});

test('surgery board: tabbed categories, live filter, tap resolves the operation', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(300);

  const setup = await page.evaluate(async () => {
    const g = window.__game.game;
    const id = window.__game.spawnCase('appy', -20, 8);
    const pt = [...g.world.byTag('patients')].find((x) => x.id === id);
    pt.sim.state = 'inbed';
    window.__surgTask = { type: 'surgery', patient: pt };   // keep a ref to read .surgery
    g.ui.modals.surgeryPick(window.__surgTask);
    await new Promise((r) => setTimeout(r, 150));
    return {
      rows: document.querySelectorAll('.surgrow').length,
      tabs: document.querySelectorAll('.tab').length,
      hasKidney: [...document.querySelectorAll('.surgrow')].some((b) => b.dataset.s === 'stone_removal'),
    };
  });
  expect(setup.rows).toBeGreaterThan(30);      // a big menu, not one generic list
  expect(setup.tabs).toBeGreaterThanOrEqual(9);
  expect(setup.hasKidney).toBe(true);          // the reported case is now an option

  // live filter narrows without losing the modal
  const filtered = await page.evaluate(async () => {
    const i = document.querySelector('#surgbar');
    i.value = 'kidney'; i.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 80));
    return [...document.querySelectorAll('.surgrow')].filter((b) => b.style.display !== 'none').map((b) => b.dataset.s);
  });
  expect(filtered).toEqual(['stone_removal']);

  // the checkmark commits the top visible match through the intent pipe
  await page.locator('#surggo').click();
  await page.waitForFunction(() => window.__surgTask?.surgery?.id === 'stone_removal' && !window.__game.game.ui.modals.current, null, { timeout: 3000 });
});
