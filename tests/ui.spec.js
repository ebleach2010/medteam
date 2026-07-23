import { test, expect } from '@playwright/test';

// REAL UI-layer tests: press the actual DOM buttons like a thumb would.
// (The intent-injection tests bypass the UI — these exist because a CSS
// specificity bug once made every button ignore taps on devices.)
const url = '/?seed=11&lite=1';

async function boot(page) {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
}

test('title button starts the game; SWAP toggles roles', async ({ page }) => {
  await boot(page);
  await page.locator('#screen .go').click();
  await page.waitForFunction(() => window.__game.state().mode === 'playing');
  expect((await page.evaluate(() => window.__game.state().active))).toBe('nurse');
  await page.locator('#btn-swap').dispatchEvent('pointerdown');
  await page.waitForFunction(() => window.__game.state().active === 'doctor');
});

test('joystick drag moves the character', async ({ page }) => {
  await boot(page);
  await page.locator('#screen .go').click();
  const before = await page.evaluate(() => window.__game.state().chars[0].pos.x);
  // drag on the left-half joystick zone with the mouse (same pointer pipeline)
  await page.mouse.move(180, 250);
  await page.mouse.down();
  await page.mouse.move(260, 250, { steps: 5 });
  await page.waitForTimeout(1500);
  await page.mouse.up();
  const after = await page.evaluate(() => window.__game.state().chars[0].pos.x);
  expect(after).toBeGreaterThan(before + 1);
});

test('GRAB button toggles: tap grabs, tap again lets go', async ({ page }) => {
  await boot(page);
  await page.locator('#screen .go').click();
  await page.evaluate(() => {
    const g = window.__game;
    const id = g.spawnCase('strep', -19.5, 8.8);
    g.teleport('nurse', -20, 8);
    window.__pid = id;
  });
  await page.waitForTimeout(400);
  const grab = page.locator('#btn-grab');
  await grab.dispatchEvent('pointerdown');
  await page.waitForFunction(() => !!window.__game.game.nurse.dragging, null, { timeout: 5000 });
  await grab.dispatchEvent('pointerup');   // lifting the finger must NOT release
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => !!window.__game.game.nurse.dragging)).toBe(true);
  await grab.dispatchEvent('pointerdown'); // second tap lets go
  await page.waitForFunction(() => !window.__game.game.nurse.dragging);
});

test('contextual prompt button opens the med cabinet', async ({ page }) => {
  await boot(page);
  await page.locator('#screen .go').click();
  await page.evaluate(() => window.__game.teleport('nurse', -6, 17.7));
  await page.waitForSelector('#prompt', { state: 'visible' });
  await page.locator('#prompt').dispatchEvent('pointerdown');
  await page.waitForFunction(() => window.__game.state().modal === 'cabinet');
  // pick a med through the real modal button
  await page.locator('#modal .medbtn').first().dispatchEvent('pointerdown');
  await page.waitForFunction(() => !!window.__game.state().chars[0].carrying);
});
