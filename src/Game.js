import * as THREE from 'three';
import { RAPIER } from './physics/physics.js';
import { World } from './core/world.js';
import { GameClock } from './core/clock.js';
import { makeRng } from './core/rng.js';
import { loadSave, writeSave } from './core/save.js';
import { Audio } from './core/audio.js';
import { Renderer } from './render/renderer.js';
import { buildMap } from './map/map.js';
import { Character } from './entities/Character.js';
import { syncPatientMesh } from './entities/Patient.js';
import { makeCharacterMesh } from './render/meshes.js';
import { animateRig } from './render/rig.js';
import { spawnCarryable } from './entities/Carryable.js';
import { Spawner } from './sim/spawner.js';
import { giveMed, applyTreatment } from './sim/treatment.js';
import { INTENT, make } from './intents/intents.js';
import { UI } from './ui/ui.js';
import { medById } from './data/meds.js';
import { dayConfig } from './data/days.js';
import { generateScan } from './render/xray.js';
import { glowSprite } from './render/meshes.js';
import { matchTreatment } from './sim/talk.js';

const FIXED_DT = 1 / 60;

export class Game {
  constructor(canvas, physics, { seed = 1337, lite = false } = {}) {
    this.physics = physics;
    this.renderer = new Renderer(canvas, lite);
    this.world = new World();
    this.clock = new GameClock();
    this.rng = makeRng(seed);
    this.save = loadSave();
    this.audio = new Audio();
    this.map = buildMap(this.renderer.scene, physics);
    this.spawner = new Spawner(this);

    this.nurse = this.world.add(new Character(this, 'nurse', this.map.nurseSpawn.x, this.map.nurseSpawn.z), 'chars');
    this.doctor = this.world.add(new Character(this, 'doctor', this.map.doctorSpawn.x, this.map.doctorSpawn.z), 'chars');
    // autonomous staff you dispatch from the ORDERS wheel
    this.aide = this.world.add(new Character(this, 'aide', this.map.nurseSpawn.x - 2, this.map.nurseSpawn.z + 1), 'chars');
    this.porter = this.world.add(new Character(this, 'porter', this.map.porterSpawn.x, this.map.porterSpawn.z), 'chars');
    this.tech = this.world.add(new Character(this, 'tech', this.map.porterSpawn.x + 1.2, this.map.porterSpawn.z - 1.6), 'chars');
    this.surgeon = this.world.add(new Character(this, 'surgeon', this.map.doctorSpawn.x - 1.5, this.map.doctorSpawn.z - 1), 'chars');
    // the receptionist: cosmetic rig parked in the chair behind the front desk
    this.receptionist = makeCharacterMesh('receptionist');
    this.receptionist.position.set(this.map.receptionSeat.x, 0.28, this.map.receptionSeat.z);
    this.renderer.scene.add(this.receptionist);
    this.tasks = new Map();      // staff char → current task
    this.activeIdx = 1;          // you play the PHYSICIAN; SWAP for the nurse
    // idle staff sit at the nurses' station (tech at diagnostics) until called
    this.aide.home = this.map.staffSeats.aide;
    this.porter.home = this.map.staffSeats.porter;
    this.surgeon.home = this.map.staffSeats.surgeon;
    this.tech.home = this.map.staffSeats.tech;
    this.aide.homeExit = this.map.stationExit.west;
    this.surgeon.homeExit = this.map.stationExit.west;
    this.porter.homeExit = this.map.stationExit.east;
    this.tech.homeExit = this.map.stationExit.east;

    this.ui = new UI(this);
    this.intentQueue = [];
    this.timers = [];
    this.timeReal = 0;
    this.mode = 'title';
    this.score = 0;
    this.dayStats = this._freshStats();
    this._acc = 0;
    this._scanJob = null;
    this.aiTask = null; // the idle nurse running labs for the doctor
    this.quota = dayConfig(1).quota;

    // comedy FX pools: heel skid lines (fade over 5s) + sprint dust
    this.fx = { skids: [], dusts: [], skidIdx: 0, dustIdx: 0 };
    const skidGeo = new THREE.PlaneGeometry(0.075, 0.62);
    for (let i = 0; i < 96; i++) {
      const m = new THREE.Mesh(skidGeo, new THREE.MeshBasicMaterial({
        color: 0x574b40, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.028;
      m.visible = false;
      this.renderer.scene.add(m);
      this.fx.skids.push({ mesh: m, life: 0 });
    }
    for (let i = 0; i < 20; i++) {
      const sp = glowSprite(0xcfc9bd, 0.5, 0);
      sp.visible = false;
      this.renderer.scene.add(sp);
      this.fx.dusts.push({ sp, life: 0 });
    }

    this.ui.screens.title(() => this.startDay(1));
  }

  get active() { return this.activeIdx === 0 ? this.nurse : this.doctor; }
  get idle() { return this.activeIdx === 0 ? this.doctor : this.nurse; }

  _freshStats() { return { treated: 0, died: 0, walkedOut: 0, score: 0 }; }

  // ---------------- day cycle ----------------
  startDay(day) {
    this.clock.day = day ?? this.clock.day;
    this.clock.minutes = 0;
    this.spawner.planDay(this.clock.day);
    const cfg = dayConfig(this.clock.day);
    this.clock.timeScale = cfg.timeScale;
    this.quota = cfg.quota;
    this.dayStats = this._freshStats();
    this.mode = 'playing';
    this.clock.running = true;
    this._spawnLobbyProps();
    this.ui.screens.fade(false);
    this.ui.toast(`Day ${this.clock.day} — 12:00 AM. Here they come.`);
  }

  // waiting-room physics props, reset fresh each day — angry patients shove
  // them, players can grab and juggle them, comedy ensues
  _spawnLobbyProps() {
    for (const it of [...this.world.byTag('items')]) if (it.itemKind === 'prop') this.world.remove(it, this);
    const P = [
      // x, z, y, color, label, hx, hy, hz, mass
      [-20.2, 14.5, 0.5, 0xf6f2e6, 'Magazines', 0.17, 0.03, 0.13, 0.4],
      [-20.6, 14.9, 0.5, 0xffd23c, 'Magazines', 0.17, 0.03, 0.13, 0.4],
      [-26.6, 12.2, 1.35, 0x9fd8ff, 'Water jug', 0.15, 0.2, 0.15, 1.2],
      [-25.6, 11.0, 0.6, 0x51677c, 'WAIT HERE sign', 0.32, 0.55, 0.05, 1.5],
      [-17.6, 14.2, 0.4, 0x8a94a4, 'Trash can', 0.16, 0.3, 0.16, 0.8],
      [-23.0, 12.6, 0.4, 0x8a94a4, 'Trash can', 0.16, 0.3, 0.16, 0.8],
      [-19.2, 16.0, 0.5, 0x3f8a4f, 'Potted plant', 0.15, 0.32, 0.15, 1.4],
      [-27.4, 16.4, 0.2, 0xff5d5d, 'Toy block', 0.09, 0.09, 0.09, 0.2],
      [-27.0, 16.8, 0.2, 0x2f80ff, 'Toy block', 0.09, 0.09, 0.09, 0.2],
      [-27.6, 16.9, 0.2, 0x21b573, 'Toy block', 0.09, 0.09, 0.09, 0.2],
      [-21.2, 14.5, 0.5, 0xe8e4da, 'Coffee cup', 0.06, 0.08, 0.06, 0.15],
      [-24.8, 12.0, 0.3, 0xd9c6a8, 'Tissue box', 0.13, 0.09, 0.09, 0.2],
    ];
    for (const [x, z, y, color, label, hx, hy, hz, mass] of P) {
      spawnCarryable(this, 'prop', x, y, z, { color, label, size: { hx, hy, hz, mass } });
    }
  }

  // pull a med out of the cabinet UI straight into the character's hands
  takeMedFromCabinet(char, medId) {
    const med = medById(medId);
    if (!med) return;
    if (char.carrying) this._consumeHeld(char); // swap: old box vanishes
    const a = char.handAnchor();
    const item = spawnCarryable(this, 'med', a.x, 0.9, a.z,
      { medId: med.id, color: med.color, label: med.name });
    char.carrying = item; item.heldBy = char;
    this.ui.toast(`Took ${med.name}`);
    this.audio.tap();
  }

  endDay() {
    this.mode = 'summary';
    this.clock.running = false;
    this.tasks.clear();
    this.ui.screens.fade(true);
    const passed = this.dayStats.treated >= this.quota;
    if (passed) {
      this.save.highestDay = Math.max(this.save.highestDay, this.clock.day + 1);
    }
    this.save.totalTreated += this.dayStats.treated;
    this.save.totalDeaths += this.dayStats.died;
    this.save.bestDayScore = Math.max(this.save.bestDayScore, this.dayStats.score);
    writeSave(this.save);
    setTimeout(() => {
      this.ui.screens.fade(false);
      if (passed) {
        this.ui.screens.daySummary(this.dayStats, this.clock.day, this.quota, () => {
          this.ui.screens.fade(true);
          setTimeout(() => { this.ui.screens.fade(false); this.startDay(this.clock.day + 1); }, 700);
        });
      } else {
        // quota missed: game over, back to day one, fresh score
        this.ui.screens.gameOver(this.dayStats, this.clock.day, this.quota, () => {
          this.score = 0;
          this._clearAllPatients();
          this.ui.screens.fade(true);
          setTimeout(() => { this.ui.screens.fade(false); this.startDay(1); }, 700);
        });
      }
    }, 900);
  }

  _clearAllPatients() {
    for (const p of [...this.world.byTag('patients')]) this.removePatient(p);
    for (const it of [...this.world.byTag('items')]) this.world.remove(it, this);
    this.nurse.carrying = this.nurse.dragging = null;
    this.doctor.carrying = this.doctor.dragging = null;
  }

  // ---------------- loop ----------------
  start() {
    let last = performance.now();
    const frame = (now) => {
      requestAnimationFrame(frame);
      let dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      this._acc += dt;
      let steps = 0;
      while (this._acc >= FIXED_DT && steps < 5) {
        this.fixedTick(FIXED_DT);
        this._acc -= FIXED_DT;
        steps++;
      }
      if (steps === 5) this._acc = 0;
      this.renderFrame(dt);
    };
    requestAnimationFrame(frame);
  }

  fixedTick(dt) {
    this.timeReal += dt;
    this._tickN = (this._tickN ?? 0) + 1;
    if (this.mode === 'playing') this.clock.update(dt);

    // player input → intents → sim (the co-op seam)
    if (this.mode === 'playing' && !this.ui.modals.open) {
      // joystick emits MOVE only while engaged (plus one zero on release), so
      // MOVE intents injected by tests / future co-op peers aren't stomped
      const j = this.ui.joystick.vec;
      const joyActive = Math.hypot(j.x, j.z) > 0.02;
      if (joyActive || this._joyWasActive) this.enqueue(make(INTENT.MOVE, this.active.id, { x: j.x, z: j.z }));
      this._joyWasActive = joyActive;
    }
    const q = this.intentQueue;
    this.intentQueue = [];
    for (const i of q) this.applyIntent(i);

    if (this.mode !== 'playing') {
      // physics keeps simmering behind menus so the world doesn't freeze mid-ragdoll
      this.physics.step();
      return;
    }

    // tests/co-op can still drive the idle twin — zero it only after a short
    // grace, since catch-up steps outnumber inbound MOVE intents on slow GPUs
    if (this._tickN - (this.idle._moveTick ?? -999) > 6) this.idle.applyMove(0, 0);
    this._staffTick(dt);
    for (const c of this.world.byTag('chars')) c.fixedUpdate(dt);
    for (const p of [...this.world.byTag('patients')]) p.sim.tick(dt);
    this.physics.step();

    this._postPhysics(dt);
    this.spawner.tick();

    // scheduled one-shots (fatal med errors etc.)
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timeReal >= this.timers[i].at) { const t = this.timers.splice(i, 1)[0]; t.fn(); }
    }

    if (this.clock.dayDone) this.endDay();
  }

  // ---------------- autonomous staff ----------------
  _routeTo(from, to) {
    const za = this.map.zoneOf(from.x, from.z), zb = this.map.zoneOf(to.x, to.z);
    const route = [];
    if (za >= 0 && zb >= 0 && za !== zb) {
      const step = za < zb ? 1 : -1;
      for (let z = za; z !== zb; z += step) route.push({ ...this.map.zoneDoors[step > 0 ? z : z - 1] });
    }
    route.push({ x: to.x, z: to.z });
    return route;
  }

  _deskFor(sim) {
    const no = sim.bed?.roomNo ?? sim.lastRoomNo;
    return no ? this.map.roomDesks[no - 1] : null;
  }

  dispatch(char, task) {
    if (this.tasks.has(char)) { this.ui.toast('That staff member is already on a job'); return false; }
    char._homeRoute = null;
    if (char.atPost) char.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    // rounding the desk only matters when the job lies south of it — a
    // northbound fetch just walks straight out the top of the station
    const wp0 = task.route?.[0];
    if (char.atPost && char.homeExit && wp0 && wp0.z < -0.75) task.route = [...char.homeExit, ...task.route];
    task.wait = 0;
    this.tasks.set(char, task);
    return true;
  }

  _routeToRoomBed(from, bed) {
    const door = this.map.roomDoor(bed.index);
    const r = this._routeTo(from, { x: door.x, z: door.z });
    r.push({ x: bed.x + 0.9, z: bed.z + 1.1 });
    return r;
  }

  // panels is optional: without one the phlebotomist still walks to the room,
  // then WAITS for you to come and pick which panels to send (like imaging)
  orderLabs(patient, panels = null) {
    const sim = patient.sim;
    if (sim.state !== 'inbed') { this.ui.toast('Get them into a room bed first'); return; }
    if (sim.labState !== 'none') { this.ui.toast('Labs already in motion'); return; }
    if (this.tasks.has(this.aide)) { this._queueJob(this.aide, { kind: 'labs', patientId: patient.id, panels }, sim, 'labs'); return; }
    if (!this.dispatch(this.aide, { type: 'labs', phase: 'toPatient', patient, panels,
      route: this._routeToRoomBed(this.aide.pos, sim.bed) })) return;
    sim.orders.add('labs');
    this.ui.bubbles.say(this.aide, '🫡 ROGER!! Drawing blood!', { hold: 3 });
  }

  beginLabs(t, panels) {
    t.panels = panels;
    t.patient.sim.orderedPanels = panels;
    const entry = [...this.tasks.entries()].find(([, task]) => task === t);
    if (!entry) return;
    this.ui.toast(`🧪 ${panels.length} panel${panels.length > 1 ? 's' : ''} sent — drawing now`);
    this._labsGrab(entry[0], t);
  }

  // modality is optional: without one the porter still hauls the patient to
  // diagnostics, and the tech waits for YOU to show up and choose the study
  orderImaging(patient, modality = null) {
    const sim = patient.sim;
    const M = modality ? Game.MODALITIES.find((m) => m.id === modality) : null;
    if (modality && !M) { this.ui.toast('Unknown study'); return; }
    if (sim.state !== 'inbed') { this.ui.toast('They need to be in a room bed'); return; }
    if (sim.imagingOrder) { this.ui.toast('Imaging already in motion'); return; }
    if (this.tasks.has(this.porter)) { this._queueJob(this.porter, { kind: 'imaging', patientId: patient.id, modality }, sim, 'imaging'); return; }
    if (!this.dispatch(this.porter, { type: 'imaging', phase: 'toRoom', patient, modality: M,
      bed: sim.bed, route: this._routeToRoomBed(this.porter.pos, sim.bed) })) return;
    sim.imagingOrder = { modality: M?.id ?? 'TBD', phase: 'transport' };
    this.ui.bubbles.say(this.porter, '🫡 ROGER!! Transport rolling!', { hold: 3 });
  }

  orderSurgery(patient) {
    const sim = patient.sim;
    if (sim.state !== 'inbed') { this.ui.toast('They need to be in a room bed first'); return; }
    if (sim.surgeryDone) { this.ui.toast('They have already been to surgery'); return; }
    if (sim._surgQueued) { this.ui.toast('Already in the surgery queue'); return; }
    if (this.tasks.has(this.surgeon)) { this._queueJob(this.surgeon, { kind: 'surgery', patientId: patient.id }, sim, 'surgery'); return; }
    if (!this.dispatch(this.surgeon, { type: 'surgery', phase: 'toPatient', patient,
      bed: sim.bed, route: this._routeToRoomBed(this.surgeon.pos, sim.bed) })) return;
    this.ui.bubbles.say(this.surgeon, '🫡 ROGER!! Surgery en route!', { hold: 3 });
  }

  orderMedFetch(patient, medId) {
    const med = medById(medId);
    if (!med) return false;
    if (this.tasks.has(this.aide)) { this._queueJob(this.aide, { kind: 'fetch', patientId: patient.id, medId }, patient.sim, 'med fetch'); return true; }
    if (!this.dispatch(this.aide, { type: 'fetch', phase: 'toPharmacy', patient, medId,
      route: this._routeTo(this.aide.pos, { x: -9.5, z: 17.4 }) })) return false;
    this.ui.bubbles.say(this.aide, `🫡 ROGER!! ${med.name}, coming up!`, { hold: 3 });
    this.ui.toast(`💊 Nurse fetching ${med.name}...`);
    return true;
  }

  // steer toward a point; if we're pushing into furniture and not moving,
  // sidestep along it (poor man's wall-follow) until the way is clear
  _steer(ch, tx, tz, mag, dt) {
    const p = ch.pos;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    let mx = dx / d, mz = dz / d;
    const v = ch.body.linvel();
    if (Math.hypot(v.x, v.z) < 0.3) ch._stuckAcc = (ch._stuckAcc ?? 0) + dt;
    else if ((ch._dodgeT ?? 0) <= 0) ch._stuckAcc = 0;
    if (ch._stuckAcc > 0.6) { ch._dodgeDir = -(ch._dodgeDir ?? -1); ch._dodgeT = 0.9; ch._stuckAcc = 0; }
    if ((ch._dodgeT ?? 0) > 0) {
      ch._dodgeT -= dt;
      const sgn = ch._dodgeDir ?? 1;
      const t0 = mx; mx = mz * sgn; mz = -t0 * sgn;
    }
    ch.applyMove(mx * mag, mz * mag);
  }

  // freeform typed orders that aren't meds: judged (live Claude or local
  // rules) and applied with proportionate consequences
  applyIntervention(pt, effect, reply, label) {
    const sim = pt.sim;
    const line = reply || 'It... happens. Nobody is sure it helped.';
    if (effect === 'helps') {
      sim.accel = Math.max(0.4, (sim.accel ?? 1) * 0.6);
      this.addScore(25, 'Good improvisation');
      this.ui.toast(`✚ ${line}`, 'good', 4500);
      sim._say?.('better');
    } else if (effect === 'nothing') {
      this.addScore(-5, 'Questionable order');
      this.ui.toast(`🤷 ${line}`, '', 4200);
    } else if (effect === 'harms') {
      sim.accel = (sim.accel ?? 1) * 2;
      this.addScore(-40, 'Harmful intervention');
      this.ui.toast(`⚠ ${line}`, 'bad', 4500);
      sim._say?.('worse');
      if (sim.state === 'inbed' && this.rng.chance(0.35)) sim.agitate?.();
    } else if (effect === 'severe') {
      sim.accel = (sim.accel ?? 1) * 4;
      this.addScore(-120, 'That was assault, basically');
      sim._goCritical?.(); // its CRASHING toast fires first...
      this.ui.toast(`🚨 ${line}`, 'bad', 5000); // ...so the narration stays on screen
    } else if (effect === 'lethal') {
      this.addScore(-250, 'Malpractice of legend');
      this.ui.toast(`☠ ${line}`, 'bad', 5500);
      sim.critical = true;
      sim.accel = 10;
      this.timers.push({ at: this.timeReal + 4, fn: () => { if (sim.state !== 'dead') sim.die?.(`iatrogenic — ${label}`, true); } });
    }
  }

  _staffTick(dt) {
    // off-duty staff head back to their post and SIT until dispatched
    for (const ch of [this.aide, this.porter, this.tech, this.surgeon]) {
      if (this.tasks.has(ch)) { ch.atPost = false; continue; }
      const h = ch.home;
      if (!h) continue;
      const p = ch.pos;
      const d = Math.hypot(h.x - p.x, h.z - p.z);
      if (d > 0.45) {
        ch.atPost = false;
        if (!ch._homeRoute) {
          const r = this._routeTo(p, h);
          r.pop(); // final approach handled below
          // coming from another zone or from south of the desk: round the
          // desk via the lane; then ALWAYS slot in from behind the row so
          // we never plow through seated colleagues
          if (ch.homeExit && (r.length || p.z < -0.75)) r.push(...[...ch.homeExit].reverse());
          r.push({ x: h.x, z: 0.95 });
          ch._homeRoute = r;
        }
        let wp = ch._homeRoute[0];
        while (wp && Math.hypot(wp.x - p.x, wp.z - p.z) < 0.9) { ch._homeRoute.shift(); wp = ch._homeRoute[0]; }
        const tgt = wp ?? h;
        this._steer(ch, tgt.x, tgt.z, 0.55, dt);
      } else {
        if (!ch.atPost) { // plant them squarely ON the chair, rooted
          ch.body.setTranslation({ x: h.x, y: ch.body.translation().y, z: h.z }, true);
          ch.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          ch.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        }
        ch._homeRoute = null;
        ch.applyMove(0, 0); ch.atPost = true; ch.yaw = h.yaw;
      }
    }
    for (const [ch, t] of [...this.tasks]) {
      // wall-snag failsafe: if the towed patient jams on a corner for over a
      // second, the staffer yanks the gurney free (snap them in behind)
      if (ch.dragging) {
        const dp = ch.dragging.body.translation();
        const cp = ch.pos;
        const dv = ch.dragging.body.linvel();
        const far = Math.hypot(dp.x - cp.x, dp.z - cp.z) > 2.3;
        if (far && Math.hypot(dv.x, dv.z) < 0.3) t.towStuck = (t.towStuck ?? 0) + dt;
        else t.towStuck = 0;
        if (t.towStuck > 1.1) {
          ch.dragging.body.setTranslation({ x: cp.x - Math.sin(ch.yaw) * 0.9, y: cp.y, z: cp.z - Math.cos(ch.yaw) * 0.9 }, true);
          ch.dragging.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          t.towStuck = 0;
        }
      }
      const wp = t.route?.[0];
      if (wp) {
        const p = ch.pos;
        const d = Math.hypot(wp.x - p.x, wp.z - p.z);
        if (d < 0.9) { t.route.shift(); continue; }
        this._steer(ch, wp.x, wp.z, 0.95, dt); // called staff RUN
        continue;
      }
      ch.applyMove(0, 0);
      this['_task_' + t.type]?.(ch, t, dt);
    }
  }

  _done(ch) {
    this.tasks.delete(ch);
    this._drainQueue(ch);
  }

  // busy staffer? the order goes in their line (blinking orange room light).
  // Queue as many as you want — jobs run back-to-back in the order called.
  _queueJob(ch, job, sim, label) {
    (ch._jobQueue ??= []).push(job);
    if (job.kind === 'imaging') sim.imagingOrder = { modality: job.modality ?? 'TBD', phase: 'queued' };
    if (job.kind === 'labs') sim.labState = 'queued';
    if (job.kind === 'surgery') sim._surgQueued = true;
    this.ui.toast(`🟠 ${sim.displayName} queued for ${label} (#${ch._jobQueue.length} in line)`);
    this.audio?.blip?.();
  }

  _drainQueue(ch) {
    const q = ch._jobQueue;
    while (q?.length && !this.tasks.has(ch)) {
      const job = q.shift();
      const pt = [...this.world.byTag('patients')].find((p) => p.id === job.patientId);
      if (!pt || pt.sim.state === 'dead' || pt.sim.resolved) continue;
      const sim = pt.sim;
      if (job.kind === 'imaging') { sim.imagingOrder = null; this.orderImaging(pt, job.modality); }
      else if (job.kind === 'labs') { if (sim.labState === 'queued') sim.labState = 'none'; this.orderLabs(pt, job.panels); }
      else if (job.kind === 'surgery') { sim._surgQueued = false; this.orderSurgery(pt); }
      else if (job.kind === 'fetch') { this.orderMedFetch(pt, job.medId); }
    }
  }

  _playerNear(p, d) {
    for (const c of [this.nurse, this.doctor]) {
      const a = c.pos;
      if (Math.hypot(a.x - p.x, a.z - p.z) <= d) return true;
    }
    return false;
  }

  // the phlebotomist doesn't come to you — they scoop the patient up and DRAG
  // them to the lab, draw there, spin, and drag them back with the results
  _task_labs(ch, t, dt) {
    const sim = t.patient?.sim;
    if (!sim || sim.state === 'dead') {
      if (ch.dragging) { ch.dragging.draggedBy = null; ch.dragging = null; }
      this._done(ch); return;
    }
    if (t.phase === 'toPatient') {
      if (sim.state !== 'inbed' || sim.labState !== 'none') { this._done(ch); return; }
      if (t.panels) { this._labsGrab(ch, t); return; }
      // no panels chosen — the phlebotomist waits for YOU at the bedside
      t.phase = 'awaitChoice';
      this.ui.bubbles.say(ch, '🧪 Which panels am I sending? Come tell me.', { hold: 4.5 });
      return;
    }
    if (t.phase === 'awaitChoice') {
      if (sim.state !== 'inbed') { this._done(ch); return; }
      if (!this._playerNear(ch.pos, 3.2)) { t.asked = false; return; }
      if (!t.asked && !this.ui.modals.open) { t.asked = true; this.ui.modals.labPick({ patient: t.patient, task: t }); }
      return;
    }
    if (t.phase === 'toLab') {
      // park them by the machine and get the needle in (fallthrough below)
      ch.dragging = null; t.patient.draggedBy = null;
      t.patient.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      t.patient.body.setTranslation({ x: -0.9, y: 0.95, z: -1.8 }, true);
      sim.state = 'transport';
      t.phase = 'draw'; t.wait = 0;
      return;
    }
    if (t.phase === 'draw') {
      t.wait += dt;
      if (t.wait < 1.5) return;
      const c = this.map.centrifuge;
      if (c.busy) return; // queue behind whoever's spinning
      sim.labState = 'spinning';
      c.busy = { patientId: t.patient.id };
      c.timer = 20;
      this.ui.toast('🩸 Drawn in the lab — centrifuge spinning (20s)...');
      t.phase = 'waitSpin';
      return;
    }
    if (t.phase === 'waitSpin') {
      const paper = [...this.world.byTag('items')].find((i) =>
        i.itemKind === 'paper' && !i.heldBy && i.data.patientId === t.patient.id);
      if (!paper) return;
      ch.carrying = paper; paper.heldBy = ch;
      // results in one hand, patient in the other — back to their room
      sim.onGrabbed();
      sim.state = 'transport';
      sim.bed = t.bed; t.bed.occupant = t.patient;
      ch.dragging = t.patient; t.patient.draggedBy = ch;
      t.phase = 'toRoomBack';
      const rd2 = this.map.roomDoor(t.bed.index);
      t.route = [
        { x: -2, z: -2.6 },                                        // back out the lab door
        { x: -2, z: -5.4 },
        ...this._routeTo({ x: -2, z: -5.6 }, { x: rd2.x, z: -5.6 }),
        { x: rd2.x, z: -6 },
        { x: t.bed.x + 0.9, z: t.bed.z + 1.1 },
      ];
      return;
    }
    if (t.phase === 'toRoomBack') {
      ch.dragging = null; t.patient.draggedBy = null;
      this.bedPatient(t.patient, t.bed);
      const desk = this.map.roomDesks[t.bed.roomNo - 1];
      const item = ch.carrying;
      if (item && desk) {
        ch.carrying = null; item.heldBy = null;
        item.data.clip = 'labs';
        item.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        item.body.setTranslation({ x: desk.x, y: desk.y + 0.04, z: desk.z }, true);
        this.ui.toast(`📋 Lab results on the desk — Room ${t.bed.roomNo}`, 'good');
        this.audio.good();
      }
      t.phase = 'home';
      t.route = this._routeTo(ch.pos, this.map.nurseSpawn);
      return;
    }
    this._done(ch);
  }

  // the diagnostics machine is a shapeshifter — one dock, every study a real
  // doctor would order. The tech runs whichever one you pick at the machine.
  static MODALITIES = [
    { id: 'XRAY', label: 'X-ray', t: 12, match: ['cxr', 'ankle'] },
    { id: 'US', label: 'Ultrasound', t: 16, match: ['ct_freefluid'] },
    { id: 'ECHO', label: 'Echo + bubble study', t: 20, match: ['echo'] },
    { id: 'EKG12', label: '12-lead EKG', t: 8, match: ['ekg'] },
    { id: 'CT', label: 'CT', t: 22, match: ['ct'] },
    { id: 'CTC', label: 'CT + contrast', t: 30, match: ['ct'] },
    { id: 'MRI', label: 'MRI', t: 45, match: ['mri'] },
    { id: 'MRIC', label: 'MRI + contrast', t: 70, match: ['mri'] },
    { id: 'SCOPE', label: 'Endoscopy', t: 35, match: ['scope'] },
    { id: 'BIOPSY', label: 'Biopsy', t: 40, match: ['biopsy'] },
    { id: 'STRESS', label: 'Stress test', t: 50, match: ['stress'] },
  ];

  // the surgery team's menu — pick right and it's curative, pick wrong and
  // you just operated on someone for fun
  static SURGERIES = [
    { id: 'chest_tube', label: 'Chest tube', t: 14 },
    { id: 'debridement', label: 'Surgical debridement', t: 24 },
    { id: 'peri_window', label: 'Pericardial window', t: 26 },
    { id: 'orif', label: 'ORIF (fracture fixation)', t: 28 },
    { id: 'appendectomy', label: 'Appendectomy', t: 30 },
    { id: 'salpingectomy', label: 'Salpingectomy (ectopic)', t: 30 },
    { id: 'cholecystectomy', label: 'Cholecystectomy', t: 32 },
    { id: 'laminectomy', label: 'Decompressive laminectomy', t: 36 },
    { id: 'exlap', label: 'Exploratory laparotomy', t: 38 },
    { id: 'thoracotomy', label: 'Thoracotomy', t: 40 },
    { id: 'craniotomy', label: 'Craniotomy', t: 45 },
    { id: 'cabg', label: 'CABG', t: 60 },
  ];

  _task_imaging(ch, t, dt) {
    const sim = t.patient?.sim;
    if (!sim || sim.state === 'dead') {
      if (ch.dragging) { ch.dragging.draggedBy = null; ch.dragging = null; }
      if (sim) sim.imagingOrder = null;
      this._done(ch); return;
    }
    if (t.phase === 'toRoom') {
      if (sim.state !== 'inbed') { sim.imagingOrder = null; this._done(ch); return; }
      sim.lastRoomNo = sim.bed?.roomNo;
      sim.onGrabbed();
      sim.state = 'transport';
      sim.bed = t.bed; t.bed.occupant = t.patient; // reserve the room
      ch.dragging = t.patient; t.patient.draggedBy = ch;
      t.phase = 'toDock';
      const rd = this.map.roomDoor(t.bed.index);
      t.route = [
        { x: rd.x, z: -6 },                                              // out the room door
        { x: this.map.diagnostics.door.x, z: this.map.diagnostics.door.z - 1 },
        { x: this.map.diagnostics.dock.x, z: this.map.diagnostics.dock.z },
      ];
      return;
    }
    if (t.phase === 'toDock') {
      ch.dragging = null; t.patient.draggedBy = null;
      t.patient.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      t.patient.body.setTranslation({ x: this.map.diagnostics.dock.x, y: 0.95, z: this.map.diagnostics.dock.z }, true);
      sim.state = 'transport';
      if (t.modality) { this.beginScan(t, t.modality); return; }
      // no study chosen yet — the tech waits for YOU to come and order one
      t.phase = 'awaitChoice';
      this.ui.toast('🧑‍⚕️ Tech: patient is on the machine — come to DIAGNOSTICS and order the study.');
      this.ui.bubbles.say(this.tech, '📷 What are we running? Come tell me.', { hold: 5 });
      return;
    }
    if (t.phase === 'awaitChoice') {
      if (!this._playerNear(this.map.diagnostics.dock, 3.4)) { t.asked = false; return; }
      if (!t.asked && !this.ui.modals.open) { t.asked = true; this.ui.modals.studyPick(t); }
      return;
    }
    if (t.phase === 'scanning') {
      t.wait -= dt;
      if (t.wait > 0) return;
      if (!t.modality) { this._done(ch); return; }
      const img = sim.case.imaging;
      const matches = img && t.modality.match.some((pre) => img.type.startsWith(pre));
      t.report = matches
        ? { text: `${t.modality.id} RESULT: ${img.options[img.correct]}`, img: generateScan(img.type, sim.scanSeed) }
        : { text: `${t.modality.id} RESULT: no acute findings on this study.`, img: null };
      if (matches) sim.imagingDone = true;
      sim.imagingOrder = null;
      sim.onGrabbed();
      sim.state = 'transport';
      sim.bed = t.bed; t.bed.occupant = t.patient;
      ch.dragging = t.patient; t.patient.draggedBy = ch;
      t.phase = 'toRoomBack';
      const rd2 = this.map.roomDoor(t.bed.index);
      t.route = [
        { x: this.map.diagnostics.door.x, z: this.map.diagnostics.door.z + 1 }, // inside the door
        { x: this.map.diagnostics.door.x, z: -5.4 },                            // out to the corridor
        { x: rd2.x, z: -6 },
        { x: t.bed.x + 0.9, z: t.bed.z + 1.1 },
      ];
      return;
    }
    if (t.phase === 'toRoomBack') {
      ch.dragging = null; t.patient.draggedBy = null;
      this.bedPatient(t.patient, t.bed);
      const desk = this.map.roomDesks[t.bed.roomNo - 1];
      const clip = spawnCarryable(this, 'paper', desk.x, desk.y + 0.04, desk.z,
        { patientId: t.patient.id, label: `Imaging: ${sim.displayName}`, clip: 'imaging', report: t.report });
      clip.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      clip.body.setTranslation({ x: desk.x, y: desk.y + 0.04, z: desk.z }, true);
      this.ui.toast(`📋 Imaging report on the desk — Room ${t.bed.roomNo}`, 'good');
      this.audio.good();
      t.phase = 'home';
      t.route = this._routeTo(ch.pos, this.map.porterSpawn);
      return;
    }
    this._done(ch);
  }

  // scoop the patient up and haul them to the lab (panels already chosen)
  _labsGrab(ch, t) {
    const sim = t.patient.sim;
    if (sim.state !== 'inbed') { this._done(ch); return; }
    sim.lastRoomNo = sim.bed?.roomNo;
    t.bed = sim.bed; t.bed.occupant = t.patient; // hold their room
    sim.onGrabbed();
    sim.state = 'transport';
    sim.bed = t.bed;
    ch.dragging = t.patient; t.patient.draggedBy = ch;
    t.phase = 'toLab';
    const rd = this.map.roomDoor(t.bed.index);
    t.route = [
      { x: rd.x, z: -6 },                                         // out the room door
      ...this._routeTo({ x: rd.x, z: -5.6 }, { x: -2, z: -5.2 }), // corridor (zone doors included)
      { x: -2, z: -2.6 },                                         // in the lab door
      { x: -0.9, z: -1.8 },                                       // beside the centrifuge
    ];
  }

  beginScan(t, M) {
    const sim = t.patient.sim;
    t.modality = M;
    sim.imagingOrder = { modality: M.id, phase: 'scanning' };
    t.phase = 'scanning';
    t.wait = M.t;
    this.ui.toast(`📷 ${M.label} running on ${sim.displayName} (${M.t}s)...`);
    this.audio.tap();
  }

  beginSurgery(t, S) {
    t.surgery = S;
    t.phase = 'operating';
    t.wait = S.t;
    this.ui.toast(`🔪 ${S.label} underway (${S.t}s)...`);
    this.ui.bubbles.say(this.surgeon, '🔪 Scrubbing in.', { hold: 3 });
  }

  // the surgery team comes to the ROOM, then waits for you to pick the op
  _task_surgery(ch, t, dt) {
    const sim = t.patient?.sim;
    if (!sim || sim.state === 'dead') { this._done(ch); return; }
    if (t.phase === 'toPatient') {
      if (sim.state !== 'inbed') { this._done(ch); return; }
      t.phase = 'awaitChoice';
      this.ui.bubbles.say(ch, '🔪 What are we doing? Come tell me.', { hold: 4.5 });
      return;
    }
    if (t.phase === 'awaitChoice') {
      if (sim.state !== 'inbed') { this._done(ch); return; }
      if (!this._playerNear(ch.pos, 3.2)) { t.asked = false; return; }
      if (!t.asked && !this.ui.modals.open) { t.asked = true; this.ui.modals.surgeryPick(t); }
      return;
    }
    if (t.phase === 'operating') {
      t.wait -= dt;
      if (t.wait > 0) return;
      sim.surgeryDone = t.surgery.id;
      if (sim.case.surgery && sim.case.surgery === t.surgery.id) {
        applyTreatment(this, sim);
        this.addScore(140, 'Correct surgery');
        this.ui.toast(`✅ ${t.surgery.label} went beautifully.`, 'good');
        this.audio.good();
      } else {
        this.addScore(-80, 'Unnecessary surgery');
        this.ui.toast(`⚠ ${t.surgery.label}... that was NOT the operation they needed.`, 'bad');
        sim.accel *= 2;
        if (!sim.case.surgery && this.rng.chance(0.25)) sim._goCritical();
      }
      t.phase = 'home';
      t.route = this._routeTo(ch.pos, this.map.doctorSpawn);
      return;
    }
    this._done(ch);
  }

  _task_fetch(ch, t, dt) {
    const sim = t.patient?.sim;
    if (t.phase === 'toPharmacy') {
      t.wait += dt;
      if (t.wait > 1.2) {
        const med = medById(t.medId);
        const a = ch.handAnchor();
        const item = spawnCarryable(this, 'med', a.x, a.y, a.z, { medId: med.id, color: med.color, label: med.name });
        ch.carrying = item; item.heldBy = ch;
        t.phase = 'toPatient'; t.wait = 0;
        t.route = sim?.bed ? this._routeToRoomBed(ch.pos, sim.bed) : this._routeTo(ch.pos, t.patient.body.translation());
      }
      return;
    }
    if (t.phase === 'toPatient') {
      if (sim && sim.canReceiveMeds() && ch.carrying) {
        const id = ch.carrying.data.medId;
        this._consumeHeld(ch);
        giveMed(this, t.patient, id);
      } else if (ch.carrying) {
        this._consumeHeld(ch); // patient gone — return the med
      }
      t.phase = 'home';
      t.route = this._routeTo(ch.pos, this.map.nurseSpawn);
      return;
    }
    this._done(ch);
  }

  _spawnSkid(x, z, yaw) {
    // two thin parallel lines where the HEELS scrape — the feet trail behind
    // the dragged body, spaced a hip apart
    const fx = x - Math.sin(yaw) * 0.55, fz = z - Math.cos(yaw) * 0.55;
    const px = Math.cos(yaw), pz = -Math.sin(yaw); // perpendicular to travel
    for (const side of [-0.13, 0.13]) {
      const f = this.fx.skids[this.fx.skidIdx];
      this.fx.skidIdx = (this.fx.skidIdx + 1) % this.fx.skids.length;
      f.mesh.position.set(fx + px * side, 0.028, fz + pz * side);
      f.mesh.rotation.z = -yaw + (this.rng.next() - 0.5) * 0.12;
      f.mesh.visible = true;
      f.life = 1;
    }
  }

  _spawnDust(x, z) {
    const f = this.fx.dusts[this.fx.dustIdx];
    this.fx.dustIdx = (this.fx.dustIdx + 1) % this.fx.dusts.length;
    f.sp.position.set(x, 0.16, z);
    f.sp.visible = true;
    f.life = 1;
  }

  _postPhysics(dt) {
    // dragged bodies squeak out skid marks; sprinters kick dust
    for (const ch of this.world.byTag('chars')) {
      if (ch.dragging) {
        const dp = ch.dragging.body.translation();
        if (!ch._lastSkid) ch._lastSkid = { x: dp.x, z: dp.z };
        else if (Math.hypot(dp.x - ch._lastSkid.x, dp.z - ch._lastSkid.z) > 0.42) {
          const dv = ch.dragging.body.linvel();
          this._spawnSkid(dp.x, dp.z, Math.atan2(dv.x, dv.z));
          ch._lastSkid = { x: dp.x, z: dp.z };
        }
      } else ch._lastSkid = null;
      const v = ch.body.linvel();
      if (Math.hypot(v.x, v.z) > 4.2) {
        ch._dustT = (ch._dustT ?? 0) + dt;
        if (ch._dustT > 0.16) {
          const cp = ch.pos;
          this._spawnDust(cp.x - Math.sin(ch.yaw) * 0.3, cp.z - Math.cos(ch.yaw) * 0.3);
          ch._dustT = 0;
        }
      }
    }

    // angry patients trash the lobby: shove any loose prop within arm's reach
    for (const p of this.world.byTag('patients')) {
      const sim0 = p.sim;
      if (sim0.state !== 'angry') continue;
      sim0._shoveT = (sim0._shoveT ?? 0) - dt;
      if (sim0._shoveT > 0) continue;
      const pp = p.body.translation();
      for (const it of this.world.byTag('items')) {
        if (it.heldBy || it.itemKind !== 'prop') continue;
        const ip = it.body.translation();
        const dx = ip.x - pp.x, dz = ip.z - pp.z, d = Math.hypot(dx, dz);
        if (d > 1.35) continue;
        it.body.applyImpulse({
          x: (dx / (d || 1)) * (2.2 + this.rng.next() * 2.4),
          y: 1.4 + this.rng.next() * 1.4,
          z: (dz / (d || 1)) * (2.2 + this.rng.next() * 2.4),
        }, true);
        sim0._shoveT = 0.45;
        break;
      }
    }

    // tackle connects: a lunging character near an agitated runner pins them
    for (const c of this.world.byTag('chars')) {
      if (c.tackleTimer <= 0) continue;
      const pt = this.nearestPatient(c, 1.15, (s) => s.state === 'agitated');
      if (pt) { pt.sim.pin(); c.tackleTimer = 0; this.addScore(30, 'Takedown!'); }
    }
    // ---- stations react to what you physically bring them (no verb menus) ----
    // bed: monitor leads hook themselves up a moment after a patient is bedded
    for (const p of this.world.byTag('patients')) {
      const sim = p.sim;
      if (sim.state === 'inbed' && !sim.hooked) {
        sim.hookT = (sim.hookT ?? 0) + dt;
        if (sim.hookT > 1.6) { sim.hooked = true; this.addScore(10, 'On the monitor'); this.audio.tap(); }
      } else sim.hookT = 0;
    }
    // holding a med against a patient administers it (short dwell).
    // Bedded/pinned/agitated patients take priority over random bystanders —
    // no more sedating the waiting room by accident.
    for (const ch of this.world.byTag('chars')) {
      if (ch.carrying?.itemKind !== 'med') { ch.medDwell = 0; continue; }
      const pt = this.nearestPatient(ch, 1.7, (s) => ['inbed', 'pinned', 'sedated', 'agitated'].includes(s.state))
        ?? this.nearestPatient(ch, 1.4, (s) => s.canReceiveMeds());
      if (!pt) { ch.medDwell = 0; continue; }
      if (ch.medDwell === 0) this.ui.bubbles.say(pt, '💉…', { cls: 'order', hold: 1.4 });
      ch.medDwell += dt;
      if (ch.medDwell > 1.2) {
        const medId = ch.carrying.data.medId;
        this._consumeHeld(ch);
        ch.medDwell = 0;
        giveMed(this, pt, medId);
      }
    }
    // centrifuge: feed it a vial — held into the zone or dropped into it
    const c = this.map.centrifuge;
    if (!c.busy) {
      for (const it of [...this.world.byTag('items')]) {
        if (it.itemKind !== 'vial') continue;
        const p = it.body.translation();
        if (Math.hypot(p.x - c.x, p.z - c.z) > 1.5) continue;
        const pid = it.data.patientId;
        if (it.heldBy) { it.heldBy.carrying = null; }
        this.world.remove(it, this);
        c.busy = { patientId: pid };
        c.timer = 20;
        const pt = [...this.world.byTag('patients')].find((q) => q.id === pid);
        if (pt) pt.sim.labState = 'spinning';
        this.ui.toast('🌀 Centrifuge spinning (20s)...');
        break;
      }
    }
    // incinerator: a corpse in the pit gets the send-off (and ¼ credit)
    const pit = this.map.firePit;
    for (const p of [...this.world.byTag('patients')]) {
      const sim = p.sim;
      if (sim.incinerating > 0) {
        sim.incinerating -= dt;
        if (sim.incinerating <= 0) {
          this.dayStats.treated += 0.25;
          this.addScore(Math.round(sim.case.score * 0.1), 'Ashes to ashes');
          this.ui.toast(`🔥 ${sim.displayName} incinerated. +¼ treatment credit. We don't talk about this.`, 'bad');
          this.removePatient(p);
        }
        continue;
      }
      if (sim.state !== 'dead') continue;
      const t = p.body.translation();
      if (Math.hypot(t.x - pit.x, t.z - pit.z) < pit.r) {
        if (p.draggedBy) { p.draggedBy.dragging = null; p.draggedBy = null; }
        sim.incinerating = 1.3;
        this.map.fire.flare = 1.6;
        this.audio.bad();
      }
    }

    if (c.busy) {
      c.timer -= dt;
      c.mesh.userData.drum.rotation.y += dt * 24;
      if (c.timer <= 0) {
        const pt = [...this.world.byTag('patients')].find((p) => p.id === c.busy.patientId);
        const label = pt ? `Results: ${pt.sim.displayName}` : 'Results (deceased?)';
        const paper = spawnCarryable(this, 'paper', c.outX, 1, c.outZ, { patientId: c.busy.patientId, label });
        if (pt) pt.sim.labState = 'ready';
        this.ui.toast('🧪 Centrifuge done — results printed!', 'good');
        this.audio.good();
        c.busy = null;
      }
    }
  }

  renderFrame(dt) {
    const now = this.timeReal;
    for (const c of this.world.byTag('chars')) c.syncMesh(dt, now);
    for (const p of this.world.byTag('patients')) {
      syncPatientMesh(p, dt, now);
      if (p.sim.incinerating > 0) { // sink + shrink into the flames
        const f = Math.max(0.05, p.sim.incinerating / 1.3);
        p.mesh.scale.setScalar(f);
        p.mesh.position.y -= (1 - f) * 0.9;
      }
    }
    // room status lights: green stable · yellow waiting on results · red crashing
    this.map.beds.forEach((bed, i) => {
      const L = this.map.roomLights[i];
      if (!L) return;
      const sim2 = bed.occupant?.sim;
      let c = 0x8a94a4, inten = 0.25;
      if (sim2) {
        const queued = sim2.imagingOrder?.phase === 'queued' || sim2.labState === 'queued' || sim2._surgQueued;
        if (sim2.state === 'dead') { c = 0x60646e; inten = 0.4; }
        else if (sim2.critical) { c = 0xff2e2e; inten = 1.4 + Math.sin(now * 10) * 1.2; }
        else if (queued) { c = 0xff8c1a; inten = (now % 0.9) < 0.45 ? 1.6 : 0.15; } // in line — blink orange
        else if (sim2.stabilized) { c = 0x35e06a; inten = 1.3; }
        else if (sim2.labsPending || sim2.imagingOrder) { c = 0xffc23c; inten = 1.0; }
        else { c = 0x6fa8ff; inten = 0.55; }
      }
      L.mat.color.setHex(c); L.mat.emissive.setHex(c); L.mat.emissiveIntensity = inten;
    });

    animateRig(this.receptionist, dt, now, 0, { sitting: true }); // typing away forever

    // FX fades: skids over 5s (oldest first), dust puffs fast
    for (const f of this.fx.skids) {
      if (f.life <= 0) continue;
      f.life -= dt / 5;
      if (f.life <= 0) { f.mesh.visible = false; continue; }
      f.mesh.material.opacity = f.life * 0.38;
    }
    for (const f of this.fx.dusts) {
      if (f.life <= 0) continue;
      f.life -= dt * 2.4;
      if (f.life <= 0) { f.sp.visible = false; continue; }
      const sc = 0.35 + (1 - f.life) * 0.8;
      f.sp.scale.set(sc, sc, 1);
      f.sp.material.opacity = f.life * 0.4;
    }

    // the pit flickers; flares when fed
    const fire = this.map.fire;
    fire.flare = Math.max(0, fire.flare - dt * 1.2);
    fire.flames.forEach((f, i) => {
      const s = 0.75 + Math.sin(now * 9 + i * 1.7) * 0.25 + fire.flare;
      f.scale.set(s, s * (1 + Math.sin(now * 13 + i) * 0.3), s);
    });
    fire.glow.material.opacity = 0.4 + Math.sin(now * 7) * 0.12 + fire.flare * 0.3;
    // interactable glow rings pulse when the active character is close
    const ap0 = this.active.pos;
    for (const r of this.map.rings) {
      const near = Math.hypot(r.x - ap0.x, r.z - ap0.z) < 3.2;
      const target = near ? 0.55 + Math.sin(now * 5) * 0.2 : 0.18;
      r.mesh.material.opacity += (target - r.mesh.material.opacity) * 0.15;
    }
    // drop-target ring glows on the nearest free bed while hauling a patient
    const dr = this.map.dropRing;
    if (this.active.dragging) {
      const bed = this._nearestFreeBed(this.active.dragging, 7);
      if (bed) {
        dr.position.set(bed.x, (bed.y ?? 0) + 0.05, bed.z);
        dr.material.opacity += (0.65 + Math.sin(now * 6) * 0.2 - dr.material.opacity) * 0.25;
      } else dr.material.opacity *= 0.85;
    } else dr.material.opacity *= 0.85;
    for (const it of this.world.byTag('items')) {
      const t = it.body.translation(), r = it.body.rotation();
      it.mesh.position.set(t.x, t.y, t.z);
      it.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    const ap = this.active.pos;
    this.renderer.follow(_v3.set(ap.x, ap.y - 0.9, ap.z), dt);
    this.ui.update(dt, this.timeReal);
    this.renderer.render();
  }

  // ---------------- intents ----------------
  enqueue(intent) { this.intentQueue.push(intent); }

  applyIntent(i) {
    const char = [...this.world.byTag('chars')].find((c) => c.id === i.actorId) ?? this.active;
    switch (i.type) {
      case INTENT.MOVE: char.applyMove(i.payload.x, i.payload.z); char._moveTick = this._tickN; break;
      case INTENT.GRAB: char.grabHeld = true; char.tryGrab(); break;
      case INTENT.RELEASE: char.grabHeld = false; char.release(); break;
      case INTENT.ACTION: this.actionContext(char)?.run(); break;
      case INTENT.TACKLE: char.tackle(); break;
      case INTENT.SWAP_ROLE:
        this.activeIdx ^= 1;
        this.ui.toast(`You are now the ${this.active.role.toUpperCase()}`);
        break;
      case INTENT.ORDER: this._handleOrder(char, i.payload); break;
      case INTENT.SELECT: this.ui.modals.resolve(i.payload.choice, char, i.payload.text); break;
    }
  }

  _handleOrder(char, { order, patientId }) {
    const pt = [...this.world.byTag('patients')].find((p) => p.id === patientId);
    if (!pt) { this.ui.toast('No patient nearby'); return; }
    if (order === 'labs') { this.orderLabs(pt); return; }
    if (order === 'imaging') { this.orderImaging(pt); return; } // study chosen AT the machine
    if (order === 'surgery') { this.orderSurgery(pt); return; }
    if (order === 'dx') { this.ui.modals.diagnose(pt); return; }
    if (order === 'consult') { this.ui.modals.consult(pt); return; }
    if (order === 'discharge') {
      if (pt.sim.stabilized) {
        const sim = pt.sim;
        sim.resolved = true;
        this.dayStats.treated += 1;
        this.addScore(Math.round(sim.case.score * (sim.dxPicked === 0 ? 1 : 0.55)), 'Discharged well');
        this.ui.toast(`🏠 ${sim.displayName} walking home!`, 'good');
        if (sim.bed) this.freeBed(sim);
        this.setPatientDynamic(pt);
        sim.state = 'leaving';
        sim.route = this._routeTo(pt.body.translation(), this.map.discharge).concat([{ ...this.map.gateOut }]);
        sim.walkTarget = sim.route.shift();
      } else {
        this.ui.toast('They are NOT stable yet — monitor them longer.', 'bad');
      }
    }
  }

  // ---------------- context action ----------------
  // Deliberately small: physical outcomes (bedding, meds, centrifuge, scans)
  // happen by bringing things places. ACTION covers only the deliberate
  // medical acts: reading results, drawing blood, the cabinet, diagnosing.
  actionContext(char) {
    const held = char.carrying;
    // manual triggers for everything a station also does automatically —
    // the button makes the interaction legible, the auto keeps it forgiving
    if (held?.itemKind === 'med') {
      const pt = this.nearestPatient(char, 1.9, (s) => s.canReceiveMeds());
      if (pt) {
        const sedating = held.data.medId === 'sedative' && ['agitated', 'pinned'].includes(pt.sim.state);
        return {
          ico: sedating ? '💉' : '💊', color: '#21b573',
          label: sedating ? 'SEDATE' : `GIVE ${held.label.toUpperCase()}`,
          run: () => { const id = held.data.medId; this._consumeHeld(char); giveMed(this, pt, id); },
        };
      }
    }
    if (held?.itemKind === 'vial') {
      const c = this.map.centrifuge;
      const p = char.pos;
      if (!c.busy && Math.hypot(p.x - c.x, p.z - c.z) < 2.2) {
        return {
          ico: '🌀', label: 'LOAD CENTRIFUGE', color: '#36b5c9',
          run: () => {
            const pid = held.data.patientId;
            this._consumeHeld(char);
            c.busy = { patientId: pid };
            c.timer = 20;
            const pt = [...this.world.byTag('patients')].find((q) => q.id === pid);
            if (pt) pt.sim.labState = 'spinning';
            this.ui.toast('🌀 Centrifuge spinning (20s)...');
          },
        };
      }
    }
    // clipboards on room desks
    if (!held) {
      const cp0 = char.pos;
      let clip = null, cd = 1.8;
      for (const it of this.world.byTag('items')) {
        if (it.itemKind !== 'paper' || !it.data.clip || it.heldBy) continue;
        const ip = it.body.translation();
        const d = Math.hypot(ip.x - cp0.x, ip.z - cp0.z);
        if (d < cd) { clip = it; cd = d; }
      }
      if (clip) {
        return {
          ico: '📋', label: clip.data.clip === 'imaging' ? 'READ IMAGING' : 'READ LABS', color: '#c9a83c',
          run: () => {
            const pt2 = [...this.world.byTag('patients')].find((p) => p.id === clip.data.patientId);
            if (clip.data.clip === 'imaging') this.ui.modals.report(clip);
            else if (pt2) this.ui.modals.labResults(pt2);
            else this.ui.toast('Patient is gone...');
          },
        };
      }
    }
    if (held?.itemKind === 'paper') {
      const pt = [...this.world.byTag('patients')].find((p) => p.id === held.data.patientId);
      return {
        ico: '📄', label: 'READ RESULTS', color: '#c9a83c',
        run: () => {
          if (!pt) { this.ui.toast('Patient is gone...'); return; }
          if (char.role === 'doctor' && pt.sim.labState !== 'read') this.addScore(15, 'Results to the doctor');
          this.ui.modals.labResults(pt);
        },
      };
    }

    // a staffer standing by, waiting for your order (tech at the machine,
    // surgeon at the bedside) — the clipboard re-opens their menu
    const cp = char.pos;
    for (const [ch2, t2] of this.tasks) {
      if (t2.phase !== 'awaitChoice') continue;
      const sp = ch2.pos;
      if (Math.hypot(sp.x - cp.x, sp.z - cp.z) > 3.2) continue;
      if (t2.type === 'imaging') return { ico: '📷', label: 'ORDER STUDY', color: '#4a6a78', run: () => this.ui.modals.studyPick(t2) };
      if (t2.type === 'labs') return { ico: '🧪', label: 'ORDER PANELS', color: '#36b5c9', run: () => this.ui.modals.labPick({ patient: t2.patient, task: t2 }) };
      return { ico: '🔪', label: 'CHOOSE SURGERY', color: '#9e4a56', run: () => this.ui.modals.surgeryPick(t2) };
    }

    // MED-DOC 4000: the consult terminal at the east end of the staff desk
    {
      const md = this.map.medDoc;
      const pp = char.pos;
      if (md && Math.hypot(pp.x - md.x, pp.z - md.z) < 1.7) {
        return { ico: '🖥', label: 'MED-DOC 4000', color: '#2fae5f', run: () => this.ui.modals.medDoc() };
      }
    }
    // med cabinet: any pharmacy shelf is a face of the same tabbed cabinet
    const nearShelf = this.map.shelfUnits.some((u) => Math.hypot(u.x - cp.x, u.z - cp.z) < 2.3);
    if (nearShelf) return { ico: '💊', label: 'OPEN MED CABINET', color: '#d05a9e', run: () => this.ui.modals.cabinet() };

    const pt = this.nearestPatient(char, 1.9, (s) => s.state !== 'dead');
    if (pt && pt.sim.state === 'inbed') {
      const sim = pt.sim;
      if (!held && !sim.chartSeen) {
        return {
          ico: '📋', label: 'WORKUP', color: '#2f80ff',
          run: () => this.ui.modals.workup(pt),
        };
      }
      if (!held && sim.labState === 'none' && sim.case.labs) {
        // bedside draw — but you still CHOOSE the panels first
        return {
          ico: '🩸', label: 'DRAW BLOOD', color: '#d05450',
          run: () => this.ui.modals.labPick({ patient: pt }),
        };
      }
      return { ico: '📋', label: 'WORKUP', color: '#2f80ff', run: () => this.ui.modals.workup(pt) };
    }

    // de-escalation comes AFTER bedside medicine — an angry patient raging two
    // rooms over must never bury the workup button
    const angryPt = this.nearestPatient(char, 2.2, (s) => s.state === 'angry');
    if (angryPt) {
      return { ico: '🗣️', label: 'TALK THEM DOWN', color: '#e0952f', run: () => this.ui.modals.talk(angryPt) };
    }
    return null;
  }

  _consumeHeld(char) {
    const it = char.carrying;
    if (!it) return;
    char.carrying = null;
    this.world.remove(it, this);
  }

  // ---------------- patients / beds ----------------
  nearestPatient(char, maxD, filter) {
    const a = char.pos;
    let best = null, bd = maxD;
    for (const p of this.world.byTag('patients')) {
      if (filter && !filter(p.sim)) continue;
      const t = p.body.translation();
      const d = Math.hypot(t.x - a.x, t.z - a.z);
      if (d < bd) { best = p; bd = d; }
    }
    return best;
  }

  _nearestFreeBed(pt, maxD) {
    const t = pt.body.translation();
    let best = null, bd = maxD;
    for (const b of this.map.beds) {
      if (b.occupant) continue;
      const d = Math.hypot(b.x - t.x, b.z - t.z);
      if (d < bd) { best = b; bd = d; }
    }
    return best;
  }

  onItemReleased(it, char) {
    // handing the paper to the other role counts as delivery
    if (it.itemKind === 'paper') {
      const other = char === this.nurse ? this.doctor : this.nurse;
      const p = it.body.translation(), o = other.pos;
      if (Math.hypot(p.x - o.x, p.z - o.z) < 1.6) this.ui.toast('Results handed over 🤝');
    }
  }

  onPatientReleased(pt, char) {
    const t = pt.body.translation();
    const dis = this.map.discharge;
    // dropped in the DISCHARGE room → the moment of truth
    if (Math.hypot(t.x - dis.x, t.z - dis.z) < dis.r && pt.sim.state !== 'dead') {
      this._dischargeAttempt(pt);
      return;
    }
    const bed = this._nearestFreeBed(pt, 2.9); // HFF forgiveness: "close enough" counts
    if (bed && !['dead'].includes(pt.sim.state)) { this.bedPatient(pt, bed); return; }
    this.setPatientDynamic(pt);
    if (!['sedated', 'dead', 'pinned', 'agitated'].includes(pt.sim.state)) pt.sim.state = 'waiting';
  }

  // stabilized + treated → they walk out the gate home. Otherwise... flop.
  _dischargeAttempt(pt) {
    const sim = pt.sim;
    if (sim.stabilized) {
      sim.resolved = true;
      const dxRight = sim.dxPicked === sim.case.correctDx;
      this.dayStats.treated += 1;
      this.addScore(Math.round(sim.case.score * (dxRight ? 1 : 0.55)), 'Discharged well');
      this.ui.toast(`🏠 ${sim.displayName} is going HOME! ${dxRight ? '' : '(dx was wrong, but they lived)'}`, 'good');
      this.audio.good();
      this.setPatientDynamic(pt);
      sim.state = 'leaving';
      pt.setFace('normal');
      sim._say('better');
      sim.route = [{ ...this.map.gateOut }];
      sim.walkTarget = { x: this.map.discharge.x, z: this.map.discharge.z - 3 };
    } else if (sim.treated) {
      // responding but not through the monitoring window yet — send them back,
      // don't kill them. Treatment earned them that much.
      this.setPatientDynamic(pt);
      sim.state = 'waiting';
      const left = Math.max(1, Math.ceil(({ discharge: 0, medsurge: 45, ob: 70, icu: 100 }[sim.case.treatment.dispo] ?? 0) - (this.clock.minutes - sim.tTreated)));
      this.ui.toast(`📻 ROOM SAYS NOT YET, SIR — responding but needs ~${left} more min of monitoring.`, 'bad', 4500);
      sim._sayRaw('Hey, I was told to REST!', 'angry');
    } else {
      // discharged untreated: they flop over, no pulse. The pit awaits.
      this.ui.toast(`☠ ${sim.displayName} was NOT stable. They're down — no pulse.`, 'bad');
      sim.treated = false;
      sim.die('discharged before stabilization');
    }
  }

  bedPatient(pt, bed) {
    const sim = pt.sim;
    bed.occupant = pt; sim.bed = bed;
    pt.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    pt.body.setTranslation({ x: bed.x, y: (bed.y ?? 0) + 1.05, z: bed.z + 0.15 }, true);
    pt.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    sim.state = 'inbed';
    sim.yaw = 0;
    pt.setFace(sim.critical ? 'crit' : 'normal');
    this.ui.toast(`${sim.displayName} → Room ${bed.roomNo ?? bed.index + 1}`);
    this.addScore(15, 'Admitted to a room');
  }

  _resolveWardPlacement(pt, bed) {
    const sim = pt.sim;
    const needMeds = sim.case.treatment.meds;
    const medsDone = needMeds.every((m) => sim.medsGiven.has(m));
    const rightWard = sim.case.treatment.dispo === bed.room;
    if (!medsDone && sim.case.treatment.dispo !== 'ob') {
      this.ui.toast(`${sim.displayName} still needs treatment before admission!`, 'bad');
      return; // parked in the ward bed, but not resolved
    }
    if (rightWard) {
      const wardName = { icu: 'ICU', medsurge: 'Med-Surge', ob: 'Birthplace' }[bed.room];
      if (bed.room === 'ob' && sim.case.id === 'labor') {
        sim.treated = true; sim.critical = false;
        this.ui.bubbles.say(pt, '👶 WAAAAH!', { hold: 5 });
      }
      this.resolvePatient(pt, 'admitted', `Admitted to ${wardName}`);
    } else {
      this.resolvePatient(pt, 'admitted_wrong', `Wrong ward... they’ll survive. Probably.`);
    }
  }

  resolvePatient(pt, outcome, note) {
    const sim = pt.sim;
    if (sim.resolved) return;
    sim.resolved = true;
    let pts = 0;
    const dxRight = sim.dxPicked === sim.case.correctDx;
    switch (outcome) {
      case 'discharged':
        pts = sim.case.score * (dxRight ? 1 : 0.5);
        this.dayStats.treated++;
        this.ui.toast(`🏠 ${sim.displayName} discharged! ${dxRight ? '' : '(dx was wrong, but hey)'}`, 'good');
        break;
      case 'discharged_sick':
        pts = -60;
        this.dayStats.walkedOut++;
        this.ui.toast(`${sim.displayName} discharged UNTREATED...`, 'bad');
        break;
      case 'admitted':
        pts = sim.case.score * (dxRight ? 1.2 : 0.6);
        this.dayStats.treated++;
        this.ui.toast(`✓ ${note}`, 'good');
        break;
      case 'admitted_wrong':
        pts = sim.case.score * 0.35;
        this.dayStats.treated++;
        this.ui.toast(note, 'bad');
        break;
    }
    if (pts) this.addScore(Math.round(pts), 'Case closed');
    this.audio.good();
    // leave the building or dissolve into the admitted ward
    if (outcome.startsWith('admitted')) {
      sim.state = 'inbed';
      this.timers.push({ at: this.timeReal + 6, fn: () => this.removePatient(pt) });
    } else {
      if (sim.bed) this.freeBed(sim);
      this.setPatientDynamic(pt);
      sim.state = 'leaving';
      sim.walkTarget = { ...this.map.spawnOutside };
      pt.setFace('normal');
    }
  }

  onDeath(sim, cause) {
    this.dayStats.died++;
    this.addScore(-150, 'Patient died');
    this.ui.toast(`💀 ${sim.displayName} died — ${cause}`, 'bad');
    this.audio.bad();
  }

  onWalkout(sim) {
    this.dayStats.walkedOut++;
    this.addScore(-40, 'Walked out');
  }

  // sit a walked-in patient down on their waiting-room chair
  seatPatient(sim) {
    const seat = sim.seat;
    sim.state = 'waiting';
    sim.sitting = true;
    sim.yaw = Math.PI; // chairs face north, into the department
    sim.ent.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    sim.ent.body.setTranslation({ x: seat.x, y: 0.86, z: seat.z + 0.02 }, true);
    sim.ent.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  freeBed(sim) {
    if (sim.bed) { sim.bed.occupant = null; sim.bed = null; }
    sim.hooked = false; // off the monitor leads — vitals stop displaying
    this.setPatientDynamic(sim.ent);
  }

  setPatientDynamic(pt) {
    if (pt.body.bodyType() !== RAPIER.RigidBodyType.Dynamic) {
      pt.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    }
  }

  removePatient(pt) {
    const sim = pt.sim;
    if (sim.bed) { sim.bed.occupant = null; sim.bed = null; }
    if (sim.seat) { sim.seat.taken = null; sim.seat = null; }
    if (pt.draggedBy) { pt.draggedBy.dragging = null; }
    this.world.remove(pt, this);
  }

  edOverCapacity() {
    const free = this.map.beds.filter((b) => !b.occupant).length;
    const waiting = [...this.world.byTag('patients')]
      .filter((p) => ['waiting', 'angry'].includes(p.sim.state)).length;
    return (free === 0 && waiting > 0) || waiting >= 8;
  }

  addScore(pts, reason) {
    this.score += pts;
    this.dayStats.score += pts;
  }
}

const _v3 = new THREE.Vector3();
