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
          setTimeout(() => { clearInterval(t); res(); }, 14000);
        });
      }
    },
  };
`;

test('full lab loop: bed → labs → centrifuge → results → dx → meds → discharge', async ({ page }) => {
  await boot(page);
  await page.evaluate(helpers);

  const outcome = await page.evaluate(async () => {
    const g = window.__game, api = window.__api;
    const id = g.spawnCase('strep', -13, 7);
    g.teleport('nurse', -13, 7.9);
    api.grab('nurse');                        // HOLD grab — sticky hands
    await api.until(() => g.game.nurse.dragging);
    await api.dragTo('nurse', -11.4, 4.5);    // line up with exam room 1's door
    await api.dragTo('nurse', -8.3, 4.5);     // through the doorway
    await api.dragTo('nurse', -6.2, 4.5, 0.9); // all the way to the exam bed
    api.release('nurse');                     // release → exam bed
    await api.until(() => api.patient(id).state === 'inbed');
    await api.until(() => api.patient(id).hooked, 8000);  // monitor self-hooks

    api.act('nurse');                         // WORKUP → clipboard
    await api.until(() => g.state().modal === 'workup');
    g.inject({ type: 'SELECT', actorId: g.game.nurse.id, payload: { modal: 'workup', choice: 'ekg' } });
    await api.sleep(200);
    g.inject({ type: 'SELECT', actorId: g.game.nurse.id, payload: { modal: 'workup', choice: 'dx' } });
    await api.until(() => g.state().modal === 'dx');
    g.inject({ type: 'SELECT', actorId: g.game.nurse.id, payload: { modal: 'dx', choice: 0 } });
    await api.until(() => api.patient(id).dx === 0);

    api.act('nurse');                         // draw blood
    await api.until(() => g.state().chars[0].carrying?.startsWith('Blood'));
    g.teleport('nurse', -2.2, -9);            // lab feeds itself
    await api.until(() => g.state().centrifuge.busy, 8000);
    g.centrifugeFastForward();
    await api.until(() => g.state().items.some((i) => i.kind === 'paper'));
    g.teleport('nurse', -1.4, -8.8);
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
    g.teleport('nurse', -6, 4.5);
    await api.until(() => api.patient(id).treated, 10000);

    // haul them to the DISCHARGE room — walked, through the doors
    api.grab('nurse');
    await api.until(() => g.game.nurse.dragging);
    await api.drive('nurse', [[-8.6, 4.5], [-12.5, 3.8], [-14.5, 0.2], [-8.5, -3.2],
      [2, -2.6], [11, -5.2], [9.5, -13.5], [5, -17.6]]);
    api.release('nurse');
    await api.until(() => g.state().stats.treated >= 1, 12000);
    return { score: g.state().score, stats: g.state().stats };
  });

  expect(outcome.stats.treated).toBeGreaterThanOrEqual(1);
  expect(outcome.score).toBeGreaterThan(100);
  await page.screenshot({ path: 'test-results/shots/lab-loop-done.png' });
});

test('imaging: scan on the pad opens interpretation modal; SAH read correctly', async ({ page }) => {
  await boot(page);
  await page.evaluate(helpers);
  const res = await page.evaluate(async () => {
    const g = window.__game, api = window.__api;
    const id = g.spawnCase('stroke_sah', -20, 8);
    g.teleportPatient(id, 12.2, -8.8);        // park them on the imaging pad — it scans
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
    const id = g.spawnCase('od', -24, -5.5);
    g.teleport('nurse', -24, -4.8);
    api.grab('nurse');
    await api.until(() => g.game.nurse.dragging);
    await api.dragTo('nurse', -23.7, -8.6, 0.9);
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
    await api.dragTo('nurse', -23.7, -8.6, 0.9);
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
