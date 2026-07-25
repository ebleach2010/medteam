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

test('title button starts the game; SWAP toggles roles', async ({ page }) => {
  await boot(page);
  await page.locator('#screen .go').click();
  await page.waitForFunction(() => window.__game.state().mode === 'playing');
  // you ARE the physician — the nurse is the swap-in sidekick
  expect((await page.evaluate(() => window.__game.state().active))).toBe('doctor');
  await page.locator('#btn-swap').dispatchEvent('pointerdown');
  await page.waitForFunction(() => window.__game.state().active === 'nurse');
});

test('joystick drag moves the character', async ({ page }) => {
  await boot(page);
  await page.locator('#screen .go').click();
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
  await page.locator('#screen .go').click();
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
  await page.locator('#screen .go').click();
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
  await page.locator('#screen .go').click();
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
  await page.locator('#screen .go').click();
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
  await page.locator('#screen .go').click();
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
  await page.locator('#screen .go').click();
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

test('Adam computer: sit pauses, chat logs + persists, PIN unlocks admin + CSV', async ({ page }) => {
  test.setTimeout(45000);
  await page.addInitScript(() => {
    try { localStorage.setItem('medteam.seenTutorial', '1'); localStorage.setItem('medteam.openai_key', 'sk-test'); } catch { /* private */ }
    const _f = window.fetch;
    window.fetch = (u, o) => String(u).includes('api.openai.com')
      ? Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'Noted, Adam.' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      : _f(u, o);
  });
  await page.goto('/?seed=3&lite=1');
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
  await page.locator('#screen .go').click();
  await page.waitForTimeout(300);

  // sit at the Adam kiosk → modal opens AND the game pauses
  await page.evaluate(async () => {
    const g = window.__game.game;
    const s = g.map.termSeats.find((t) => t.kind === 'adam');
    g.active.body.setTranslation({ x: s.x, y: g.active.pos.y, z: s.z + 0.9 }, true);
    await new Promise((r) => setTimeout(r, 250));
    g.actionContext(g.active)?.run();
  });
  await page.waitForSelector('#adambar', { timeout: 4000 });
  expect(await page.evaluate(() => window.__game.game.paused)).toBe(true);

  // a chat turn logs the message AND persists the reply (both roles)
  await page.locator('#adambar').fill('She never listens to me');
  await page.locator('#adambar').press('Enter');
  await page.waitForFunction(() => {
    const log = JSON.parse(localStorage.getItem('medteam.adam.log') || '[]');
    return log.some((l) => l.role === 'adam');
  }, null, { timeout: 6000 });
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('medteam.adam.log') || '[]'));
  expect(log.map((l) => l.role)).toEqual(['you', 'adam']);   // exactly one of each — no duplication

  // a non-password number does NOT open admin
  await page.locator('#adambar').fill('999999');
  await page.locator('#adambar').press('Enter');
  await page.waitForTimeout(300);
  expect(await page.locator('#adamcsv').count()).toBe(0);

  // the secret PIN unlocks the admin log + CSV export
  await page.locator('#adambar').fill('410410');
  await page.locator('#adambar').press('Enter');
  await page.waitForSelector('#adamcsv', { timeout: 3000 });
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 4000 }),
    page.locator('#adamcsv').click(),
  ]);
  expect(dl.suggestedFilename()).toBe('adam-logs.csv');

  // standing up closes it and unpauses
  await page.evaluate(() => window.__game.game.leaveTerminal(window.__game.game.active));
  await page.waitForFunction(() => window.__game.game.paused === false && !window.__game.game.active.seatedAt, null, { timeout: 3000 });

  // the log persists — reopening shows the prior conversation
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('medteam.adam.log') || '[]').length);
  expect(persisted).toBeGreaterThanOrEqual(2);
});

test('Adam computer: proxy path is keyless and sends no key to the client', async ({ page }) => {
  test.setTimeout(30000);
  let proxyHits = 0, sawAuthHeader = false;
  await page.addInitScript(() => {
    try { localStorage.setItem('medteam.seenTutorial', '1'); } catch { /* private */ }
    // configure a proxy URL at runtime (no local OpenAI key set at all)
    globalThis.__ADAM_PROXY_URL = 'https://adam-proxy.test/relay';
    const _f = window.fetch;
    window.fetch = (u, o) => {
      if (String(u).includes('adam-proxy.test')) {
        window.__proxyAuth = !!(o && o.headers && (o.headers.Authorization || o.headers.authorization));
        window.__proxyCount = (window.__proxyCount || 0) + 1;
        return Promise.resolve(new Response(JSON.stringify({ reply: 'Noted, Adam.' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return _f(u, o);
    };
  });
  await page.goto('/?seed=3&lite=1');
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
  await page.locator('#screen .go').click();
  await page.waitForTimeout(300);

  // sit at Adam — with a proxy configured and NO key stored, it must go
  // straight to chat (no key prompt)
  await page.evaluate(async () => {
    const g = window.__game.game;
    const s = g.map.termSeats.find((t) => t.kind === 'adam');
    g.active.body.setTranslation({ x: s.x, y: g.active.pos.y, z: s.z + 0.9 }, true);
    await new Promise((r) => setTimeout(r, 250));
    g.actionContext(g.active)?.run();
  });
  await page.waitForSelector('#adambar', { timeout: 4000 });
  expect(await page.locator('#adamkey').count()).toBe(0);          // no key prompt
  expect(await page.evaluate(() => localStorage.getItem('medteam.openai_key'))).toBeNull();

  // a turn hits the PROXY, not OpenAI, and carries no Authorization header
  await page.locator('#adambar').fill('hello');
  await page.locator('#adambar').press('Enter');
  await page.waitForFunction(() => (window.__proxyCount || 0) >= 1, null, { timeout: 6000 });
  expect(await page.evaluate(() => window.__proxyAuth)).toBe(false);  // client sent no key
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('medteam.adam.log') || '[]'));
  expect(log.map((l) => l.role)).toEqual(['you', 'adam']);
});
