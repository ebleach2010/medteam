import { test, expect } from '@playwright/test';

const url = '/?seed=42&lite=1'; // lite: CI's software GL can't afford shadows

// skip the first-run how-to card — it pauses the sim, freezing spawns/staff
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('medteam.seenTutorial', '1'); } catch { /* private */ } });
});

test('boots to title without console errors and starts a day', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
  await expect(page.locator('#screen h1')).toContainText('MED');
  await page.screenshot({ path: 'test-results/shots/title.png' });

  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => window.__game.state());
  expect(st.mode).toBe('playing');
  expect(st.day).toBe(1);
  await page.screenshot({ path: 'test-results/shots/day1-start.png' });

  // the first patient must walk in on its own. The in-game clock is driven off
  // rendered frames, and headless software-GL runs at ~0.5 game-min/s, so the
  // ~18-min first arrival needs a generous real-time budget here.
  await page.waitForFunction(() => window.__game.state().patients.length >= 1, null, { timeout: 50000 });
  await page.screenshot({ path: 'test-results/shots/first-patient.png' });
  expect(errors).toEqual([]);
});

test('character moves via injected MOVE intents and stays upright', async ({ page }) => {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
  await page.evaluate(() => window.__game.start());
  const before = await page.evaluate(() => window.__game.state().chars[0].pos);
  await page.evaluate(() => {
    const g = window.__game;
    const id = g.game.nurse.id;
    let n = 0;
    const t = setInterval(() => {
      g.inject({ type: 'MOVE', actorId: id, payload: { x: 1, z: 0 } });
      if (++n > 80) clearInterval(t);
    }, 16);
  });
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => window.__game.state().chars[0].pos);
  expect(after.x).toBeGreaterThan(before.x + 1.5);
  expect(after.y).toBeGreaterThan(0.4); // didn't fall over permanently or clip the floor
  await page.screenshot({ path: 'test-results/shots/movement.png' });
});
