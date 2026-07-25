import { test, expect } from '@playwright/test';

const url = '/?seed=7&lite=1';

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.setItem('medteam.seenTutorial', '1'); } catch { /* private */ } });
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(300);
}

test('triage nurse auto-rooms the sickest waiter into the lowest free room', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);

  const out = await page.evaluate(async () => {
    const g = window.__game, game = g.game;
    const until = async (fn, ms) => {
      const t0 = Date.now();
      while (!fn()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 100)); }
      return true;
    };
    const sickId = g.spawnCase('appy', -22, 12);
    const mildId = g.spawnCase('conj', -20, 12);
    const P = (id) => [...game.world.byTag('patients')].find((p) => p.id === id);
    const sick = P(sickId), mild = P(mildId);
    sick.sim.case.esi = 2; mild.sim.case.esi = 4;
    for (const p of [sick, mild]) { p.sim.route = null; p.sim.walkTarget = null; p.sim.seat = null; p.sim.state = 'waiting'; }
    sick.sim.tArrive = game.clock.minutes - 10;
    mild.sim.tArrive = game.clock.minutes - 20;

    const both = await until(() => sick.sim.bed && mild.sim.bed, 100000);
    return {
      both,
      sickRoom: sick.sim.bed?.roomNo ?? null, mildRoom: mild.sim.bed?.roomNo ?? null,
      sickState: sick.sim.state, mildState: mild.sim.state,
    };
  });

  expect(out.both).toBe(true);
  expect(out.sickState).toBe('inbed');
  expect(out.mildState).toBe('inbed');
  expect(out.sickRoom).toBe(1);            // sickest → Room 1
  expect(out.sickRoom).toBeLessThan(out.mildRoom); // milder → higher room
});
