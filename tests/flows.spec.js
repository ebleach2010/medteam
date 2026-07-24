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
    async dragTo(role, x, z, th = 1.6) {
      g.teleport(role, x, z);
      const ch = role === 'doctor' ? g.game.doctor : g.game.nurse;
      await this.until(() => {
        const p = ch.dragging?.body.translation();
        return p && Math.hypot(p.x - x, p.z - z) < th;
      }, 10000);
    },
    // walk the character through waypoints with MOVE intents — a real player
    // path; anything dragged follows the walked route through doorways
    async drive(role, pts) {
      const ch = role === 'doctor' ? g.game.doctor : g.game.nurse;
      for (const [x, z] of pts) {
        await new Promise((res) => {
          const t = setInterval(() => {
            const c = ch.pos;
            const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
            if (d < 0.8) {
              clearInterval(t);
              g.inject({ type: 'MOVE', actorId: ch.id, payload: { x: 0, z: 0 } });
              res();
              return;
            }
            g.inject({ type: 'MOVE', actorId: ch.id, payload: { x: dx / d, z: dz / d } });
          }, 16);
          setTimeout(() => { // waypoint timed out — stop walking, don't leave MOVE latched
            clearInterval(t);
            g.inject({ type: 'MOVE', actorId: ch.id, payload: { x: 0, z: 0 } });
            res();
          }, 14000);
        });
      }
    },
  };
`;

test('full lab loop: bed → labs → centrifuge → results → dx → meds → discharge', async ({ page }) => {
  test.setTimeout(160000); // longest E2E — walked drags on cold software GL need slack
  await boot(page);
  await page.evaluate(helpers);

  const outcome = await page.evaluate(async () => {
    const g = window.__game, api = window.__api;
    const id = g.spawnCase('strep', -13, 7);
    g.teleport('nurse', -13, 7.9);
    api.grab('nurse');                        // HOLD grab — sticky hands
    await api.until(() => g.game.nurse.dragging);
    await api.drive('nurse', [[-14.5, 3.4], [-13.2, -0.5], [-12, -5.8], [-12.4, -9.2], [-13.2, -8.6]]);
    await api.sleep(1200);                    // let the tow swing fully into the room
    api.release('nurse');                     // release → room bed
    try {
      await api.until(() => api.patient(id).state === 'inbed', 8000);
    } catch {
      // walked tow came up short (slow CI GL) — do what a player does: grab
      // again and haul them the last meter to the bed
      api.grab('nurse');
      await api.until(() => g.game.nurse.dragging, 5000);
      await api.dragTo('nurse', -13.2, -8.6, 1.4);
      api.release('nurse');
      await api.until(() => api.patient(id).state === 'inbed', 8000);
    }
    await api.until(() => api.patient(id).hooked, 8000);  // monitor self-hooks

    api.act('nurse');                         // WORKUP → clipboard
    await api.until(() => g.state().modal === 'workup');
    g.inject({ type: 'SELECT', actorId: g.game.nurse.id, payload: { modal: 'workup', choice: 'ekg' } });
    await api.sleep(200);
    g.inject({ type: 'SELECT', actorId: g.game.nurse.id, payload: { modal: 'workup', choice: 'dx' } });
    await api.until(() => g.state().modal === 'dx');
    g.inject({ type: 'SELECT', actorId: g.game.nurse.id, payload: { modal: 'dx', choice: 0 } });
    await api.until(() => api.patient(id).dx === 0);

    api.act('nurse');                         // draw blood → the panel board opens
    await api.until(() => g.state().modal === 'labs_order');
    g.inject({ type: 'SELECT', actorId: g.game.nurse.id, payload: { modal: 'labs_order', choice: ['CBC', 'CHEM', 'INFECT'] } });
    await api.until(() => g.state().chars[0].carrying?.startsWith('Blood'));
    g.teleport('nurse', -2.4, 0);             // lab feeds itself
    await api.until(() => g.state().centrifuge.busy, 8000);
    g.centrifugeFastForward();
    await api.until(() => g.state().items.some((i) => i.kind === 'paper'));
    g.teleport('nurse', -1.6, -1.5);
    api.grab('nurse');
    await api.until(() => g.state().chars[0].carrying?.startsWith('Results'));
    api.act('nurse');
    await api.until(() => g.state().modal === 'labs');
    g.game.ui.modals.close();
    api.release('nurse');

    // med cabinet → amoxicillin → bedside dwell
    g.teleport('nurse', -9.5, 17.7);
    api.act('nurse');
    await api.until(() => g.state().modal === 'cabinet');
    g.inject({ type: 'SELECT', actorId: g.game.nurse.id, payload: { modal: 'cabinet', choice: 'amoxicillin' } });
    await api.until(() => g.state().chars[0].carrying === 'Amoxicillin');
    g.teleport('nurse', -12, -8.6);
    await api.until(() => api.patient(id).treated, 10000);
    // stabilization lags treatment — leaving early means a refused discharge
    await api.until(() => {
      const p = [...g.game.world.byTag('patients')].find((q) => q.id === id);
      return p?.sim.stabilized;
    }, 60000);

    // haul them to the DISCHARGE room — walked, through the doors
    api.grab('nurse');
    try { await api.until(() => g.game.nurse.dragging, 8000); }
    catch { // stood-up patient drifted out of reach on cold GL — step to them
      const pp = [...g.game.world.byTag('patients')].find((q) => q.id === id).body.translation();
      g.teleport('nurse', pp.x + 0.6, pp.z + 0.6);
      api.grab('nurse');
      await api.until(() => g.game.nurse.dragging, 8000);
    }
    await api.drive('nurse', [[-12, -5.6], [-6, -5.5], [2, -5.6], [8.5, -8.5],
      [8.5, -13.5], [5, -17.6]]);
    api.release('nurse');
    try {
      await api.until(() => g.state().stats.treated >= 1, 8000);
    } catch {
      // walked haul released outside the discharge ring — re-grab and drop
      // them dead-center like a player would
      api.grab('nurse');
      await api.until(() => g.game.nurse.dragging, 5000);
      const dis = g.game.map.discharge;
      await api.dragTo('nurse', dis.x, dis.z, Math.max(1.2, dis.r - 0.4));
      api.release('nurse');
      await api.until(() => g.state().stats.treated >= 1, 10000);
    }
    return { score: g.state().score, stats: g.state().stats };
  });

  expect(outcome.stats.treated).toBeGreaterThanOrEqual(1);
  expect(outcome.score).toBeGreaterThan(100);
  await page.screenshot({ path: 'test-results/shots/lab-loop-done.png' });
});

test('radiology pipeline: order CT, porter round-trip, clipboard on the desk', async ({ page }) => {
  await boot(page);
  await page.evaluate(helpers);
  const res = await page.evaluate(async () => {
    const g = window.__game, api = window.__api;
    const id = g.spawnCase('stroke_sah', -20, 8);
    await api.sleep(300);
    g.bedPatientTo(id, 7);                    // Room 8
    g.orderImaging(id, 'CT');
    // porter hauls them to diagnostics, scan runs, hauls them back
    await api.until(() => [...g.game.tasks.values()].some((t) => t.phase === 'scanning'), 40000);
    g.fastForwardImaging();
    await api.until(() => api.patient(id)?.state === 'inbed' &&
      g.state().items.some((i) => i.label.startsWith('Imaging:')), 40000);
    await api.until(() => api.patient(id).imagingDone);
    return { done: true };
  });
  expect(res.done).toBe(true);
  await page.screenshot({ path: 'test-results/shots/radiology.png' });
});

test('phlebotomist drags the patient to the lab, spins, drags them back with results', async ({ page }) => {
  await boot(page);
  await page.evaluate(helpers);
  const res = await page.evaluate(async () => {
    const g = window.__game, api = window.__api;
    const id = g.spawnCase('sepsis', -20, 8);
    await api.sleep(300);
    g.bedPatientTo(id, 1);                    // Room 2
    g.orderLabs(id);
    await api.until(() => g.taskPhases().includes('labs:waitSpin'), 60000);
    g.centrifugeFastForward();
    await api.until(() => api.patient(id)?.state === 'inbed' &&
      g.state().items.some((i) => i.kind === 'paper' && !i.held), 60000);
    return { done: true, lab: api.patient(id).lab };
  });
  expect(res.done).toBe(true);
  expect(res.lab).toBe('ready');
});

test('tech waits at the machine; you show up, pick CT from the board, scan runs', async ({ page }) => {
  await boot(page);
  await page.evaluate(helpers);
  const res = await page.evaluate(async () => {
    const g = window.__game, api = window.__api;
    const id = g.spawnCase('stroke_sah', -20, 8);
    await api.sleep(300);
    g.bedPatientTo(id, 7);
    g.orderImaging(id);                       // NO modality — chosen at the machine
    await api.until(() => g.taskPhases().includes('imaging:awaitChoice'), 40000);
    // walk of shame: teleport the nurse to the machine; the tech should ask
    g.teleport('nurse', 7.2, -1.2);
    await api.until(() => g.state().modal === 'study', 8000);
    g.inject({ type: 'SELECT', actorId: g.game.nurse.id, payload: { modal: 'study', choice: 'CT' } });
    await api.until(() => g.taskPhases().includes('imaging:scanning'), 8000);
    g.fastForwardImaging();
    await api.until(() => api.patient(id)?.state === 'inbed' &&
      g.state().items.some((i) => i.label.startsWith('Imaging:')), 40000);
    return { done: true };
  });
  expect(res.done).toBe(true);
});

test('surgery team: waits at the bedside, you pick the right op, patient treated', async ({ page }) => {
  await boot(page);
  await page.evaluate(helpers);
  const res = await page.evaluate(async () => {
    const g = window.__game, api = window.__api;
    const id = g.spawnCase('appy', -20, 8);
    await api.sleep(300);
    g.bedPatientTo(id, 4);                    // Room 5
    g.orderSurgery(id);
    await api.until(() => g.taskPhases().includes('surgery:awaitChoice'), 40000);
    const bed = g.game.map.beds[4];
    g.teleport('nurse', bed.x + 1.0, bed.z + 1.1);
    await api.until(() => g.state().modal === 'surgery', 8000);
    // type it in and confirm — the typed path, not the tap path
    g.inject({ type: 'SELECT', actorId: g.game.nurse.id, payload: { modal: 'surgery', text: 'appendectomy' } });
    await api.until(() => g.taskPhases().includes('surgery:operating'), 8000);
    g.fastForwardSurgery();
    await api.until(() => api.patient(id)?.treated, 10000);
    return { done: true };
  });
  expect(res.done).toBe(true);
});

test('agitation: naloxone wakes the OD furious; tackle, sedate, re-bed', async ({ page }) => {
  await boot(page);
  await page.evaluate(helpers);
  const res = await page.evaluate(async () => {
    const g = window.__game, api = window.__api;
    const id = g.spawnCase('od', -24, -4.2);
    g.teleport('nurse', -24, -3.4);
    api.grab('nurse');
    await api.until(() => g.game.nurse.dragging);
    await api.drive('nurse', [[-24, -3.8], [-24, -5.8], [-24.5, -9.2]]);
    api.release('nurse');                     // let go → auto-bed
    await api.until(() => api.patient(id).state === 'inbed');

    // hand the nurse naloxone directly (the pharmacy run is covered above);
    // holding it at the bedside administers it → treated → FURY.
    // Step to the bedside first — under CI load the walked drive can stop
    // just outside the med-dwell radius.
    // (door side of the bed — beside/behind it is furniture that shoves you
    // out past the 1.7 m med-dwell radius)
    const bp0 = api.patient(id).pos;
    g.teleport('nurse', bp0.x + 1.0, bp0.z + 1.1);
    await api.sleep(150);
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
    // the dive slides you past them — step back to the pile before injecting
    const pp = api.patient(id).pos;
    g.teleport('nurse', pp.x - 0.6, pp.z);
    await api.sleep(150);
    const c2 = g.game.nurse.pos;
    const sed = spawnCarryable(g.game, 'med', c2.x, 1, c2.z,
      { medId: 'sedative', color: 0x7a5cff, label: 'Sedative (IM)' });
    g.game.nurse.carrying = sed; sed.heldBy = g.game.nurse;
    // holding the sedative against the pinned runner puts them under
    await api.until(() => api.patient(id).state === 'sedated', 10000);

    // drag the sleeper back to bed (chase ends anywhere — reset to the door)
    g.teleport('nurse', -24, -5.4);
    g.teleportPatient(id, -24, -4.9);
    await api.sleep(200);
    api.grab('nurse');
    await api.until(() => g.game.nurse.dragging);
    await api.drive('nurse', [[-24.4, -9.0]]);
    await api.sleep(900);
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
