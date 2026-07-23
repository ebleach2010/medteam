import { test, expect } from '@playwright/test';

// Scripted end-to-end playthroughs driven through the intent pipe — the same
// commands touch input produces (which keeps the co-op seam exercised).
const url = '/?seed=7&lite=1'; // lite: CI's software GL can't afford shadows

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
    release(role) { g.inject({ type: 'RELEASE', actorId: role === 'doctor' ? g.game.doctor.id : g.game.nurse.id }); },
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
    const id = g.spawnCase('strep', -8.5, 6.6);
    g.teleport('nurse', -8.5, 7.2);
    api.grab('nurse');                        // HOLD grab — sticky hands latch on
    await api.until(() => g.game.nurse.dragging);
    await api.dragTo('nurse', -8.5, 5.7);      // tow them to gurney 1
    api.release('nurse');                     // let go → auto-bed
    await api.until(() => api.patient(id).state === 'inbed');

    // monitor hooks itself up shortly after bedding
    await api.until(() => api.patient(id).hooked, 8000);
    api.act('nurse');                         // draw blood (deliberate act)
    await api.until(() => g.state().chars[0].carrying?.startsWith('Blood'));

    g.teleport('nurse', -2.2, -9);            // up to the F3 lab, vial in hand
    await api.until(() => g.state().centrifuge.busy, 8000); // it feeds itself
    g.centrifugeFastForward();
    await api.until(() => g.state().items.some((i) => i.kind === 'paper'));

    g.teleport('nurse', -1.4, -8.8);          // pick up the printout
    api.grab('nurse');
    await api.until(() => g.state().chars[0].carrying?.startsWith('Results'));
    api.act('nurse');                         // read it
    await api.until(() => g.state().modal === 'labs');
    g.game.ui.modals.close();
    api.release('nurse');                     // put the paper down

    g.inject({ type: 'SWAP_ROLE', actorId: 0 });
    g.teleport('doctor', -8.5, 6.0);
    api.act('doctor');                        // diagnose at bedside
    await api.until(() => g.state().modal === 'dx');
    g.inject({ type: 'SELECT', actorId: g.game.doctor.id, payload: { modal: 'dx', choice: 0 } });
    await api.until(() => api.patient(id).dx === 0);

    // pharmacy: open the med cabinet at a shelf and take amoxicillin
    g.teleport('doctor', -4.6, 16.2);
    api.act('doctor');
    await api.until(() => g.state().modal === 'cabinet');
    g.inject({ type: 'SELECT', actorId: g.game.doctor.id, payload: { modal: 'cabinet', choice: 'amoxicillin' } });
    await api.until(() => g.state().chars[1].carrying === 'Amoxicillin');

    g.teleport('doctor', -8.5, 6.0);          // hold the med at the bedside...
    await api.until(() => api.patient(id).treated, 10000); // ...it administers itself
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
    const id = g.spawnCase('stroke_sah', -20, 8);
    g.teleportPatient(id, 10, -19.2);         // park them on the F4 pad — it scans
    await api.until(() => g.state().modal === 'imaging', 15000);
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
    const id = g.spawnCase('od', -6.5, 6.6);
    g.teleport('nurse', -6.5, 7.2);
    api.grab('nurse');
    await api.until(() => g.game.nurse.dragging);
    await api.dragTo('nurse', -6.5, 5.7);
    api.release('nurse');                     // let go → auto-bed
    await api.until(() => api.patient(id).state === 'inbed');

    // hand the nurse naloxone directly (the pharmacy run is covered above);
    // holding it at the bedside administers it → treated → FURY
    const { spawnCarryable } = await import('/src/entities/Carryable.js');
    const c = g.game.nurse.pos;
    const item = spawnCarryable(g.game, 'med', c.x, 1, c.z,
      { medId: 'naloxone', color: 0x5da8ff, label: 'Naloxone' });
    g.game.nurse.carrying = item; item.heldBy = g.game.nurse;
    await api.until(() => api.patient(id).state === 'agitated', 15000);

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
    // holding the sedative against the pinned runner puts them under
    await api.until(() => api.patient(id).state === 'sedated', 10000);

    // drag the sleeper back to bed
    api.grab('nurse');
    await api.until(() => g.game.nurse.dragging);
    await api.dragTo('nurse', -6.5, 5.7);
    api.release('nurse');
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
