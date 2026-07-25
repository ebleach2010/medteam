import { test, expect } from '@playwright/test';

const url = '/?seed=7&lite=1';

// the chart's TREATMENTS tab lists every therapy/procedure tried + its result,
// collapsing repeats of the same order into the latest outcome
test('chart TREATMENTS tab logs therapies tried and their results', async ({ page }) => {
  test.setTimeout(45000);
  await page.addInitScript(() => { try { localStorage.setItem('medteam.seenTutorial', '1'); } catch {} });
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(200);

  const out = await page.evaluate(() => {
    const g = window.__game, game = g.game;
    const id = g.spawnCase('strep', -13, 7);
    g.bedPatientTo(id, 0);
    const p = [...game.world.byTag('patients')].find((q) => q.id === id);
    p.sim.recordTx('Ibuprofen', 'no effect');
    p.sim.recordTx('Amoxicillin', 'partial response');
    p.sim.recordTx('Amoxicillin', 'responded ✓'); // same order — collapses to latest
    game.ui.modals.reports(p, 'tx');
    const tabLabels = [...document.querySelectorAll('.ftab')].map((b) => b.textContent);
    const txText = document.querySelector('.txlog')?.textContent ?? '';
    return { logLen: p.sim.txLog.length, tabLabels, txText };
  });

  expect(out.logLen).toBe(2);                        // dupe collapsed
  expect(out.tabLabels).toContain('TREATMENTS');
  expect(out.txText).toContain('Ibuprofen');
  expect(out.txText).toContain('responded ✓');       // latest result kept
  expect(out.txText).not.toContain('partial response');
});
