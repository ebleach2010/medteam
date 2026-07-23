import { test, expect } from '@playwright/test';

// Scripted end-to-end playthroughs driven through the intent pipe — the same
// commands touch input produces (which keeps the co-op seam exercised).
const url = '/?seed=7';

async function boot(page) {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(300);
}

const helpers = `
  const g = window.__game;
  window.__api = {
    async until(fn, ms = 15000) {
      const t0 = Date.now();
      while (!fn()) {
        if (Date.now() - t0 > ms) throw new Error('until timeout: ' + fn.toString().slice(0, 90));
        await new Promise((r) => setTimeout(r, 60));
      }
    },
    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); },
    act(role) { g.inject({ type: 'ACTION', actorId: role === 'doctor' ? g.game.doctor.id : g.game.nurse.id }); },
    grab(role) { g.inject({ type: 'GRAB', actorId: role === 'doctor' ? g.game.doctor.id : g.game.nurse.id }); },
    patient(id) { return g.state().patients.find((p) => p.id === id); },
    // drag a grabbed patient by walking the character (spring does the towing)
    async dragTo(role, x, z) {
      g.teleport(role, x, z);
      const ch = role === 'doctor' ? g.game.doctor : g.game.nurse;
      await this.until(() => {
        const p = ch.dragging?.body.translation();
        return p && Math.hypot(p.x - x, p.z - z) < 1.0;
      }, 10000);
    },
  };
`;

test('full lab loop: bed → labs → centrifuge → results → dx → meds → discharge', async ({ page }) => {
  await boot(page);
  await page.evaluate(helpers);

  const outcome = await page.evaluate(async () => {
    const g = window.__game, api = window.__api;
    const id = g.spawnCase('strep', -15, 3.2);
    g.teleport('nurse', -15, 2.4);
    api.grab('nurse');                        // grab the patient
    await api.until(() => g.game.nurse.dragging);
    await api.dragTo('nurse', -15, 1.6);      // tow them to bed 1
    api.grab('nurse');                        // release → auto-bed
    await api.until(() => api.patient(id).state === 'inbed');

    api.act('nurse');                         // hook monitor
    await api.until(() => api.patient(id).hooked);
    api.act('nurse');                         // draw blood
    await api.until(() => g.state().chars[0].carrying?.startsWith('Blood'));

    g.teleport('nurse', -23.2, 5.9);          // sprint to the lab
    api.act('nurse');                         // spin sample
    await api.until(() => g.state().centrifuge.busy);
    g.centrifugeFastForward();
    await api.until(() => g.state().items.some((i) => i.kind === 'paper'));

    g.teleport('nurse', -23.2, 6.6);          // pick up the printout
    api.grab('nurse');
    await api.until(() => g.state().chars[0].carrying?.startsWith('Results'));
    api.act('nurse');                         // read it
    await api.until(() => g.state().modal === 'labs');
    g.game.ui.modals.close();
    api.grab('nurse');                        // put the paper down

    g.inject({ type: 'SWAP_ROLE', actorId: 0 });
    g.teleport('doctor', -15, 1.9);
    api.act('doctor');                        // diagnose at bedside
    await api.until(() => g.state().modal === 'dx');
    g.inject({ type: 'SELECT', actorId: g.game.doctor.id, payload: { modal: 'dx', choice: 0 } });
    await api.until(() => api.patient(id).dx === 0);

    // pharmacy: open the med cabinet at a shelf and take amoxicillin
    g.teleport('doctor', 23.2, 2.4);
    api.act('doctor');
    await api.until(() => g.state().modal === 'cabinet');
    g.inject({ type: 'SELECT', actorId: g.game.doctor.id, payload: { modal: 'cabinet', choice: 'amoxicillin' } });
    await api.until(() => g.state().chars[1].carrying === 'Amoxicillin');

    g.teleport('doctor', -15, 1.9);
    api.act('doctor');                        // give the med → treated
    await api.until(() => api.patient(id).treated);
    g.skipMinutes(35);
    await api.until(() => !api.patient(id) || api.patient(id).state === 'leaving', 20000);
    return { score: g.state().score, stats: g.state().stats };
  });

  expect(outcome.stats.treated).toBe(1);
  expect(outcome.score).toBeGreaterThan(100);
  await page.screenshot({ path: 'test-results/shots/lab-loop-done.png' });
});

test('imaging: scan on the pad opens interpretation modal; SAH read correctly', async ({ page }) => {
  await boot(page);
  await page.evaluate(helpers);
  const res = await page.evaluate(async () => {
    const g = window.__game, api = window.__api;
    const id = g.spawnCase('stroke_sah', 21, -10);
    g.teleportPatient(id, 21, -10.2);         // onto the imaging pad
    g.teleport('nurse', 21.6, -9.4);
    api.act('nurse');                         // SCAN
    await api.until(() => g.state().modal === 'imaging', 10000);
    g.inject({ type: 'SELECT', actorId: g.game.nurse.id, payload: { modal: 'imaging', choice: 0 } });
    await api.until(() => api.patient(id).imagingDone);
    return { done: true };
  });
  expect(res.done).toBe(true);
  await page.screenshot({ path: 'test-results/shots/imaging.png' });
});

test('agitation: naloxone wakes the OD furious; tackle, sedate, re-bed', async ({ page }) => {
  await boot(page);
  await page.evaluate(helpers);
  const res = await page.evaluate(async () => {
    const g = window.__game, api = window.__api;
    const id = g.spawnCase('od', -11, 3.2);
    g.teleport('nurse', -11, 2.4);
    api.grab('nurse');
    await api.until(() => g.game.nurse.dragging);
    await api.dragTo('nurse', -11, 1.6);
    api.grab('nurse');                        // release → auto-bed
    await api.until(() => api.patient(id).state === 'inbed');

    // hand the nurse naloxone directly (the pharmacy run is covered above)
    const { spawnCarryable } = await import('/src/entities/Carryable.js');
    const c = g.game.nurse.pos;
    const item = spawnCarryable(g.game, 'med', c.x, 1, c.z,
      { medId: 'naloxone', color: 0x5da8ff, label: 'Naloxone' });
    g.game.nurse.carrying = item; item.heldBy = g.game.nurse;
    api.act('nurse');                         // give naloxone → treated → FURY
    await api.until(() => api.patient(id).state === 'agitated', 12000);

    // chase the runner: hop next to them and dive
    for (let i = 0; i < 40; i++) {
      const p = api.patient(id);
      if (!p || p.state !== 'agitated') break;
      g.teleport('nurse', p.pos.x - 0.7, p.pos.z);
      g.inject({ type: 'TACKLE', actorId: g.game.nurse.id });
      await api.sleep(300);
    }
    await api.until(() => api.patient(id).state === 'pinned', 12000);

    const c2 = g.game.nurse.pos;
    const sed = spawnCarryable(g.game, 'med', c2.x, 1, c2.z,
      { medId: 'sedative', color: 0x7a5cff, label: 'Sedative (IM)' });
    g.game.nurse.carrying = sed; sed.heldBy = g.game.nurse;
    api.act('nurse');                         // SEDATE
    await api.until(() => api.patient(id).state === 'sedated');

    // drag the sleeper back to bed
    api.grab('nurse');
    await api.until(() => g.game.nurse.dragging);
    await api.dragTo('nurse', -11, 1.6);
    api.grab('nurse');
    await api.until(() => api.patient(id).state === 'inbed', 10000);
    return { ok: true };
  });
  expect(res.ok).toBe(true);
  await page.screenshot({ path: 'test-results/shots/tackle-sedate.png' });
});

test('x-ray generator renders all finding types', async ({ page }) => {
  await boot(page);
  const kinds = ['cxr_normal', 'cxr_ptx', 'cxr_infiltrate', 'cxr_hyper',
    'ct_head_normal', 'ct_head_bleed', 'ct_appy', 'ct_freefluid', 'ankle_normal', 'ankle_fx'];
  for (const k of kinds) {
    const ok = await page.evaluate(async (kind) => {
      const { generateScan } = await import('/src/render/xray.js');
      const url = generateScan(kind, 12345);
      document.body.insertAdjacentHTML('beforeend',
        `<img id="probe" src="${url}" style="position:fixed;left:0;top:0;width:390px;z-index:999">`);
      await new Promise((r) => setTimeout(r, 120));
      return url.length > 5000;
    }, k);
    expect(ok, k).toBe(true);
    await page.screenshot({ path: `test-results/shots/xray-${k}.png` });
    await page.evaluate(() => document.getElementById('probe')?.remove());
  }
});
