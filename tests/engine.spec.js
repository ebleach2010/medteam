import { test, expect } from '@playwright/test';

// The procedural health-problem engine: many valid routes per presentation,
// per-patient variability, and a deterioration curve that ramps to day 100.
test('procedural engine: multiple valid treatments, variability, day curve', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => { try { localStorage.setItem('medteam.seenTutorial','1'); } catch {} });
  await page.goto('/?seed=5&lite=1');
  await page.waitForFunction(() => window.__game?.ready);

  const res = await page.evaluate(async () => {
    const gen = await import('/src/sim/generator.js');
    const meds = await import('/src/data/meds.js');
    const { makeRng } = await import('/src/core/rng.js');

    const judge = (c, id) => {
      const cls = meds.medById(id).cls;
      const hit = (l) => l.some((x) => cls.includes(x));
      if ((c.resist ?? []).includes(id)) return 'resist';
      if (hit(c.rx.first) || hit(c.rx.alt)) return 'works';
      if (hit(c.rx.adj)) return 'adjunct';
      return 'nothing';
    };

    // anxiety/insomnia must accept several reasonable agents, not just one
    const anx = gen.generateCase(makeRng(11), 1, { id: 'anxiety_insomnia' });
    const anxWorks = ['benzo', 'trazodone', 'quetiapine', 'hydroxyzine', 'diazepam']
      .filter((id) => judge(anx, id) === 'works').length;

    // deterioration must get materially harsher from day 1 to day 100
    const crit = (d) => gen.generateCase(makeRng(3), d, { id: 'sepsis' }).timeline[1].t;
    const d1 = crit(1), d100 = crit(100);

    // variability: across many rolls some patients resist an agent
    let resisters = 0;
    for (let i = 0; i < 60; i++) {
      const c = gen.generateCase(makeRng(1000 + i), 5, { id: 'anxiety_insomnia' });
      if ((c.resist ?? []).length) resisters++;
    }

    // seroquel is stocked
    const hasSeroquel = !!meds.medById('quetiapine');
    return { anxWorks, d1, d100, resisters, hasSeroquel };
  });

  expect(res.anxWorks).toBeGreaterThanOrEqual(4);   // many routes, not one
  expect(res.d100).toBeLessThan(res.d1 * 0.5);      // day 100 far harsher
  expect(res.resisters).toBeGreaterThan(3);         // variability exists
  expect(res.resisters).toBeLessThan(40);           // ...but isn't the norm
  expect(res.hasSeroquel).toBe(true);
});

// Imaging orders are written the way a real request is: modality AND region.
test('imaging orders: modality alone is rejected, regions and contrast parse', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('medteam.seenTutorial','1'); } catch {} });
  await page.goto('/?seed=5&lite=1');
  await page.waitForFunction(() => window.__game?.ready);

  const res = await page.evaluate(async () => {
    const { parseStudy, studyMatches } = await import('/src/data/studies.js');
    return {
      bare: parseStudy('x-ray').ok,
      foot: parseStudy('x-ray foot').label,
      big: parseStudy('MRI w/ w/o contrast of head neck and spine').label,
      // the right film for a sprain; a chest film is not
      rightFilm: studyMatches(parseStudy('x-ray ankle'), 'ankle'),
      wrongRegion: studyMatches(parseStudy('x-ray chest'), 'ankle'),
      // over-imaging costs time but still answers the question...
      ctForFilm: studyMatches(parseStudy('CT ankle'), 'ankle'),
      // ...but a plain film cannot replace a head CT
      filmForCt: studyMatches(parseStudy('x-ray head'), 'ct_head_bleed'),
    };
  });

  expect(res.bare).toBe(false);
  expect(res.foot).toContain('ankle/foot');
  expect(res.big).toContain('head + neck + spine');
  expect(res.big).toContain('w/ & w/o contrast');
  expect(res.rightFilm).toBe(true);
  expect(res.wrongRegion).toBe(false);
  expect(res.ctForFilm).toBe(true);
  expect(res.filmForCt).toBe(false);
});

// Supportive care buys time exactly once — stabilising, not curing.
test('partial treatment resets the deterioration clock only once', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('medteam.seenTutorial','1'); } catch {} });
  await page.goto('/?seed=5&lite=1');
  await page.waitForFunction(() => window.__game?.ready);

  // a bare-bones stand-in for a bedded patient — only the clock maths matters
  const cls = await page.evaluate(async () => {
    const { PatientSim } = await import('/src/sim/PatientSim.js');
    const fake = Object.create(PatientSim.prototype);
    Object.assign(fake, {
      game: { clock: { minutes: 500 } }, tArrive: 0, accel: 1, clockOffset: 0,
      treated: false, state: 'inbed', critical: false, ent: { setFace() {} },
      case: { timeline: [{ t: 100, done: true }, { t: 300 }] },
    });
    const before = fake.elapsed;
    const first = fake.stabiliseOnce();
    const after = fake.elapsed;
    const second = fake.stabiliseOnce();   // no second reprieve
    return { before, after, first, second };
  });
  expect(cls.first).toBe(true);
  expect(cls.second).toBe(false);
  expect(cls.after).toBeLessThan(cls.before);
});
