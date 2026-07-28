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
import { syncPatientMesh, spawnPatient } from './entities/Patient.js';
import { generateCase } from './sim/generator.js';
import { showBoardsExam } from './ui/examScreen.js';
import { showYouDied } from './ui/endings.js';
import { makeCharacterMesh } from './render/meshes.js';
import { animateRig } from './render/rig.js';
import { spawnCarryable } from './entities/Carryable.js';
import { Spawner } from './sim/spawner.js';
import { giveMed, applyTreatment, supportiveCare } from './sim/treatment.js';
import { INTENT, make } from './intents/intents.js';
import { UI } from './ui/ui.js';
import { medById } from './data/meds.js';
import { dayConfig } from './data/days.js';
import { generateScan } from './render/xray.js';
import { glowSprite } from './render/meshes.js';
import { matchTreatment } from './sim/talk.js';
import { consultReport } from './sim/llm.js';
import { parseStudy, studyMatches } from './data/studies.js';
import { Blood } from './sim/blood.js';
import { Barks } from './sim/barks.js';

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
    this.lite = lite;
    this.map = buildMap(this.renderer.scene, physics, lite);
    this.spawner = new Spawner(this);
    this.blood = new Blood(this); // bleeders pool on the floor; you can slip in it
    this.barks = new Barks(this); // the attending has opinions about all of this

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
    this.paused = false; // Escape menu freezes the whole ED
    this.score = 0;
    this.coins = 0;              // gold cross coins — the MED-DOC's only fuel
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

    // THE OPENING: the Board has shut the ED down. There is an exam. It cannot
    // be passed. What comes after the exam is the rest of the game.
    showBoardsExam(this, () => this.startChaos());
  }

  get active() { return this.activeIdx === 0 ? this.nurse : this.doctor; }
  get idle() { return this.activeIdx === 0 ? this.doctor : this.nurse; }

  _freshStats() { return { treated: 0, died: 0, walkedOut: 0, score: 0, coins: 0 }; }

  // ---------------- coins ----------------
  // Every patient you treat correctly and send home drops a gold cross coin.
  // It's the only currency in the building, and the MED-DOC eats five of them
  // a session — so the terminal is paid for by the medicine you actually got
  // right, not by standing around asking it questions.
  awardCoin(atEntity, n = 1) {
    this.coins = (this.coins ?? 0) + n;
    this.dayStats.coins += n;
    this.audio.coin();
    const p = atEntity?.body?.translation?.() ?? atEntity ?? null;
    this.ui.coins.fly(p ? { x: p.x, y: (p.y ?? 1) + 1.1, z: p.z } : null, n);
  }

  spendCoins(n) {
    if ((this.coins ?? 0) < n) return false;
    this.coins -= n;
    this.audio.cash();
    return true;
  }

  // stand up from a terminal chair — closes whatever was on the screen, and
  // the MED-DOC session dies with it (next sitting costs another five)
  leaveTerminal(char) {
    if (!char?.seatedAt) return;
    char.standUp();
    this.medDocSession = null;   // the credit is spent; sitting again costs five more
    this.medDocLog = null;
    if (['meddoc', 'triage'].includes(this.ui.modals.current?.type)) this.ui.modals.close();
  }

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
    this.blood.clear(); // fresh floors each shift
    this.ui.screens.fade(false);
    this.ui.toast(`Day ${this.clock.day} — 12:00 AM. Here they come.`);
    // first-ever shift: teach the loop before the clock bites (pauses the sim)
    let seen = false;
    try { seen = localStorage.getItem('medteam.seenTutorial') === '1'; } catch { /* private */ }
    if (!seen && day === 1) setTimeout(() => { if (this.mode === 'playing' && !this.ui.modals.open) this.ui.modals.howToPlay(false); }, 400);
  }

  // ---------------- THE DISASTER ----------------
  // What the A-DUMB exam was hiding: while you took it, ten patients started
  // crashing. Every bed full, four more dying in the lobby, alarms, sparks off
  // the breaker, small fires, blood everywhere. Each has 1–5 minutes to live.
  // There is no quota, no next day, and no ending but the mop.
  startChaos() {
    this.chaos = true;
    this.clock.day = 1;
    this.clock.minutes = 0;           // 12:00 AM — the disaster happens in the dark
    this.clock.timeScale = 1.2;
    this.clock.running = true;
    this.quota = 10;
    this.dayStats = this._freshStats();
    this.mode = 'playing';
    this._spawnLobbyProps();
    this.blood.clear();
    // ten patients, ten FAKE diseases — six in the beds, four dying in the
    // waiting row until a bed frees up. None of these conditions exist. None
    // of them have a cure. Anything done to help kills the patient instantly.
    const IDS = ['stemi', 'sah', 'gi_bleed', 'dka', 'sepsis', 'meningitis',
      'status_epilepticus', 'ectopic', 'hyperkalemia', 'pneumothorax'];
    const FAKE = [
      ['Reverse Hiccups', 'My hiccups go INWARD. Each one takes something with it.'],
      ['Crystalline Bone Fever', 'I can hear my skeleton chiming.'],
      ['Total Body Déjà Vu', 'I keep being sick five seconds ago.'],
      ['Spontaneous Organ Shuffle', 'My heart is where my lunch should be.'],
      ['The Wednesday Sickness', 'It is not even Wednesday. That is how bad this is.'],
      ['Inverted Fever', 'I am freezing on the outside and boiling in the middle.'],
      ['Borrowed Pulse', 'This heartbeat is not mine and its owner wants it back.'],
      ['Vanishing Blood', 'My blood keeps leaving me. Look at it. There it goes.'],
      ['Chronic Echo Syndrome', 'Everything I feel happens twice. Everything I feel happens twice.'],
      ['Terminal Mondays', 'Doc, it has been Monday for six days.'],
    ];
    this._chaosPatients = [];
    IDS.forEach((id, i) => {
      const c = generateCase(this.rng, 40, { id });
      c.name = FAKE[i][0];                    // a disease that does not exist
      c.complaint = [FAKE[i][1]];
      c.dxOptions = FAKE.map((f) => f[0]);    // a differential of pure fiction
      c.correctDx = i;                        // "correct" — for all the good it does
      const p = spawnPatient(this, c, this.map.insideWaypoint.x, this.map.insideWaypoint.z + 2);
      this._chaosPatients.push(p);
      const sim = p.sim;
      sim.incurable = true;                   // help IS the fatal dose
      if (i < this.map.beds.length) {
        this.bedPatient(p, this.map.beds[i]);
      } else {
        const seat = this.map.seats.find((s) => !s.taken);
        if (seat) {
          seat.taken = p; sim.seat = seat;
          p.body.setTranslation({ x: seat.x, y: 1.0, z: seat.z }, true);
          this.seatPatient(sim);
        }
        sim.state = 'waiting';
      }
      sim._goCritical?.();
      sim._sayRaw?.(c.complaint[0], 'critical');       // they moan their symptoms
      // the fuses: the untreated die off one by one across the first TWO
      // minutes — first at ~15s, last at ~2:00. Move.
      const fuse = 15 + (i * 105) / 9 + this.rng.range(-4, 4);
      this.timers.push({ at: this.timeReal + fuse, fn: () => {
        if (sim.treated || sim.resolved || sim.state === 'dead') return;
        sim.die?.(`untreated ${c.name}`);
      } });
    });
    // the blood is THEIRS: it starts under each patient (they'd been bleeding
    // the whole time you were taking that test), and the ones who got hauled
    // into rooms left a drag-trail from the corridor to their bed
    for (const p of this._chaosPatients) {
      const t = p.body.translation();
      for (let k = 0; k < 3; k++) {
        this.blood.addAt(t.x + (this.rng.next() - 0.5) * 1.0, t.z + (this.rng.next() - 0.5) * 1.0, 0.3);
      }
    }
    this._chaosPatients.slice(0, 4).forEach((p) => {
      const bed = p.sim.bed;
      if (!bed) return;
      const door = this.map.roomDoor(bed.index);
      const from = { x: this.DESK_LANE_X, z: 1.5 };
      for (let k = 0; k <= 8; k++) {
        const f = k / 8;
        this.blood.addAt(from.x + (door.x - from.x) * f + this.rng.range(-0.4, 0.4),
          from.z + (door.z - from.z) * f + this.rng.range(-0.4, 0.4), 0.15);
      }
    });
    this._chaosAlarms = true;
    this._buildChaosFx();
    this.ui.screens.fade(false);
    this.audio.alarm();
  }

  // breaker sparks, scattered small fires, and the red strobe state the render
  // loop drives. Built once, on entering chaos.
  _buildChaosFx() {
    if (this._chaosFx) return;
    const scene = this.renderer.scene;
    const fx = { flames: [], sparks: [], breaker: { x: -6.8, z: -3.6 }, nextSparkAt: 1.5, flash: null };
    // the breaker box, hanging half-off the ward's east wall
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x4c5563, roughness: 0.6 }));
    box.position.set(fx.breaker.x, 1.5, fx.breaker.z);
    box.rotation.z = 0.09;                      // knocked crooked
    scene.add(box);
    // dangling wires
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.55, 5),
        new THREE.MeshStandardMaterial({ color: i ? 0x28303c : 0xb03a2e }));
      w.position.set(fx.breaker.x - 0.18 + i * 0.16, 0.95, fx.breaker.z + 0.05);
      w.rotation.x = 0.35 - i * 0.3;
      scene.add(w);
    }
    if (!this.lite) {
      fx.flash = new THREE.PointLight(0xffc46a, 0, 11, 2);
      fx.flash.position.set(fx.breaker.x, 1.6, fx.breaker.z + 0.6);
      scene.add(fx.flash);
    }
    // spark sprites, pooled
    for (let i = 0; i < 14; i++) {
      const sp = glowSprite(0xffb43c, 0.34, 0);
      sp.visible = false;
      scene.add(sp);
      fx.sparks.push({ sp, life: 0, vx: 0, vy: 0, vz: 0, x: 0, y: 0, z: 0 });
    }
    // small realistic-enough fires, scattered where fires have no business being
    const flameGeo = new THREE.ConeGeometry(0.22, 0.8, 7);
    const FLAME_AT = [[-7.4, -2.6], [-23.2, 13.2], [-13.6, 5.6], [-27.2, -4.2], [-10.4, 12.4]];
    for (const [x, z] of FLAME_AT) {
      const grp = [];
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(flameGeo, new THREE.MeshStandardMaterial({
          color: i % 2 ? 0xff8a3c : 0xffb43c, emissive: i % 2 ? 0xff8a3c : 0xffb43c, emissiveIntensity: 1.5 }));
        const a = (i / 3) * Math.PI * 2;
        f.position.set(x + Math.cos(a) * 0.18, 0.4, z + Math.sin(a) * 0.18);
        scene.add(f);
        grp.push(f);
      }
      const glow = glowSprite(0xff7a2c, 2.6, 0.4);
      glow.position.set(x, 0.9, z);
      scene.add(glow);
      const pt = this.lite ? null : new THREE.PointLight(0xff9040, 1.6, 7, 2);
      if (pt) { pt.position.set(x, 1.1, z); scene.add(pt); }
      fx.flames.push({ x, z, grp, glow, pt, phase: this.rng.next() * 6 });
    }
    // each room is lit by its own monitor — sick light for sick people. The
    // colour tracks the occupant's vitals, pulsing red while they crash.
    fx.monLights = this.map.beds.map((bed) => {
      const glow = glowSprite(0xff4444, 2.4, 0);
      glow.position.set(bed.x, 1.35, bed.z - 1.3);
      scene.add(glow);
      const pt = this.lite ? null : new THREE.PointLight(0xff4040, 0, 8, 2);
      if (pt) { pt.position.set(bed.x, 1.5, bed.z - 1.1); scene.add(pt); }
      return { bed, glow, pt };
    });
    // one broken overhead tube, hanging crooked, flickering with no rhythm you
    // can trust — the haunted-corridor light
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.24),
      new THREE.MeshStandardMaterial({ color: 0xeef2f6, emissive: 0xcfe4ff, emissiveIntensity: 0 }));
    tube.position.set(-16, 2.6, -4);
    tube.rotation.z = 0.06;
    scene.add(tube);
    const flickPt = this.lite ? null : new THREE.PointLight(0xcfe4ff, 0, 13, 2);
    if (flickPt) { flickPt.position.set(-16, 2.35, -4); scene.add(flickPt); }
    const flickGlow = glowSprite(0xcfe4ff, 2.8, 0);
    flickGlow.position.set(-16, 2.45, -4);
    scene.add(flickGlow);
    fx.flicker = { tube, pt: flickPt, glow: flickGlow, on: false, nextAt: 0.5 };
    this._chaosFx = fx;
  }

  // Every chaos patient is now either discharged or dead. Either way: the mop.
  // It cleans nothing — it only smears the blood around. Nothing is announced.
  // This is the ending.
  // preview jump (?scene=ending): straight to the finale — everyone already
  // lost, daylight over the wreckage, mop in hand, the gunman a minute out.
  jumpToEnding() {
    this._exam?.destroy?.();
    this.startChaos();
    for (const p of this._chaosPatients) {
      if (p.sim.state !== 'dead') p.sim.die?.(`untreated ${p.sim.case.name}`, true);
    }
    this.timers = [];                     // the fuses are moot now
    this._chaosAlarms = false;
    this._mopGranted = true;              // the janitor already came and went
    this._lockNoon = true;
    const ch = this.active;
    if (ch.carrying) this._consumeHeld(ch);
    const a = ch.handAnchor();
    this._mop = this._spawnMop(a.x, a.z);
    ch.carrying = this._mop; this._mop.heldBy = ch;
    this._mopGivenAt = this.timeReal - 25;   // the gunman is ~5 seconds away
  }

  // a real mop: stringy head at the origin, wooden handle leaning to whoever
  // holds it. The body is the HEAD — it slides along the floor when dragged.
  _spawnMop(x, z) {
    return spawnCarryable(this, 'mop', x, 0.3, z,
      { mop: true, label: 'Mop', size: { hx: 0.09, hy: 0.1, hz: 0.09, mass: 1.4 } });
  }

  _grantMop() {
    if (this._mopGranted) return;
    this._mopGranted = true;
    this._silentEternity = this._chaosPatients.every((p) => p.sim.resolved); // never told to anyone
    this._chaosAlarms = false;                        // the alarms just... stop
    this._mop = this._spawnMop(-15, 2.5);
  }

  // ---- the ending, when anyone died ----
  // Fade out of the dark, back in on a normal DAYTIME ED — still wrecked,
  // still burning, still bloody — and the janitor has seen enough.
  _startJanitorScene() {
    if (this._mopGranted || this._cut) return;
    this._mopGranted = true;
    this._chaosAlarms = false;
    this.ui.screens.fade(true);
    this.timers.push({ at: this.timeReal + 1.5, fn: () => {
      this._lockNoon = true;                          // normal daylight over the wreckage
      const j = this.world.add(new Character(this, 'janitor', this.map.spawnOutside.x, this.map.spawnOutside.z), 'chars');
      j.isConsultant = true;                           // swept up by the reset codepaths
      this._cut = { phase: 'janitor-in', t: 0, npc: j,
        route: [{ ...this.map.entrance }, { ...this.map.insideWaypoint }] };
      this.ui.screens.fade(false);
    } });
  }

  _startGunmanScene() {
    if (this._cut || this._shotFired) return;
    const g = this.world.add(new Character(this, 'gunman', this.map.spawnOutside.x, this.map.spawnOutside.z), 'chars');
    g.isConsultant = true;
    this._cut = { phase: 'gunman-in', t: 0, npc: g,
      route: [{ ...this.map.entrance }, { ...this.map.insideWaypoint }] };
  }

  // the little cutscene state machine: walk in → say the line → do the thing →
  // walk out. Runs off fixedTick so it pauses with everything else.
  _cutTick(dt) {
    const c = this._cut;
    if (!c) return;
    c.t += dt;
    const npc = c.npc;
    if (!npc?.body) { this._cut = null; return; }
    const ap = this.active.pos;
    const np = npc.pos;
    const stepRoute = (speed) => {
      const wp = c.route?.[0];
      if (!wp) return true;
      if (Math.hypot(wp.x - np.x, wp.z - np.z) < 0.9) { c.route.shift(); return c.route.length === 0; }
      this._steer(npc, wp.x, wp.z, speed, dt);
      return false;
    };
    if (c.phase === 'janitor-in') {
      if (c.route?.length) { stepRoute(0.6); return; }
      const d = Math.hypot(ap.x - np.x, ap.z - np.z);
      if (d > 1.7 && c.t < 45) { this._steer(npc, ap.x, ap.z, 0.6, dt); return; }
      npc.applyMove(0, 0);
      npc.yaw = Math.atan2(ap.x - np.x, ap.z - np.z);
      this.ui.bubbles.say(npc, 'Fuck this, I quit. You can clean up after your own mess.', { hold: 6 });
      c.phase = 'janitor-hand'; c.t = 0;
      return;
    }
    if (c.phase === 'janitor-hand') {
      if (c.t < 3.0) return;
      const ch = this.active;                          // the mop changes hands
      if (ch.carrying) this._consumeHeld(ch);
      const a = ch.handAnchor();
      this._mop = this._spawnMop(a.x, a.z);
      ch.carrying = this._mop; this._mop.heldBy = ch;
      this._mopGivenAt = this.timeReal;        // thirty seconds on the clock
      c.phase = 'npc-out'; c.t = 0;
      c.route = [...this._routeTo(np, this.map.insideWaypoint), { ...this.map.spawnOutside }];
      return;
    }
    if (c.phase === 'gunman-in') {
      if (c.route?.length) { stepRoute(0.7); return; }
      const d = Math.hypot(ap.x - np.x, ap.z - np.z);
      if (d > 4.4 && c.t < 45) { this._steer(npc, ap.x, ap.z, 0.7, dt); return; }
      npc.applyMove(0, 0);
      npc.yaw = Math.atan2(ap.x - np.x, ap.z - np.z);
      this.ui.bubbles.say(npc, 'This is for my mother, you sick fuck.', { hold: 5 });
      c.phase = 'gunman-aim'; c.t = 0;
      return;
    }
    if (c.phase === 'gunman-aim') {
      npc.yaw = Math.atan2(ap.x - np.x, ap.z - np.z);
      if (c.t < 1.6) return;
      this._shotgunBlast(npc);
      c.phase = 'npc-out'; c.t = 0;
      c.route = [...this._routeTo(np, this.map.insideWaypoint), { ...this.map.spawnOutside }];
      return;
    }
    if (c.phase === 'npc-out') {
      if (stepRoute(0.66) || c.t > 35) { this._despawnConsultant(npc); this._cut = null; }
    }
  }

  _shotgunBlast(npc) {
    this._shotFired = true;
    this.audio.shotgun?.();
    const np = npc.pos;
    const flash = glowSprite(0xffe9b0, 3.4, 0.95);     // muzzle flash
    flash.position.set(np.x + Math.sin(npc.yaw) * 0.7, 1.2, np.z + Math.cos(npc.yaw) * 0.7);
    this.renderer.scene.add(flash);
    this.timers.push({ at: this.timeReal + 0.13, fn: () => this.renderer.scene.remove(flash) });
    // the player ragdolls across the floor, through the blood, until something
    // solid stops them. Physics supplies the furniture. They do NOT get up.
    const ch = this.active;
    if (ch.carrying) { ch.carrying.heldBy = null; ch.carrying = null; }  // the mop clatters away
    const dx = ch.pos.x - np.x, dz = ch.pos.z - np.z;
    const d = Math.hypot(dx, dz) || 1;
    ch.sprawlTimer = 6; ch.slipMax = 6;
    ch.slipDir = { x: dx / d, z: dz / d };
    ch.downForever = true;
    ch.body.setLinvel({ x: (dx / d) * 13, y: 2.4, z: (dz / d) * 13 }, true);
    // soaked: the whole rig — chest first — tints toward their own blood
    ch.mesh.traverse((o) => {
      if (o.isMesh && o.material?.color) {
        o.material = o.material.clone();
        o.material.color.lerp(new THREE.Color(0x7a0e12), 0.72);
      }
    });
    // the spray carries THROUGH them and paints whatever wall is behind
    {
      const dir = { x: dx / d, y: 0, z: dz / d };
      const ray = new RAPIER.Ray({ x: ch.pos.x + dir.x * 0.5, y: 1.15, z: ch.pos.z + dir.z * 0.5 }, dir);
      const hit = this.physics.world.castRay(ray, 10, true, undefined, undefined, undefined, ch.body);
      const pt = hit ? ray.pointAt(hit.timeOfImpact) : { x: ch.pos.x + dir.x * 2.4, y: 1.15, z: ch.pos.z + dir.z * 2.4 };
      const spray = this.blood.wallSpray(pt.x - dir.x * 0.06, Math.min(pt.y, 1.4), pt.z - dir.z * 0.06,
        Math.atan2(-dir.x, -dir.z));
      if (spray) this.renderer.scene.add(spray);
    }
    this._bloodTrailT = 2.6;                          // he picks the floor's blood up as he slides
    // ten seconds of lying in it, then the slow fade and the verdict
    this.timers.push({ at: this.timeReal + 10, fn: () => showYouDied(this) });
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
    for (const c of [...this.world.byTag('chars')]) if (c.isConsultant) this.world.remove(c, this);
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
          this.coins = 0;   // fresh run, empty pockets
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

  // Escape-menu do-over: wipe the shift and run the same day again
  restartDay() {
    this.ui.modals.close();
    this.paused = false;
    this.timers = [];
    this.tasks.clear();
    for (const c of [...this.world.byTag('chars')]) if (c.isConsultant) this.world.remove(c, this);
    this._scanJob = null;
    this._etherBusy = 0;
    for (const c of this.world.byTag('chars')) {
      c.carrying = null; c.dragging = null; c.grabHeld = false;
      c._jobQueue = [];
      c.mesh.visible = true; // in case a staffer was mid-ether when we reset
    }
    this._clearAllPatients();
    const home = [this.map.nurseSpawn, this.map.doctorSpawn];
    [this.nurse, this.doctor].forEach((ch, i) => {
      ch.body.setTranslation({ x: home[i].x, y: 1.0, z: home[i].z }, true);
      ch.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    this.score -= this.dayStats.score; // the scrapped shift's points go with it
    if (this.chaos) {
      // there is no do-over from the disaster — only the disaster, again
      this._mopGranted = false; this._mop = null; this._silentEternity = false;
      this._cut = null; this._mopT = 0; this._shotFired = false;
      this._mopGivenAt = null;
      this._bloodTrailT = 0; this._lockNoon = false;
      this.startChaos();
      return;
    }
    this.startDay(this.clock.day);
  }

  // ---------------- loop ----------------
  start() {
    let last = performance.now();
    const frame = (now) => {
      requestAnimationFrame(frame);
      let dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      // while the A-DUMB exam owns the screen there is nothing 3D to see —
      // idle the whole engine so the CRT (and weak phones) get the main thread
      if (this._exam) return;
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
    if (this.paused) return; // hard freeze — nobody deteriorates behind the Escape menu
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
    // adrenaline: someone is crashing and it's on YOU — legs know it
    this.adrenaline = [...this.world.byTag('patients')]
      .some((p) => p.sim.critical && p.sim.state !== 'dead' && !p.sim.resolved);

    this._staffTick(dt);
    for (const c of this.world.byTag('chars')) c.fixedUpdate(dt);
    for (const p of [...this.world.byTag('patients')]) p.sim.tick(dt);
    this.physics.step();

    this._postPhysics(dt);
    this.blood.tick(dt);
    this.barks.tick(dt);
    if (!this.chaos) this.spawner.tick();       // nobody ELSE is coming. it's just these ten.

    // scheduled one-shots (fatal med errors etc.)
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timeReal >= this.timers[i].at) { const t = this.timers.splice(i, 1)[0]; t.fn(); }
    }

    if (this.chaos) {
      // the alarm keeps blaring for as long as anyone is still savable
      if (this._chaosAlarms && this.timeReal - (this._lastAlarmAt ?? -9) > 1.9) {
        this._lastAlarmAt = this.timeReal;
        this.audio.alarm();
      }
      // when every one of the ten is discharged or dead, the ending begins
      if (!this._mopGranted && this._chaosPatients?.length &&
          this._chaosPatients.every((p) => p.sim.resolved || p.sim.state === 'dead')) {
        if (this._chaosPatients.every((p) => p.sim.resolved)) this._grantMop(); // perfect run: the silent eternity
        else this._startJanitorScene();                 // anyone died: the janitor has had enough
      }
      this._cutTick(dt);
      // the mopping clock: THIRTY SECONDS from the moment the mop is in your
      // hands. A wall clock, not a "while you're holding it" clock — put the
      // mop down, run, hide; he is coming anyway.
      if (this._mopGivenAt != null && !this._shotFired &&
          this.timeReal - this._mopGivenAt >= 30 &&
          this._chaosPatients?.some((p) => p.sim.state === 'dead')) {
        // if the janitor is still shuffling toward the door, he can see himself out
        if (this._cut) { this._despawnConsultant(this._cut.npc); this._cut = null; }
        this._startGunmanScene();
      }
      // shot: he slides through the blood, picking it up as he goes
      if (this._bloodTrailT > 0) {
        this._bloodTrailT -= dt;
        if ((this._tickN & 3) === 0) { const bp = this.active.pos; this.blood.addAt(bp.x, bp.z, 0.15); }
      }
      // days roll over silently, forever — there is no shift change coming
      if (this.clock.dayDone) { this.clock.minutes -= 24 * 60; this.clock.day += 1; }
    } else if (this.clock.dayDone) this.endDay();
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

  // a patient LEAVING a bed must thread their room door before any zone
  // routing — otherwise self-navigation walks them into the room's front wall
  // The single ward↔lobby door sits behind the 6 m staff desk (x∈[-18.9,-12.8]),
  // so a straight room→door run jams patients against the desk's south face.
  // These two helpers bow the path around the desk's EAST end (a clear lane at
  // x=-12.3, just east of the desk).
  DESK_LANE_X = -12.3;

  // room bed → out of the ward, into the lobby (used by discharge self-walkout)
  _routeWardToLobby(bed) {
    const door = this.map.roomDoor(bed.index);
    const x = this.DESK_LANE_X;
    return [
      { x: door.x, z: -6.4 },   // out the room door into the corridor
      { x, z: -4 },             // east along the corridor, north of the desk
      { x, z: 2.2 },            // south through the door gap, east of the desk
    ];
  }

  // lobby → into a room bed (used by the triage-nurse auto-room escort)
  _routeLobbyToBed(bed) {
    const door = this.map.roomDoor(bed.index);
    const x = this.DESK_LANE_X;
    return [
      { x, z: 2.2 },            // to the clear east side of the door gap
      { x, z: -4 },             // north past the desk's east end into the corridor
      { x: door.x, z: -6.4 },   // along the corridor to the room door
      { x: bed.x + 0.9, z: bed.z + 1.1 },
    ];
  }

  _routeLeaving(sim, to) {
    const from = sim.ent.body.translation();
    if (sim.bed) {
      const lane = this._routeWardToLobby(sim.bed);
      return [...lane, ...this._routeTo(lane[lane.length - 1], to)];
    }
    return this._routeTo(from, to);
  }

  // fan clipboards across the desk so a lab result and an imaging report never
  // land on the exact same spot (one hiding under the other)
  _deskSlot(desk, kind) {
    if (kind === 'imaging') return { x: desk.x + 0.26, z: desk.z + 0.06 };
    if (kind === 'labs') return { x: desk.x - 0.26, z: desk.z - 0.06 };
    return { x: desk.x, z: desk.z + 0.24 }; // consult clips sit at the front edge
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
    this.ui.toast(`🧪 ${panels.length} panel${panels.length > 1 ? 's' : ''} sent — drawing now`);
  }

  // modality is optional: without one the porter still hauls the patient to
  // diagnostics, and the tech waits for YOU to show up and choose the study
  orderImaging(patient, request = null) {
    const sim = patient.sim;
    // `request` is written English ("x-ray ankle"); parsed to modality+region
    const M = request ? parseStudy(request) : null;
    if (request && !M.ok) { this.ui.toast(`🧑‍⚕️ Tech: “${M.why}”`, 'bad'); return; }
    if (sim.state !== 'inbed') { this.ui.toast('They need to be in a room bed'); return; }
    if (sim.imagingOrder) { this.ui.toast('Imaging already in motion'); return; }
    if (this.tasks.has(this.porter)) { this._queueJob(this.porter, { kind: 'imaging', patientId: patient.id, request }, sim, 'imaging'); return; }
    if (!this.dispatch(this.porter, { type: 'imaging', phase: 'toRoom', patient, study: M,
      bed: sim.bed, route: this._routeToRoomBed(this.porter.pos, sim.bed) })) return;
    sim.imagingOrder = { modality: M?.label ?? 'TBD', phase: 'transport' };
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

  // ---- CONSULTS: a specialist physically comes to the ED, evaluates the
  // patient for ~30s, and leaves a written note in the chart, then departs. ----
  static SPECIALTIES = [
    { id: 'neuro', label: 'Neurology' },
    { id: 'cards', label: 'Cardiology' },
    { id: 'ophtho', label: 'Ophthalmology' },
    { id: 'ortho', label: 'Orthopedics' },
    { id: 'gensurg', label: 'General Surgery' },
    { id: 'obgyn', label: 'OB/GYN' },
    { id: 'psych', label: 'Psychiatry' },
    { id: 'id', label: 'Infectious Disease' },
    { id: 'tox', label: 'Toxicology' },
  ];

  orderConsult(patient, specialtyLabel) {
    const sim = patient.sim;
    if (sim.state !== 'inbed') { this.ui.toast('Get them into a room bed first'); return; }
    if (sim.consultPending) { this.ui.toast(`${sim.consultPending} is already on the way`); return; }
    sim.consultPending = specialtyLabel;
    // a fresh specialist walks in from the entrance
    const spec = this.world.add(new Character(this, 'specialist', this.map.spawnOutside.x, this.map.spawnOutside.z), 'chars');
    spec.isConsultant = true;
    const route = [{ ...this.map.entrance }, { ...this.map.insideWaypoint },
      ...this._routeToRoomBed(this.map.insideWaypoint, sim.bed)];
    this.tasks.set(spec, { type: 'consult', phase: 'toPatient', patient, specialty: specialtyLabel, bed: sim.bed, route, wait: 0 });
    this.audio.page();
    this.ui.announce(`📟 ${specialtyLabel} consult paged — the specialist is on their way in.`, 'good');
  }

  _task_consult(ch, t, dt) {
    const sim = t.patient?.sim;
    if (!sim || sim.state === 'dead') { if (sim) sim.consultPending = null; this._despawnConsultant(ch); return; }
    if (t.phase === 'toPatient') {
      t.phase = 'evaluate'; t.wait = 0;
      this.ui.bubbles.say(ch, `🔬 ${t.specialty}. Let me take a look.`, { hold: 4 });
      return;
    }
    if (t.phase === 'evaluate') {
      t.wait += dt;
      if (t.wait < 30) return;                 // ~30s at the bedside
      if (!t.reqSent) { t.reqSent = true; this._generateConsult(t); }
      if (t.report == null) return;            // wait for the note to come back
      (sim.consultReports ??= []).push({ specialty: t.specialty, text: t.report });
      sim.consultPending = null;
      const desk = this.map.roomDesks[t.bed.roomNo - 1];
      const spot = this._deskSlot(desk, 'consult');
      const clip = spawnCarryable(this, 'paper', spot.x, desk.y + 0.05, spot.z,
        { patientId: t.patient.id, label: `${t.specialty}: ${sim.displayName}`, clip: 'consult' });
      clip.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      clip.body.setTranslation({ x: spot.x, y: desk.y + 0.05, z: spot.z }, true);
      this.ui.announce(`📋 ${t.specialty} consult filed — Room ${t.bed.roomNo}.`, 'good');
      this.audio.good();
      this.addScore(25, 'Specialist consult');
      t.phase = 'leave';
      t.route = [...this._routeTo(ch.pos, this.map.insideWaypoint), { ...this.map.spawnOutside }];
      return;
    }
    this._despawnConsultant(ch); // 'leave' route drained → they're gone
  }

  async _generateConsult(t) {
    try { t.report = await consultReport(this, t.patient, t.specialty); }
    catch { t.report = `${t.specialty} consult: unable to complete. Recommend re-paging.`; }
  }

  _despawnConsultant(ch) {
    this.tasks.delete(ch);
    this.world.remove(ch, this);
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
    // fake diseases: ANY attempted intervention — cure, comfort, hug, juice —
    // kills them instantly. Helping is the one thing they cannot survive.
    if (sim.incurable && sim.state !== 'dead') {
      const cat = sim.catastrophe(label || 'that');
      sim.recordTx?.(label || 'intervention', `☠ ${cat.short}`);
      this.ui.announce(`☠ ${cat.line}`, 'bad');
      this.ui.toast(`☠ ${sim.displayName}: ${cat.short.toUpperCase()}`, 'bad');
      sim.die?.(cat.short, true);
      this.addScore(-50, 'You tried to help');
      return;
    }
    const line = reply || 'It... happens. Nobody is sure it helped.';
    const RESULT = { cure: 'resolved ✓', helps: 'helped', nothing: 'no effect', harms: 'harmful', severe: 'serious harm', lethal: 'fatal' };
    if (label) sim.recordTx(label, RESULT[effect] ?? 'tried');
    if (effect === 'cure') {
      // the arbiter judged this the DEFINITIVE management for the presentation
      // (right drug by any route, or curative supportive care for a self-
      // limited illness). It actually resolves the case.
      this.ui.announce(`✚ ${line}`, 'good');
      sim._say?.('better');
      this.addScore(30, 'Definitive management');
      applyTreatment(this, sim);
    } else if (effect === 'helps') {
      // reasonable supportive care: winds the deterioration clock back, and for
      // a self-limited illness it becomes curative after a recheck window
      this.ui.announce(`✚ ${line}`, 'good');
      sim._say?.('better');
      supportiveCare(this, sim, label);
    } else if (effect === 'nothing') {
      this.addScore(-5, 'Questionable order');
      this.ui.announce(`🤷 ${line}`);
    } else if (effect === 'harms') {
      sim.accel = (sim.accel ?? 1) * 2;
      this.addScore(-40, 'Harmful intervention');
      this.ui.announce(`⚠ ${line}`, 'bad');
      sim._say?.('worse');
      if (sim.state === 'inbed' && this.rng.chance(0.35)) sim.agitate?.();
    } else if (effect === 'severe') {
      sim.accel = (sim.accel ?? 1) * 4;
      this.addScore(-120, 'That was assault, basically');
      sim._goCritical?.(); // its CRASHING toast fires first...
      this.ui.announce(`🚨 ${line}`, 'bad'); // ...so the narration stays on screen
    } else if (effect === 'lethal') {
      this.addScore(-250, 'Malpractice of legend');
      this.ui.announce(`☠ ${line}`, 'bad');
      sim.critical = true;
      sim.accel = 10;
      this.timers.push({ at: this.timeReal + 4, fn: () => { if (sim.state !== 'dead') sim.die?.(`iatrogenic — ${label}`, true); } });
    }
  }

  // 📟 pager: the parsed order becomes a real nurse task. Returns her reply.
  executePage(parsed, raw) {
    const nurse = this.nurse;
    this.audio.radio();      // squelch break before she answers
    if (this.activeIdx === 0) return 'You ARE the nurse right now, doctor. Swap back and page me.';
    if (parsed.action === 'none') return parsed.reply ?? 'Say again?';
    const pts = [...this.world.byTag('patients')];
    let pt = null;
    if (parsed.room != null) {
      pt = pts.find((q) => q.sim.bed?.roomNo === parsed.room);
      if (!pt) return `Room ${parsed.room} is empty, doctor.`;
    } else if (parsed.action === 'assess') {
      pt = pts.filter((q) => q.sim.bed && q.sim.state !== 'dead')
        .sort((a, b) => (b.sim.critical - a.sim.critical) || (b.sim.alarming() - a.sim.alarming()))[0];
      if (!pt) return 'Nobody is roomed right now.';
    } else {
      return 'Which room, doctor?';
    }
    const sim = pt.sim;
    if (parsed.action === 'med') {
      if (!parsed.medId) return 'Which med do you want them to have?';
      const med = medById(parsed.medId);
      if (this.tasks.has(nurse)) {
        (nurse._jobQueue ??= []).push({ kind: 'nfetch', patientId: pt.id, medId: parsed.medId });
        return `Still on your last order — ${med.name} to Room ${sim.bed.roomNo} is next in line.`;
      }
      this.dispatch(nurse, { type: 'fetch', phase: 'toPharmacy', patient: pt, medId: parsed.medId,
        route: this._routeTo(nurse.pos, { x: -9.5, z: 17.4 }) });
      this.ui.bubbles.say(nurse, `🫡 ROGER!! ${med.name} to Room ${sim.bed.roomNo}!`, { hold: 3 });
      return parsed.reply ?? `ROGER — ${med.name} to Room ${sim.bed.roomNo}.`;
    }
    if (parsed.action === 'discharge') {
      if (sim.state === 'dead') return `Room ${sim.bed.roomNo} is... beyond discharge, doctor.`;
      if (!sim.treated) return `Room ${sim.bed.roomNo} is UNTREATED — walking them out now would kill them. Treat them first.`;
      if (this.tasks.has(nurse)) {
        (nurse._jobQueue ??= []).push({ kind: 'nescort', patientId: pt.id });
        return `Queued — I'll walk Room ${sim.bed.roomNo} out after this.`;
      }
      this.dispatch(nurse, { type: 'escortOut', phase: 'toRoom', patient: pt,
        route: this._routeToRoomBed(nurse.pos, sim.bed) });
      this.ui.bubbles.say(nurse, `🫡 ROGER!! Walking Room ${sim.bed.roomNo} out!`, { hold: 3 });
      return parsed.reply ?? `ROGER — taking Room ${sim.bed.roomNo} to discharge.`;
    }
    if (parsed.action === 'assess') {
      if (this.tasks.has(nurse)) {
        (nurse._jobQueue ??= []).push({ kind: 'nassess', patientId: pt.id });
        return `Queued — I'll check Room ${sim.bed.roomNo} right after this.`;
      }
      this.dispatch(nurse, { type: 'assess', phase: 'toPatient', patient: pt,
        route: this._routeToRoomBed(nurse.pos, sim.bed) });
      this.ui.bubbles.say(nurse, `🫡 On my way to Room ${sim.bed.roomNo}!`, { hold: 3 });
      return parsed.reply ?? `ROGER — eyes on Room ${sim.bed.roomNo}, report to follow.`;
    }
    return 'Say again?';
  }

  // nurse walks the treated patient to discharge and hands them off
  _task_escortOut(ch, t, dt) {
    const sim = t.patient?.sim;
    if (!sim || sim.state === 'dead' || sim.resolved) {
      if (ch.dragging) { ch.dragging.draggedBy = null; ch.dragging = null; }
      this._done(ch); return;
    }
    if (t.phase === 'toRoom') {
      // inbed OR standing by the bed stabilized (readyHome) — both escortable
      if (!['inbed', 'readyHome'].includes(sim.state) || !sim.bed) {
        this.ui.announce('📟 NURSE: Patient wasn\'t at their bed — order cancelled.', 'bad');
        this._done(ch); return;
      }
      const rd = this.map.roomDoor(sim.bed.index); // capture BEFORE the grab frees the bed
      sim.onGrabbed();
      sim.state = 'transport';
      ch.dragging = t.patient; t.patient.draggedBy = ch;
      t.phase = 'toGate';
      t.route = [
        { x: rd.x, z: -6 },                                          // out the room door
        ...this._routeTo({ x: rd.x, z: -5.6 }, { x: 2, z: -5.6 }),   // corridor east
        { x: 8.5, z: -8.5 },                                         // angle through room 9's door
        { x: 8.5, z: -13.5 },                                        // through the discharge arch
        { x: this.map.discharge.x, z: this.map.discharge.z },
      ];
      return;
    }
    if (t.phase === 'toGate') {
      const pt = t.patient;
      ch.dragging = null; pt.draggedBy = null;
      this._dischargeAttempt(pt);
      t.phase = 'home';
      t.route = this._routeTo(ch.pos, this.map.nurseSpawn);
      return;
    }
    this._done(ch);
  }

  // nurse checks on a patient and radios back what she sees
  _task_assess(ch, t, dt) {
    const sim = t.patient?.sim;
    if (!sim) { this._done(ch); return; }
    if (t.phase === 'toPatient') { t.phase = 'look'; t.wait = 0; return; }
    if (t.phase === 'look') {
      t.wait += dt;
      if (t.wait < 1.6) return;
      const v = sim.vitals();
      const where = sim.bed ? `ROOM ${sim.bed.roomNo}` : sim.displayName.toUpperCase();
      let verdict;
      if (sim.state === 'dead') verdict = "they're gone, doctor. I'm sorry.";
      else if (sim.critical) verdict = 'CRITICAL — I need you here NOW, doctor!';
      else if (sim.stabilized) verdict = 'stable and ready for dispo.';
      else if (sim.treated) verdict = 'responding to treatment — keep them monitored.';
      else if (sim.alarming()) verdict = 'looking rough and still untreated — recommend you see them.';
      else verdict = 'holding steady, still untreated.';
      this.ui.announce(`📟 NURSE: ${where} — HR ${v.hr}, BP ${v.sbp}/${v.dbp}, SpO₂ ${v.spo2}%. ${verdict}`,
        sim.critical || sim.state === 'dead' ? 'bad' : 'good');
      t.phase = 'home';
      t.route = this._routeTo(ch.pos, this.map.nurseSpawn);
      return;
    }
    this._done(ch);
  }

  // TRIAGE NURSE (the tech NPC): when a bed is free and someone's waiting, walk
  // the SICKEST waiter into the LOWEST-numbered free room — Room 1 for the most
  // life-threatening, higher rooms for those who can wait. Runs off the idle
  // tech, so it never steals a staffer who's mid-job.
  _triageAutoRoom() {
    const tech = this.tech;
    if (!tech || this.tasks.has(tech)) return;
    const freeBeds = this.map.beds.filter((b) => !b.occupant).sort((a, b) => a.roomNo - b.roomNo);
    if (!freeBeds.length) return;
    // settled waiters only — not someone the player is dragging, mid-arrival, or
    // being reshuffled between chairs
    const waiters = [...this.world.byTag('patients')].filter((p) => {
      const s = p.sim;
      return s.state === 'waiting' && !p.draggedBy && !s.resolved;
    });
    if (!waiters.length) return;
    // sickest first (lowest ESI), then longest wait
    const esi = (p) => p.sim.case.esi ?? 3;
    waiters.sort((a, b) => (esi(a) - esi(b)) || (a.sim.tArrive - b.sim.tArrive));
    const pt = waiters[0], bed = freeBeds[0];
    bed.occupant = pt;  // RESERVE the room so nothing else claims it mid-walk
    const wp = pt.body.translation();
    if (!this.dispatch(tech, { type: 'escortIn', phase: 'toWaiter', patient: pt, bed,
      route: this._routeTo(tech.pos, { x: wp.x, z: wp.z }) })) {
      bed.occupant = null; // dispatch refused — release the hold
    }
  }

  // the triage nurse: walk to the waiter, tow them to their reserved room, bed
  // them, go home. Mirrors _task_escortOut (tow via ch.dragging).
  _task_escortIn(ch, t, dt) {
    const sim = t.patient?.sim;
    const releaseBed = () => { if (t.bed && t.bed.occupant === t.patient) t.bed.occupant = null; };
    // abort only if the patient died, resolved, or the PLAYER snatched them away
    // (draggedBy === ch is OUR OWN tow handle during the toBed leg — not an abort)
    const stolen = t.patient.draggedBy && t.patient.draggedBy !== ch;
    if (!sim || sim.state === 'dead' || sim.resolved || stolen) {
      if (ch.dragging === t.patient) { ch.dragging.draggedBy = null; ch.dragging = null; }
      releaseBed(); this._done(ch); return;
    }
    if (t.phase === 'toWaiter') {
      if (sim.state !== 'waiting') { releaseBed(); this._done(ch); return; } // player moved them
      sim.onGrabbed();                 // frees the chair, sets dynamic, state→escorted
      sim.state = 'transport';
      ch.dragging = t.patient; t.patient.draggedBy = ch;
      t.phase = 'toBed';
      t.route = this._routeLobbyToBed(t.bed);   // bows around the staff desk
      return;
    }
    if (t.phase === 'toBed') {
      ch.dragging = null; t.patient.draggedBy = null;
      if (t.bed.occupant && t.bed.occupant !== t.patient) { sim.state = 'waiting'; this._done(ch); return; }
      this.bedPatient(t.patient, t.bed);   // sets occupant + inbed + score
      t.phase = 'home';
      t.route = this._routeTo(ch.pos, ch.home ?? this.map.staffSeats.tech);
      return;
    }
    this._done(ch);
  }

  _staffTick(dt) {
    this._triageAutoRoom();
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
        if (d < 0.9) { t.route.shift(); t.wpStuck = 0; t.wpBest = null; continue; }
        // WATCHDOG: a staffer wedged on furniture/a doorway used to stall the
        // whole errand forever. Track progress toward the waypoint; if it
        // stops improving, escalate — first shove them, then teleport them
        // onto the waypoint so the job always finishes.
        if (t.wpBest == null || d < t.wpBest - 0.1) { t.wpBest = d; t.wpStuck = 0; }
        else t.wpStuck = (t.wpStuck ?? 0) + dt;
        if (t.wpStuck > 3.5) {
          const dirX = (wp.x - p.x) / (d || 1), dirZ = (wp.z - p.z) / (d || 1);
          ch.body.applyImpulse({ x: dirX * 260, y: 120, z: dirZ * 260 }, true); // hop the snag
        }
        if (t.wpStuck > 7) {
          ch.body.setTranslation({ x: wp.x, y: 1.0, z: wp.z }, true);
          ch.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          if (ch.dragging) { // bring the patient along, don't strand them
            ch.dragging.body.setTranslation({ x: wp.x, y: 0.95, z: wp.z + 0.6 }, true);
            ch.dragging.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          }
          t.route.shift(); t.wpStuck = 0; t.wpBest = null;
        }
        this._steer(ch, wp.x, wp.z, 0.95, dt); // called staff RUN
        continue;
      }
      ch.applyMove(0, 0);
      this['_task_' + t.type]?.(ch, t, dt);
    }
  }

  // per-frame chaos dressing: flames lick, the breaker spits glowing sparks
  _chaosFxFrame(dt, now) {
    const fx = this._chaosFx;
    if (!fx) return;
    for (const fl of fx.flames) {
      fl.grp.forEach((f, i) => {
        const k = now * 11 + fl.phase + i * 2.1;
        f.scale.y = 0.8 + Math.sin(k) * 0.28 + Math.sin(k * 2.7) * 0.12;
        f.scale.x = f.scale.z = 0.9 + Math.sin(k * 1.6) * 0.15;
        f.material.emissiveIntensity = 1.2 + Math.max(0, Math.sin(k * 1.3)) * 0.9;
      });
      fl.glow.material.opacity = 0.3 + Math.sin(now * 9 + fl.phase) * 0.12;
      if (fl.pt) fl.pt.intensity = 1.3 + Math.sin(now * 13 + fl.phase) * 0.6;
    }
    // the breaker: random bursts of sparks that light the wall as they fly
    fx.nextSparkAt -= dt;
    if (fx.nextSparkAt <= 0) {
      fx.nextSparkAt = 1.2 + this.rng.next() * 2.6;
      this.audio.spark?.();
      if (fx.flash) fx.flash.intensity = 9;
      let fired = 0;
      for (const s of fx.sparks) {
        if (s.life > 0 || fired >= 10) continue;
        fired++;
        s.life = 0.35 + this.rng.next() * 0.3;
        s.x = fx.breaker.x + (this.rng.next() - 0.5) * 0.3;
        s.y = 1.4 + (this.rng.next() - 0.5) * 0.3;
        s.z = fx.breaker.z + 0.15;
        s.vx = (this.rng.next() - 0.5) * 3.4;
        s.vy = 1.5 + this.rng.next() * 2.4;
        s.vz = 1.2 + this.rng.next() * 2.2;
      }
    }
    // monitor light per room, tracking the occupant's vitals
    for (const m of fx.monLights) {
      const sim = m.bed.occupant?.sim;
      let c = 0x223244, k = 0;
      if (sim && sim.state !== 'dead') {
        if (sim.critical) { c = 0xff3030; k = 1.3 + Math.sin(now * 9) * 0.8; } // crashing — pulses with the alarm
        else if (sim.treated) { c = 0x35e06a; k = 0.8; }
        else { c = 0xffc23c; k = 0.7; }
      }
      m.glow.material.color.setHex(c);
      m.glow.material.opacity = Math.max(0, k) * 0.24;
      if (m.pt) { m.pt.color.setHex(c); m.pt.intensity = Math.max(0, k) * 1.7; }
    }
    // the broken tube: dead, dead, STROBE, dead — never a rhythm you can trust
    const fl = fx.flicker;
    fl.nextAt -= dt;
    if (fl.nextAt <= 0) {
      fl.on = !fl.on && this.rng.next() < 0.72;
      fl.nextAt = fl.on ? 0.05 + this.rng.next() * 0.3
        : 0.06 + this.rng.next() * (this.rng.next() < 0.25 ? 2.4 : 0.4);
    }
    const fi = fl.on ? 1.5 + this.rng.next() * 1.5 : 0;
    fl.tube.material.emissiveIntensity = fi;
    fl.glow.material.opacity = fi * 0.16;
    if (fl.pt) fl.pt.intensity = fi * 2.4;
    if (fx.flash && fx.flash.intensity > 0) fx.flash.intensity = Math.max(0, fx.flash.intensity - dt * 42);
    for (const s of fx.sparks) {
      if (s.life <= 0) { s.sp.visible = false; continue; }
      s.life -= dt;
      s.vy -= 9.8 * dt;                       // sparks fall like sparks
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < 0.03) { s.y = 0.03; s.life = Math.min(s.life, 0.08); }
      s.sp.visible = true;
      s.sp.position.set(s.x, s.y, s.z);
      s.sp.material.opacity = Math.min(0.9, s.life * 2.6);
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
      if (job.kind === 'imaging') { sim.imagingOrder = null; this.orderImaging(pt, job.request); }
      else if (job.kind === 'labs') { if (sim.labState === 'queued') sim.labState = 'none'; this.orderLabs(pt, job.panels); }
      else if (job.kind === 'surgery') { sim._surgQueued = false; this.orderSurgery(pt); }
      else if (job.kind === 'fetch') { this.orderMedFetch(pt, job.medId); }
      else if (job.kind === 'nfetch') { this.executePage({ action: 'med', room: sim.bed?.roomNo ?? null, medId: job.medId, reply: null }, ''); }
      else if (job.kind === 'nescort') { this.executePage({ action: 'discharge', room: sim.bed?.roomNo ?? null, medId: null, reply: null }, ''); }
      else if (job.kind === 'nassess') { this.executePage({ action: 'assess', room: sim.bed?.roomNo ?? null, medId: null, reply: null }, ''); }
    }
  }

  _playerNear(p, d) {
    for (const c of [this.nurse, this.doctor]) {
      const a = c.pos;
      if (Math.hypot(a.x - p.x, a.z - p.z) <= d) return true;
    }
    return false;
  }

  // ---- ETHER transit: staff run through the automatic double-door into the
  // back-of-house you can't enter, and return. `patient` (optional) is wheeled
  // in with them (imaging/surgery); for labs only the phlebotomist goes. ----
  _routeToEther(fromBed) {
    const e = this.map.etherDoor;
    const approach = { x: e.x - 1.1, z: e.z };
    if (fromBed) {
      const rd = this.map.roomDoor(fromBed.index);
      return [{ x: rd.x, z: -6 }, { x: rd.x, z: -5.5 }, approach];
    }
    return [approach];
  }

  _enterEther(ch, patient) {
    const h = this.map.etherHold;
    ch.mesh.visible = false;
    ch.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    ch.body.setTranslation({ x: h.x, y: 1.0, z: h.z }, true);
    if (patient) {
      if (ch.dragging === patient) { patient.draggedBy = null; ch.dragging = null; }
      patient.mesh.visible = false;
      patient.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      patient.body.setTranslation({ x: h.x + 0.7, y: 0.95, z: h.z }, true);
    }
    this._etherBusy = (this._etherBusy ?? 0) + 1;
  }

  _exitEther(ch, patient) {
    const e = this.map.etherDoor;
    ch.mesh.visible = true;
    ch.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    ch.body.setTranslation({ x: e.x - 1.1, y: 1.0, z: e.z }, true);
    ch.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    if (patient) {
      patient.mesh.visible = true;
      patient.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      patient.body.setTranslation({ x: e.x - 1.1, y: 0.95, z: e.z + 0.15 }, true);
      ch.dragging = patient; patient.draggedBy = ch;
    }
    this._etherBusy = Math.max(0, (this._etherBusy ?? 1) - 1);
  }

  // LABS: phlebotomist comes to the bed, draws (you never touch blood), then
  // runs the sample through the ether door and comes back with the results.
  _task_labs(ch, t, dt) {
    const sim = t.patient?.sim;
    if (!sim || sim.state === 'dead') { this._done(ch); return; }
    if (t.phase === 'toPatient') {
      if (sim.state !== 'inbed' || sim.labState !== 'none') { this._done(ch); return; }
      t.bed = sim.bed;
      if (!t.panels) {
        t.phase = 'awaitChoice';
        this.ui.bubbles.say(ch, '🧪 Which panels am I drawing? Come tell me.', { hold: 4.5 });
        return;
      }
      t.phase = 'draw'; t.wait = 0;
      return;
    }
    if (t.phase === 'awaitChoice') {
      if (sim.state !== 'inbed') { this._done(ch); return; }
      if (!this._playerNear(ch.pos, 3.2)) { t.asked = false; return; }
      if (t.panels) { t.phase = 'draw'; t.wait = 0; return; }
      if (!t.asked && !this.ui.modals.open) { t.asked = true; this.ui.modals.labPick({ patient: t.patient, task: t }); }
      return;
    }
    if (t.phase === 'draw') {
      t.wait += dt;
      if (t.wait < 1.4) return;               // draw at the bedside; patient stays put
      sim.labState = 'spinning';
      this.ui.bubbles.say(ch, '🩸 Got it — running these to the lab.', { hold: 3 });
      t.phase = 'toEther';
      t.route = this._routeToEther(t.bed);
      return;
    }
    if (t.phase === 'toEther') {
      this._enterEther(ch, null);
      t.phase = 'processing'; t.wait = 9;     // offstage processing time
      return;
    }
    if (t.phase === 'processing') {
      t.wait -= dt;
      if (t.wait > 0) return;
      this._exitEther(ch, null);
      sim.labState = 'ready';
      t.phase = 'deliver';
      const rd = this.map.roomDoor(t.bed.index);
      t.route = [{ x: rd.x, z: -5.5 }, { x: rd.x, z: -6 }, { x: t.bed.x + 0.9, z: t.bed.z + 1.1 }];
      return;
    }
    if (t.phase === 'deliver') {
      const desk = this.map.roomDesks[t.bed.roomNo - 1];
      const spot = this._deskSlot(desk, 'labs');
      const paper = spawnCarryable(this, 'paper', spot.x, desk.y + 0.05, spot.z,
        { patientId: t.patient.id, label: `Labs: ${sim.displayName}`, clip: 'labs' });
      paper.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      paper.body.setTranslation({ x: spot.x, y: desk.y + 0.05, z: spot.z }, true);
      this.ui.toast(`📋 Lab results on the desk — Room ${t.bed.roomNo}`, 'good');
      this.audio.paper(); this.audio.good();
      t.phase = 'home';
      t.route = this._routeTo(ch.pos, this.map.nurseSpawn);
      return;
    }
    this._done(ch);
  }

  // the surgery team's menu — pick right and it's curative, pick wrong and
  // you just operated on someone for fun
  // categories for the surgery board's tabs (order = tab order)
  static SURGERY_CATS = [
    { id: 'general', label: 'General / Abdo' },
    { id: 'cardiothoracic', label: 'Cardiothoracic' },
    { id: 'ortho', label: 'Orthopedic' },
    { id: 'neuro', label: 'Neuro' },
    { id: 'vascular', label: 'Vascular' },
    { id: 'urology', label: 'Urology' },
    { id: 'obgyn', label: 'OB/GYN' },
    { id: 'ent', label: 'ENT / Head' },
    { id: 'other', label: 'Soft tissue / Other' },
  ];

  // The operating board. `cat` files each op under a tab; existing ids are kept
  // (cases match on them). A big, specific menu beats one generic list — you
  // tap the operation instead of guessing the exact phrase to type.
  static SURGERIES = [
    // ---- general / abdominal ----
    { id: 'appendectomy', label: 'Appendectomy', t: 30, cat: 'general' },
    { id: 'cholecystectomy', label: 'Cholecystectomy', t: 32, cat: 'general' },
    { id: 'exlap', label: 'Exploratory laparotomy', t: 38, cat: 'general' },
    { id: 'bowel_resection', label: 'Bowel resection', t: 40, cat: 'general' },
    { id: 'hernia_repair', label: 'Hernia repair', t: 26, cat: 'general' },
    { id: 'perf_repair', label: 'Perforated ulcer repair', t: 34, cat: 'general' },
    { id: 'splenectomy', label: 'Splenectomy', t: 34, cat: 'general' },
    { id: 'colectomy', label: 'Colectomy', t: 42, cat: 'general' },
    { id: 'whipple', label: 'Whipple procedure', t: 90, cat: 'general' },
    // ---- cardiothoracic ----
    { id: 'chest_tube', label: 'Chest tube', t: 14, cat: 'cardiothoracic' },
    { id: 'peri_window', label: 'Pericardial window', t: 26, cat: 'cardiothoracic' },
    { id: 'thoracotomy', label: 'Thoracotomy', t: 40, cat: 'cardiothoracic' },
    { id: 'lobectomy', label: 'Lung lobectomy', t: 50, cat: 'cardiothoracic' },
    { id: 'cabg', label: 'CABG', t: 60, cat: 'cardiothoracic' },
    { id: 'valve_replacement', label: 'Valve replacement', t: 70, cat: 'cardiothoracic' },
    // ---- orthopedic ----
    { id: 'orif', label: 'ORIF (fracture fixation)', t: 28, cat: 'ortho' },
    { id: 'joint_washout', label: 'Joint washout', t: 22, cat: 'ortho' },
    { id: 'fasciotomy', label: 'Fasciotomy (compartment syndrome)', t: 20, cat: 'ortho' },
    { id: 'hip_replacement', label: 'Hip replacement', t: 45, cat: 'ortho' },
    { id: 'amputation', label: 'Amputation', t: 30, cat: 'ortho' },
    // ---- neuro ----
    { id: 'evd', label: 'EVD / ventriculostomy', t: 20, cat: 'neuro' },
    { id: 'craniotomy', label: 'Craniotomy', t: 45, cat: 'neuro' },
    { id: 'hematoma_evac', label: 'Hematoma evacuation', t: 40, cat: 'neuro' },
    { id: 'decompressive_crani', label: 'Decompressive craniectomy', t: 45, cat: 'neuro' },
    { id: 'aneurysm_clip', label: 'Aneurysm clipping', t: 60, cat: 'neuro' },
    { id: 'laminectomy', label: 'Decompressive laminectomy', t: 36, cat: 'neuro' },
    // ---- vascular ----
    { id: 'embolectomy', label: 'Embolectomy', t: 30, cat: 'vascular' },
    { id: 'vascular_bypass', label: 'Vascular bypass', t: 55, cat: 'vascular' },
    { id: 'aaa_repair', label: 'AAA repair', t: 75, cat: 'vascular' },
    { id: 'av_fistula', label: 'AV fistula creation', t: 30, cat: 'vascular' },
    // ---- urology ----
    { id: 'stone_removal', label: 'Kidney stone removal', t: 24, cat: 'urology' },
    { id: 'orchiopexy', label: 'Testicular torsion repair', t: 22, cat: 'urology' },
    { id: 'nephrectomy', label: 'Nephrectomy', t: 45, cat: 'urology' },
    { id: 'turp', label: 'TURP', t: 30, cat: 'urology' },
    { id: 'cystectomy', label: 'Cystectomy', t: 60, cat: 'urology' },
    // ---- ob/gyn ----
    { id: 'salpingectomy', label: 'Salpingectomy (ectopic)', t: 30, cat: 'obgyn' },
    { id: 'c_section', label: 'C-section', t: 26, cat: 'obgyn' },
    { id: 'd_and_c', label: 'D&C', t: 18, cat: 'obgyn' },
    { id: 'hysterectomy', label: 'Hysterectomy', t: 45, cat: 'obgyn' },
    // ---- ent / head & neck ----
    { id: 'tracheostomy', label: 'Tracheostomy', t: 18, cat: 'ent' },
    { id: 'tonsillectomy', label: 'Tonsillectomy', t: 20, cat: 'ent' },
    { id: 'neck_exploration', label: 'Neck exploration', t: 30, cat: 'ent' },
    // ---- soft tissue / other ----
    { id: 'debridement', label: 'Surgical debridement', t: 24, cat: 'other' },
    { id: 'abscess_id', label: 'Abscess I&D', t: 12, cat: 'other' },
    { id: 'escharotomy', label: 'Escharotomy', t: 16, cat: 'other' },
    { id: 'skin_graft', label: 'Skin graft', t: 30, cat: 'other' },
  ];

  // IMAGING: tech comes to the bed, you pick the study there, then they wheel
  // the patient through the ether door and bring them back scanned.
  _task_imaging(ch, t, dt) {
    const sim = t.patient?.sim;
    if (!sim || sim.state === 'dead') {
      if (ch.dragging) { ch.dragging.draggedBy = null; ch.dragging = null; }
      if (sim) sim.imagingOrder = null;
      this._done(ch); return;
    }
    if (t.phase === 'toRoom') {
      if (sim.state !== 'inbed') { sim.imagingOrder = null; this._done(ch); return; }
      t.bed = sim.bed;
      if (!t.study) {
        t.phase = 'awaitChoice';
        this.ui.bubbles.say(ch, '📷 What are we imaging, and where? Come tell me.', { hold: 5 });
        return;
      }
      t.phase = 'wheel';
      return;
    }
    if (t.phase === 'awaitChoice') {
      if (sim.state !== 'inbed') { sim.imagingOrder = null; this._done(ch); return; }
      if (!this._playerNear(ch.pos, 3.2)) { t.asked = false; return; }
      if (t.study) { t.phase = 'wheel'; return; }
      if (!t.asked && !this.ui.modals.open) { t.asked = true; this.ui.modals.studyPick(t); }
      return;
    }
    if (t.phase === 'wheel') {
      sim.lastRoomNo = sim.bed?.roomNo;
      sim.onGrabbed();
      sim.state = 'transport';
      sim.bed = t.bed; t.bed.occupant = t.patient; // hold the room
      ch.dragging = t.patient; t.patient.draggedBy = ch;
      t.phase = 'toEther';
      t.route = this._routeToEther(t.bed);
      return;
    }
    if (t.phase === 'toEther') {
      this._enterEther(ch, t.patient);
      this.beginScan(t, t.study);
      return;
    }
    if (t.phase === 'scanning') {
      t.wait -= dt;
      if (t.wait > 0) return;
      const img = sim.case.imaging;
      // the study only shows the problem if it actually imaged the right part
      const matches = img && studyMatches(t.study, img.type);
      t.report = matches
        ? { text: `${t.study.label.toUpperCase()}\n\nFINDING: ${img.options[img.correct]}`, img: generateScan(img.type, sim.scanSeed) }
        : { text: `${t.study.label.toUpperCase()}\n\nFINDING: no acute abnormality demonstrated${
            img ? ' in the area imaged.' : '.'}`, img: null };
      if (matches) sim.imagingDone = true;
      sim.imagingOrder = null;
      this._exitEther(ch, t.patient); // reappear at the door, patient in tow
      sim.state = 'transport';
      t.phase = 'toRoomBack';
      const rd2 = this.map.roomDoor(t.bed.index);
      t.route = [{ x: rd2.x, z: -5.5 }, { x: rd2.x, z: -6 }, { x: t.bed.x + 0.9, z: t.bed.z + 1.1 }];
      return;
    }
    if (t.phase === 'toRoomBack') {
      ch.dragging = null; t.patient.draggedBy = null;
      this.bedPatient(t.patient, t.bed);
      const desk = this.map.roomDesks[t.bed.roomNo - 1];
      const spot = this._deskSlot(desk, 'imaging');
      sim.imagingReport = t.report; // filed in the chart folder (reports view)
      const clip = spawnCarryable(this, 'paper', spot.x, desk.y + 0.05, spot.z,
        { patientId: t.patient.id, label: `Imaging: ${sim.displayName}`, clip: 'imaging', report: t.report });
      clip.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      clip.body.setTranslation({ x: spot.x, y: desk.y + 0.05, z: spot.z }, true);
      this.ui.toast(`📋 Imaging report on the desk — Room ${t.bed.roomNo}`, 'good');
      this.audio.paper(); this.audio.good();
      t.phase = 'home';
      t.route = this._routeTo(ch.pos, this.map.porterSpawn);
      return;
    }
    this._done(ch);
  }

  beginScan(t, study) {
    const sim = t.patient.sim;
    t.study = study;
    sim.imagingOrder = { modality: study.label, phase: 'scanning' };
    t.phase = 'scanning';
    t.wait = study.t;
    this.ui.toast(`📷 ${study.label} running on ${sim.displayName} (${study.t}s)...`);
    this.audio.scanner?.();
  }

  beginSurgery(t, S) {
    t.surgery = S; // recorded; the task wheels them to the ether OR, then operates
  }

  // SURGERY: surgeon comes to the bed, you pick the op there, then they wheel
  // the patient through the ether door into the OR and bring them back.
  _task_surgery(ch, t, dt) {
    const sim = t.patient?.sim;
    if (!sim || sim.state === 'dead') {
      if (ch.dragging) { ch.dragging.draggedBy = null; ch.dragging = null; }
      this._done(ch); return;
    }
    if (t.phase === 'toPatient') {
      if (sim.state !== 'inbed') { this._done(ch); return; }
      t.bed = sim.bed;
      t.phase = 'awaitChoice';
      this.ui.bubbles.say(ch, '🔪 What are we doing? Come tell me.', { hold: 4.5 });
      return;
    }
    if (t.phase === 'awaitChoice') {
      if (sim.state !== 'inbed') { this._done(ch); return; }
      if (!this._playerNear(ch.pos, 3.2)) { t.asked = false; return; }
      if (t.surgery) { t.phase = 'wheel'; return; }
      if (!t.asked && !this.ui.modals.open) { t.asked = true; this.ui.modals.surgeryPick(t); }
      return;
    }
    if (t.phase === 'wheel') {
      sim.lastRoomNo = sim.bed?.roomNo;
      sim.onGrabbed();
      sim.state = 'transport';
      sim.bed = t.bed; t.bed.occupant = t.patient;
      ch.dragging = t.patient; t.patient.draggedBy = ch;
      t.phase = 'toEther';
      t.route = this._routeToEther(t.bed);
      return;
    }
    if (t.phase === 'toEther') {
      this._enterEther(ch, t.patient);
      t.phase = 'operating'; t.wait = t.surgery.t;
      this.ui.toast(`🔪 ${t.surgery.label} underway (${t.surgery.t}s)...`);
      this.ui.bubbles.say(ch, '🔪 Scrubbing in.', { hold: 3 });
      return;
    }
    if (t.phase === 'operating') {
      t.wait -= dt;
      if (t.wait > 0) return;
      sim.surgeryDone = t.surgery.id;
      if (sim.incurable) {
        // you cannot operate on a disease that does not exist — the table finds
        // its own way to kill them
        const cat = sim.catastrophe(t.surgery.label);
        sim.recordTx?.(`🔪 ${t.surgery.label}`, `☠ ${cat.short}`);
        this.ui.announce(`☠ On the table: ${cat.line}`, 'bad');
        this.ui.toast(`☠ ${sim.displayName}: ${cat.short.toUpperCase()}`, 'bad');
        sim.die?.(cat.short, true);
        this.addScore(-50, 'You tried to help');
      } else if (sim.case.surgery && sim.case.surgery === t.surgery.id) {
        sim.recordTx(`🔪 ${t.surgery.label}`, 'curative ✓');
        applyTreatment(this, sim);
        this.addScore(140, 'Correct surgery');
        this.ui.toast(`✅ ${t.surgery.label} went beautifully.`, 'good');
        this.audio.good();
      } else {
        sim.recordTx(`🔪 ${t.surgery.label}`, 'not indicated');
        this.addScore(-80, 'Unnecessary surgery');
        this.ui.toast(`⚠ ${t.surgery.label}... that was NOT the operation they needed.`, 'bad');
        sim.accel *= 2;
        if (!sim.case.surgery && this.rng.chance(0.25)) sim._goCritical();
      }
      this._exitEther(ch, t.patient);
      if (sim.state === 'dead') {              // the table claimed them — leave the body, go home
        if (ch.dragging) { ch.dragging.draggedBy = null; ch.dragging = null; }
        t.phase = 'home';
        t.route = this._routeTo(ch.pos, this.map.doctorSpawn);
        return;
      }
      sim.state = 'transport';
      t.phase = 'toRoomBack';
      const rd2 = this.map.roomDoor(t.bed.index);
      t.route = [{ x: rd2.x, z: -5.5 }, { x: rd2.x, z: -6 }, { x: t.bed.x + 0.9, z: t.bed.z + 1.1 }];
      return;
    }
    if (t.phase === 'toRoomBack') {
      ch.dragging = null; t.patient.draggedBy = null;
      this.bedPatient(t.patient, t.bed);
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
      if (pt) { pt.sim.pin(); c.tackleTimer = 0; this.addScore(30, 'Takedown!'); this.audio.tackle(); }
    }
    // monitors: a steady blip for anyone on the leads near you, and the alarm
    // keeps nagging while someone is crashing. Rate-limited so a full
    // department doesn't turn into a wall of beeps.
    this._blipT = (this._blipT ?? 0) - dt;
    if (this._blipT <= 0) {
      let crit = false, near = false;
      for (const p of this.world.byTag('patients')) {
        if (!p.sim.hooked || p.sim.state === 'dead') continue;
        const q = p.body.translation(), a = this.active.pos;
        if (Math.hypot(q.x - a.x, q.z - a.z) > 9) continue;
        near = true;
        if (p.sim.critical) crit = true;
      }
      if (crit) { this.audio.alarm(); this._blipT = 4.5; }
      else if (near) { this.audio.blip(); this._blipT = 2.6; }
      else this._blipT = 1.5;
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
        this.audio.fire();
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
    // day/night: drift the whole ward from a bright noon to a dark 12 AM lit
    // mostly by its own fixtures + the call lights
    this.renderer.setTimeOfDay(this._lockNoon ? 720 : this.clock.running ? this.clock.minutes : 660);
    const dark = 1 - this.renderer.daylight;   // 0 midday … 1 midnight

    // per-room CALL LIGHTS, by acuity:
    //   blue ready-for-discharge · green stable · yellow deteriorating ·
    //   orange rapidly deteriorating · red crashing
    this.map.beds.forEach((bed, i) => {
      const L = this.map.roomLights[i];
      if (!L) return;
      const sim2 = bed.occupant?.sim;
      let c = 0x8a94a4, inten = 0.25;
      const status = sim2?.acuityLight ?? 'empty';
      switch (status) {
        case 'off': c = 0x60646e; inten = 0.4; break;                                  // dead
        case 'red': c = 0xff2e2e; inten = 1.5 + Math.sin(now * 10) * 1.2; break;        // crashing (pulse)
        case 'orange': c = 0xff8c1a; inten = 1.2 + Math.sin(now * 5) * 0.5; break;      // rapidly deteriorating
        case 'yellow': c = 0xffc23c; inten = 1.0; break;                               // deteriorating, needs tx
        case 'green': c = 0x35e06a; inten = 0.95; break;                               // stable
        case 'blue': c = 0x4aa8ff; inten = 1.1 + Math.sin(now * 3) * 0.3; break;       // ready for discharge
        default: c = 0x8a94a4; inten = 0.22;                                           // empty room
      }
      L.mat.color.setHex(c); L.mat.emissive.setHex(c); L.mat.emissiveIntensity = inten;
      if (L.pt) { // the fixture actually throws light — and burns brighter after dark
        L.pt.color.setHex(c);
        L.pt.intensity = status === 'empty' ? 0 : (0.5 + inten * 0.7) * (0.4 + dark * 1.7);
      }
    });
    // warm wall sconces: near-off in daylight, the ward's main light after dark.
    // In chaos they become the red alarm strobes.
    this.map.sconces?.forEach((s, i) => {
      if (this.chaos && this._chaosAlarms) {
        const pulse = Math.max(0, Math.sin(now * 6.5 + i * 1.1));
        s.mat.color.setHex(0xff2626); s.mat.emissive.setHex(0xff2626);
        s.mat.emissiveIntensity = 0.3 + pulse * 2.4;
        if (s.pt) { s.pt.color.setHex(0xff3030); s.pt.intensity = pulse * 3.4; }
      } else {
        s.mat.color.setHex(0xffe6b0); s.mat.emissive.setHex(0xffca7a);
        s.mat.emissiveIntensity = 0.35 + dark * 1.2;
        if (s.pt) { s.pt.color.setHex(0xffcaa0); s.pt.intensity = dark * 2.2; }
      }
    });
    this._chaosFxFrame(dt, now);

    animateRig(this.receptionist, dt, now, 0, { sitting: true }); // typing away forever

    // the ether double-door: leaves slide apart while staff are transiting (or
    // approaching), and the red "in use" lamp glows
    const efx = this.map.etherFx;
    if (efx) {
      const near = [this.aide, this.porter, this.surgeon].some((c) => {
        const t = this.tasks.get(c);
        return t && (['toEther', 'processing', 'scanning', 'operating', 'toRoomBack', 'deliver'].includes(t.phase)) &&
          Math.abs(c.pos.x - this.map.etherDoor.x) < 2.4 && Math.abs(c.pos.z - this.map.etherDoor.z) < 1.6;
      });
      const want = (this._etherBusy ?? 0) > 0 || near ? 1 : 0;
      if (want && !efx._wasOpen) this.audio.door();   // the pneumatic hiss, once per cycle
      efx._wasOpen = want;
      efx.openT += (want - efx.openT) * Math.min(1, dt * 9);
      for (const leaf of efx.leaves) leaf.position.z = leaf.userData.base + leaf.userData.dir * efx.openT * (this.map.etherDoor.w / 2 - 0.1);
      efx.lamp.emissiveIntensity = 0.2 + want * (0.7 + Math.sin(now * 8) * 0.3);
    }

    // walls that can stand between the chase cam and the player drop to a
    // ghost while you're behind them (discharge wing wall, the EXIT wall)
    const ap1 = this.active.pos;
    for (const fg of this.map.fadeWalls) {
      const behind = fg.when(ap1);
      const t0 = fg._t ?? 1;
      const t1 = t0 + ((behind ? 0.18 : 1) - t0) * Math.min(1, dt * 8);
      fg._t = t1;
      if (Math.abs(t1 - t0) < 0.0005 && !behind && t1 > 0.999) continue; // settled solid — skip the writes
      for (const m of fg.mats) m.opacity = t1;
      const solid = t1 > 0.95;
      for (const mesh of fg.meshes) mesh.castShadow = solid && !!mesh.userData.casts;
    }

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

    // consult-terminal LEDs blink so the stations read as live & interactive
    for (const s of this.map.stationLights) {
      s.mat.emissiveIntensity = 0.5 + Math.max(0, Math.sin(now * 3 + s.phase)) * 1.6;
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
      if (it.data?.mop) {
        // the mop renders head-down: held, the head is planted on the floor
        // and the handle leans up toward whoever's dragging it; loose, it lies
        // flat where it was dropped
        if (it.heldBy) {
          const hp = it.heldBy.pos;
          _lean.set(hp.x - t.x, 1.15, hp.z - t.z).normalize();
          it.mesh.quaternion.setFromUnitVectors(_upY, _lean);
          it.mesh.position.y = Math.min(t.y, 0.06);
        } else {
          _lean.set(0.98, 0.06, 0.14).normalize();
          it.mesh.quaternion.setFromUnitVectors(_upY, _lean);
          it.mesh.position.y = 0.06;
        }
        continue;
      }
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
        if (this.activeIdx === 0 && this.tasks.has(this.nurse)) {
          if (this.nurse.dragging) { this.nurse.dragging.draggedBy = null; this.nurse.dragging = null; }
          this.tasks.delete(this.nurse);
          this.nurse._jobQueue = [];
          this.ui.toast('You took over from the nurse — her pager task is cancelled.');
        }
        this.audio.back();
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
    if (order === 'consult') { this.ui.modals.consultPick(pt); return; }
    if (order === 'discharge') {
      if (pt.sim.stabilized) {
        const sim = pt.sim;
        sim.resolved = true;
        this.dayStats.treated += 1;
        const dxRight = sim.dxPicked === (sim.case.correctDx ?? 0);
        this.addScore(Math.round(sim.case.score * (dxRight ? 1 : 0.55)), 'Discharged well');
        this.ui.toast(`🏠 ${sim.displayName} walking home!`, 'good');
        const leaveRoute = this._routeLeaving(sim, this.map.discharge); // door-first, BEFORE freeing the bed
        if (sim.bed) this.freeBed(sim);
        this.setPatientDynamic(pt);
        sim.state = 'leaving';
        sim.route = leaveRoute.concat([{ ...this.map.gateOut }]);
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
          ico: '🗂', label: 'OPEN CHART', color: '#c9a83c',
          run: () => {
            const pt2 = [...this.world.byTag('patients')].find((p) => p.id === clip.data.patientId);
            if (pt2) this.ui.modals.reports(pt2, clip.data.clip);
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

    // the two terminals at the staff desk: you SIT DOWN to use them, in the
    // free chair each one has, and the screen is turned to face the camera
    {
      const pp = char.pos;
      const TERM = {
        meddoc: { ico: '🪙', label: 'MED-DOC 4000', sit: 'SIT AT MED-DOC', color: '#2fae5f', open: () => this.ui.modals.medDoc() },
        triage: { ico: '🗂', label: 'TRIAGE BOARD', sit: 'SIT AT TRIAGE BOARD', color: '#3d8fd4', open: () => this.ui.modals.triageBoard() },
      };
      if (char.seatedAt) {
        const t = TERM[char.seatedAt.kind] ?? TERM.meddoc;
        return { ico: t.ico, label: t.label, color: t.color, run: t.open };
      }
      for (const s of this.map.termSeats ?? []) {
        if (Math.hypot(pp.x - s.x, pp.z - s.z) > 1.5) continue;
        const t = TERM[s.kind] ?? TERM.meddoc;
        return {
          ico: '🪑', label: t.sit, color: t.color,
          run: () => { char.sitAt(s); t.open(); },
        };
      }
    }
    // med cabinet: any pharmacy shelf is a face of the same tabbed cabinet
    const nearShelf = this.map.shelfUnits.some((u) => Math.hypot(u.x - cp.x, u.z - cp.z) < 2.3);
    if (nearShelf) return { ico: '💊', label: 'OPEN MED CABINET', color: '#d05a9e', run: () => this.ui.modals.cabinet() };

    const pt = this.nearestPatient(char, 1.9, (s) => s.state !== 'dead');
    if (pt && pt.sim.state === 'inbed') {
      // ALWAYS the chart. Ordering labs lives inside the workup (and on the
      // ORDERS wheel) — it used to replace this button once you'd read the
      // chart once, which made the workup unreachable for the rest of the case.
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
      this.audio.paper();
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
      this.awardCoin(pt);
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
      this.ui.announce(`📻 ROOM SAYS NOT YET, SIR — responding but needs ~${left} more min of monitoring.`, 'bad');
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
    sim.everRoomed = true; // being seen resets the social contract — no walkouts
    pt.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    pt.body.setTranslation({ x: bed.x, y: (bed.y ?? 0) + 1.05, z: bed.z + 0.15 }, true);
    pt.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    sim.state = 'inbed';
    sim.yaw = 0;
    pt.setFace(sim.critical ? 'crit' : 'normal');
    this.audio.bed();
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
        this.awardCoin(pt);
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
        this.awardCoin(pt);
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
    // a chime for anything worth noticing; small housekeeping points stay quiet
    if (pts >= 25) this.audio.score();
  }
}

const _v3 = new THREE.Vector3();
const _upY = new THREE.Vector3(0, 1, 0);
const _lean = new THREE.Vector3();
