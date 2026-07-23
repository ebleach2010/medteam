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
import { spawnCarryable } from './entities/Carryable.js';
import { Spawner } from './sim/spawner.js';
import { giveMed } from './sim/treatment.js';
import { INTENT, make } from './intents/intents.js';
import { UI } from './ui/ui.js';
import { medById } from './data/meds.js';
import { dayConfig } from './data/days.js';

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
    this.activeIdx = 0;

    this.ui = new UI(this);
    this.intentQueue = [];
    this.timers = [];
    this.timeReal = 0;
    this.mode = 'title';
    this.score = 0;
    this.dayStats = this._freshStats();
    this._acc = 0;
    this._scanJob = null;

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
    this.clock.timeScale = dayConfig(this.clock.day).timeScale;
    this.dayStats = this._freshStats();
    this.mode = 'playing';
    this.clock.running = true;
    this.ui.screens.fade(false);
    this.ui.toast(`Day ${this.clock.day} — 12:00 AM. Here they come.`);
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
    this.ui.screens.fade(true);
    this.save.highestDay = Math.max(this.save.highestDay, this.clock.day + 1);
    this.save.totalTreated += this.dayStats.treated;
    this.save.totalDeaths += this.dayStats.died;
    this.save.bestDayScore = Math.max(this.save.bestDayScore, this.dayStats.score);
    writeSave(this.save);
    setTimeout(() => {
      this.ui.screens.fade(false);
      this.ui.screens.daySummary(this.dayStats, this.clock.day, () => {
        this.ui.screens.fade(true);
        setTimeout(() => {
          this.ui.screens.fade(false);
          this.startDay(this.clock.day + 1);
        }, 700);
      });
    }, 900);
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

    this.idle.applyMove(0, 0);
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

  _postPhysics(dt) {
    // tackle connects: a lunging character near an agitated runner pins them
    for (const c of this.world.byTag('chars')) {
      if (c.tackleTimer <= 0) continue;
      const pt = this.nearestPatient(c, 1.15, (s) => s.state === 'agitated');
      if (pt) { pt.sim.pin(); c.tackleTimer = 0; this.addScore(30, 'Takedown!'); }
    }
    // escorted walking patients auto-bed next to a free ED bed
    for (const p of this.world.byTag('patients')) {
      if (!p.escortedBy || !['escorted'].includes(p.sim.state)) continue;
      const bed = this._nearestFreeBed(p, 2.0);
      if (bed) { p.escortedBy = null; this.bedPatient(p, bed); }
    }
    // centrifuge
    const c = this.map.centrifuge;
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
    // imaging scan completes
    if (this._scanJob) {
      this._scanJob.t -= dt;
      if (this._scanJob.t <= 0) {
        const pt = this._scanJob.patient;
        this._scanJob = null;
        if (pt.mesh.parent) this.ui.modals.imaging(pt);
      }
    }
  }

  renderFrame(dt) {
    const now = this.timeReal;
    for (const c of this.world.byTag('chars')) c.syncMesh(dt, now);
    for (const p of this.world.byTag('patients')) syncPatientMesh(p, dt, now);
    // interactable glow rings pulse when the active character is close
    const ap0 = this.active.pos;
    for (const r of this.map.rings) {
      const near = Math.hypot(r.x - ap0.x, r.z - ap0.z) < 3.2;
      const target = near ? 0.55 + Math.sin(now * 5) * 0.2 : 0.18;
      r.mesh.material.opacity += (target - r.mesh.material.opacity) * 0.15;
    }
    for (const it of this.world.byTag('items')) {
      const t = it.body.translation(), r = it.body.rotation();
      it.mesh.position.set(t.x, t.y, t.z);
      it.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    const ap = this.active.pos;
    this.renderer.follow(_v3.set(ap.x, 0, ap.z), dt);
    this.ui.update(dt, this.timeReal);
    this.renderer.render();
  }

  // ---------------- intents ----------------
  enqueue(intent) { this.intentQueue.push(intent); }

  applyIntent(i) {
    const char = [...this.world.byTag('chars')].find((c) => c.id === i.actorId) ?? this.active;
    switch (i.type) {
      case INTENT.MOVE: char.applyMove(i.payload.x, i.payload.z); break;
      case INTENT.GRAB: char.tryGrab(); break;
      case INTENT.ACTION: this.actionContext(char)?.run(); break;
      case INTENT.TACKLE: char.tackle(); break;
      case INTENT.SWAP_ROLE:
        this.activeIdx ^= 1;
        this.ui.toast(`You are now the ${this.active.role.toUpperCase()}`);
        break;
      case INTENT.ORDER: this._handleOrder(char, i.payload); break;
      case INTENT.SELECT: this.ui.modals.resolve(i.payload.choice, char); break;
    }
  }

  _handleOrder(char, { order, patientId }) {
    const pt = [...this.world.byTag('patients')].find((p) => p.id === patientId);
    const ICONS = { labs: '🩸', imaging: '📷', meds: '💊', sedate: '💉', doctor: '❗' };
    if (char.role === 'nurse') {
      if (!pt) { this.ui.toast('No patient nearby to flag'); return; }
      pt.sim.orders.add(order);
      this.ui.bubbles.say(pt, ICONS[order] ?? '❔', { cls: 'order', hold: 4 });
      this.addScore(5, 'Order flagged');
      if (order === 'doctor') this.ui.bubbles.say(this.doctor, '❗', { cls: 'order', hold: 4 });
      return;
    }
    // doctor wheel
    if (order === 'dx') { if (pt) this.ui.modals.diagnose(pt); else this.ui.toast('Get closer to a patient'); return; }
    if (order === 'discharge') {
      if (pt) { pt.sim.wantsDischarge = true; this.ui.toast(`${pt.sim.displayName}: discharge ordered`); }
      return;
    }
    if (order?.startsWith('admit_')) {
      if (!pt) return;
      const ward = order.slice(6);
      pt.sim.orders.add(order);
      this.ui.bubbles.say(pt, ward === 'icu' ? '🫀' : ward === 'ob' ? '👶' : '🛏️', { cls: 'order', hold: 4 });
      this.ui.toast(`Admit order: take ${pt.sim.displayName} to ${ward.toUpperCase()}`);
    }
  }

  // ---------------- context action ----------------
  actionContext(char) {
    const held = char.carrying;
    if (held?.itemKind === 'med') {
      const pt = this.nearestPatient(char, 1.9, (s) => s.canReceiveMeds());
      if (pt) {
        const med = medById(held.data.medId);
        const sedating = held.data.medId === 'sedative' && ['agitated', 'pinned'].includes(pt.sim.state);
        return {
          ico: sedating ? '💉' : '💊', label: sedating ? 'SEDATE' : `GIVE ${med.name.split(' ')[0].toUpperCase()}`,
          run: () => { this._consumeHeld(char); giveMed(this, pt, held.data.medId); },
        };
      }
      return null;
    }
    if (held?.itemKind === 'vial') {
      const c = this.map.centrifuge, p = char.pos;
      if (Math.hypot(p.x - c.x, p.z - c.z) < 2.1 && !c.busy) {
        return {
          ico: '🌀', label: 'SPIN SAMPLE',
          run: () => {
            const pid = held.data.patientId;
            this._consumeHeld(char);
            c.busy = { patientId: pid };
            c.timer = 20; // real seconds — centrifuges don't care about your day
            const pt = [...this.world.byTag('patients')].find((q) => q.id === pid);
            if (pt) pt.sim.labState = 'spinning';
            this.ui.toast('Centrifuge spinning (20s)...');
          },
        };
      }
      return null;
    }
    if (held?.itemKind === 'paper') {
      const pt = [...this.world.byTag('patients')].find((p) => p.id === held.data.patientId);
      return {
        ico: '📄', label: 'READ RESULTS',
        run: () => {
          if (!pt) { this.ui.toast('Patient is gone...'); return; }
          if (char.role === 'doctor' && pt.sim.labState !== 'read') this.addScore(15, 'Results to the doctor');
          this.ui.modals.labResults(pt);
        },
      };
    }

    // empty-handed
    const pad = this.map.imagingPad;
    const onPad = this.nearestPatient(char, 2.2, (s) =>
      !['dead', 'agitated'].includes(s.state) && s.case.imaging && !s.imagingDone &&
      Math.hypot(s.ent.body.translation().x - pad.x, s.ent.body.translation().z - pad.z) < 2.0);
    if (onPad && !this._scanJob) {
      return {
        ico: '📷', label: 'SCAN',
        run: () => {
          this._scanJob = { patient: onPad, t: 3 };
          this.ui.toast('Scanning... hold still...');
          this.audio.tap();
        },
      };
    }

    // med cabinet: any pharmacy shelf is a face of the same tabbed cabinet
    const cp = char.pos;
    const nearShelf = this.map.shelfUnits.some((u) => Math.hypot(u.x - cp.x, u.z - cp.z) < 2.3);
    if (nearShelf) return { ico: '💊', label: 'MED CABINET', run: () => this.ui.modals.cabinet() };

    const pt = this.nearestPatient(char, 1.9, (s) => s.state !== 'dead');
    if (!pt) return null;
    const sim = pt.sim;
    if (sim.state === 'inbed') {
      if (!sim.hooked) return { ico: '📈', label: 'HOOK MONITOR', run: () => { sim.hooked = true; this.addScore(10, 'On the monitor'); this.audio.tap(); } };
      if (sim.labState === 'none' && sim.case.labs) {
        return {
          ico: '🩸', label: 'DRAW BLOOD',
          run: () => {
            sim.labState = 'drawn';
            const a = char.handAnchor();
            const vial = spawnCarryable(this, 'vial', a.x, 0.8, a.z,
              { patientId: pt.id, label: `Blood: ${sim.displayName}` });
            char.carrying = vial; vial.heldBy = char;
            if (sim.orders.has('labs')) this.addScore(10, 'Ordered labs drawn');
            this.ui.toast('Blood drawn — to the centrifuge!');
          },
        };
      }
      if (char.role === 'doctor') return { ico: '✅', label: 'DIAGNOSE', run: () => this.ui.modals.diagnose(pt) };
      return null;
    }
    if (['waiting', 'angry', 'arriving', 'escorted'].includes(sim.state) && sim.case.ambulatory) {
      const on = pt.escortedBy === char;
      return {
        ico: '🚶', label: on ? 'STOP ESCORT' : 'ESCORT',
        run: () => {
          pt.escortedBy = on ? null : char;
          if (!on) { sim.onGrabbed(); sim.state = 'escorted'; this.ui.toast(`${sim.displayName} is following you`); }
        },
      };
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
    const bed = this._nearestFreeBed(pt, 2.4);
    if (bed && !['dead'].includes(pt.sim.state)) { this.bedPatient(pt, bed); return; }
    // dropped on the floor like a sack of chaos — dynamic again
    this.setPatientDynamic(pt);
    if (!['sedated', 'dead', 'pinned', 'agitated'].includes(pt.sim.state)) pt.sim.state = 'waiting';
  }

  bedPatient(pt, bed) {
    const sim = pt.sim;
    bed.occupant = pt; sim.bed = bed;
    pt.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    pt.body.setTranslation({ x: bed.x, y: 1.05, z: bed.z + 0.15 }, true);
    pt.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    sim.state = 'inbed';
    sim.yaw = 0;
    pt.setFace(sim.critical ? 'crit' : 'normal');
    if (bed.room === 'ed') {
      this.ui.toast(`${sim.displayName} → ED bed ${bed.index + 1}`);
      this.addScore(15, 'Bedded');
    } else {
      this._resolveWardPlacement(pt, bed);
    }
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

  freeBed(sim) {
    if (sim.bed) { sim.bed.occupant = null; sim.bed = null; }
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
    const free = this.map.beds.filter((b) => b.room === 'ed' && !b.occupant).length;
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
