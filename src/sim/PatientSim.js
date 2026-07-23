// Per-patient medical state machine + vitals engine. All times in in-game
// minutes unless suffixed Real. Driven by the case data in data/cases.js.

const CURSES = ['#@$%!!', '✱&@#!?', 'THIS IS %$#@!', 'I pay taxes!!', '@#$% this ER!!',
  'ONE STAR. ONE.', 'I’m calling the manager of HOSPITALS'];

export class PatientSim {
  constructor(game, ent, caseData) {
    this.game = game; this.ent = ent; this.case = caseData;
    this.state = 'arriving';       // arriving|waiting|angry|walkout|escorted|inbed|agitated|pinned|sedated|leaving|dead
    this.critical = false;
    this.tArrive = game.clock.minutes;
    this.accel = 1;                // >1 after harmful med (timeline runs faster)
    this.bed = null; this.seat = null;
    this.hooked = false;
    this.labState = 'none';        // none|drawn|spinning|ready|read
    this.imagingDone = false; this.imagingRead = null; // option index picked
    this.orders = new Set();
    this.medsGiven = new Set();
    this.dxPicked = null;
    this.treated = false; this.tTreated = 0;
    this.wantsDischarge = false;
    this.deadCause = null;
    this.leaveHappy = false; this.resolved = false;
    this.sedatedUntil = 0; this.pinnedUntilReal = 0;
    this.sitting = false;
    this.walkTarget = null;
    this.yaw = 0;
    this.nextBubbleAt = game.clock.minutes + game.rng.range(30, 70);
    this.wanderTimerReal = 0;
    this.scanSeed = game.rng.int(1, 1e9);
    this.age = game.rng.int(18, 92);
    this.workups = {};            // ekg/phys/neuro done flags
    this.chartSeen = false;
    this.incinerating = 0;        // >0 while burning in the pit

    this.displayName = `${ent.name}`;
    // arrival complaint — the core feature
    game.ui.bubbles.say(ent, game.rng.pick(caseData.complaint), { hold: 5 });
  }

  get elapsed() { return (this.game.clock.minutes - this.tArrive) * this.accel; }
  isLying() { return ['inbed', 'sedated', 'dead', 'pinned'].includes(this.state); }
  isGrabbable() {
    // dead bodies are ABSOLUTELY grabbable — someone has to haul them to the pit
    return ['waiting', 'sedated', 'inbed', 'pinned', 'angry', 'dead', 'arriving'].includes(this.state);
  }
  canReceiveMeds() { return ['inbed', 'pinned', 'sedated', 'agitated', 'waiting'].includes(this.state); }

  // ---------------- vitals ----------------
  vitals() {
    const b = this.case.vitals, t = this.elapsed;
    const off = { hr: 0, sbp: 0, dbp: 0, rr: 0, spo2: 0, temp: 0 };
    let prevT = 0; const prev = { ...off };
    for (const key of this.case.timeline) {
      if (!key.vitals) continue;
      const target = { ...prev };
      for (const k in key.vitals) target[k] = prev[k] + key.vitals[k];
      if (t >= key.t) { Object.assign(prev, target); prevT = key.t; }
      else {
        const f = Math.max(0, (t - prevT) / Math.max(1, key.t - prevT));
        for (const k in off) off[k] = prev[k] + (target[k] - prev[k]) * f;
        prevT = -1; break;
      }
    }
    if (prevT !== -1) Object.assign(off, prev);
    // recovery after correct treatment: offsets decay to 0 over 60 min
    if (this.treated) {
      const f = Math.max(0, 1 - (this.game.clock.minutes - this.tTreated) / 60);
      for (const k in off) off[k] *= f;
    }
    if (this.state === 'dead') return { hr: 0, sbp: 0, dbp: 0, rr: 0, spo2: 0, temp: b.temp - 1 };
    const n = (amp) => (this.game.rng.next() - 0.5) * amp;
    const sed = this.state === 'sedated' ? 0.85 : 1;
    return {
      hr: Math.max(0, Math.round((b.hr + off.hr) * sed + n(4))),
      sbp: Math.max(0, Math.round(b.sbp + off.sbp + n(4))),
      dbp: Math.max(0, Math.round(b.dbp + off.dbp + n(3))),
      rr: Math.max(0, Math.round((b.rr + off.rr) * sed + n(1.6))),
      spo2: Math.min(100, Math.max(0, Math.round(b.spo2 + off.spo2 + n(1)))),
      temp: +(b.temp + off.temp + n(0.1)).toFixed(1),
    };
  }

  alarming() {
    if (this.state === 'dead') return true;
    const v = this.vitals();
    return v.spo2 < 88 || v.sbp < 85 || v.hr > 135 || v.hr < 45 || v.rr > 30 || v.rr < 8;
  }

  // ---------------- main tick (fixed step) ----------------
  tick(dtReal) {
    const g = this.game, dtMin = dtReal * g.clock.timeScale;
    const now = g.clock.minutes;

    if (this.state === 'dead') { this._steer(dtReal); return; } // corpses persist until incinerated

    // timeline events
    if (!this.treated) {
      for (const key of this.case.timeline) {
        if (key.done || this.elapsed < key.t) continue;
        key.done = true;
        if (key.event === 'critical') this._goCritical();
        if (key.event === 'death') this.die(key.cause ?? 'deterioration');
        if (key.bubble && this.state !== 'dead') this._say(key.bubble);
      }
      if (this.state === 'dead') return;
    }

    // waiting-room patience → anger → walkout
    if (this.state === 'waiting' || this.state === 'angry') {
      const waited = now - this.tArrive;
      const overCap = g.edOverCapacity();
      if (this.state === 'waiting' && (waited > this.case.patienceMin || (overCap && waited > 25))) {
        this.state = 'angry';
        this.sitting = false;                      // storms up out of the chair
        g.setPatientDynamic(this.ent);
        this.ent.setFace('angry');
        this._sayRaw(g.rng.pick(CURSES), 'angry');
      } else if (this.state === 'angry' && waited > this.case.patienceMin * 1.6 + 40) {
        this.state = 'walkout';
        this.walkTarget = { ...g.map.spawnOutside };
        this._sayRaw('I’m OUT. ✌️', 'angry');
        g.onWalkout(this);
      }
    }

    // agitation roll (untreated, in bed)
    if (this.state === 'inbed' && !this.treated && this.case.agitationRisk > 0 &&
        g.rng.chance(this.case.agitationRisk * dtMin)) {
      this.agitate();
    }

    // sedation wears off
    if (this.state === 'sedated' && now > this.sedatedUntil) {
      this.state = this.bed ? 'inbed' : 'sedated';
      if (!this.bed) this.sedatedUntil = now + 30; // still floppy on the floor
      else this._say('stable');
    }

    // pin expires un-sedated → right back to chaos
    if (this.state === 'pinned' && g.timeReal > this.pinnedUntilReal) {
      this.agitate();
    }

    // critical + terminal vitals → death
    if (this.critical && !this.treated) {
      const v = this.vitals();
      if (v.sbp < 50 || v.spo2 < 55) this.die('cardiovascular collapse');
    }

    // ambient feedback bubbles — patients narrate how they feel
    if (now > this.nextBubbleAt && !['walkout', 'leaving'].includes(this.state)) {
      this.nextBubbleAt = now + g.rng.range(40, 90);
      if (this.state === 'angry') this._sayRaw(g.rng.pick(CURSES), 'angry');
      else if (this.state === 'sedated') this._sayRaw('Zzzzz…');
      else if (this.state === 'agitated') this._sayRaw('CAN’T CATCH ME!!', 'angry');
      else if (this.critical) this._say('critical', 'critical');
      else if (this.treated) this._say('better');
      else if (this.elapsed > (this.case.timeline[0]?.t ?? 1e9)) this._say('worse');
      else this._say('stable');
    }

    // (no self-discharge: patients leave through the DISCHARGE ROOM now)
    this._steer(dtReal);
  }

  // steering / movement per state (dynamic body, velocity-driven)
  _steer(dtReal) {
    const g = this.game, body = this.ent.body;
    const speed = { arriving: 1.7, walkout: 2.2, leaving: 2.0, angry: 1.9, agitated: 3.4 }[this.state] ?? 0;

    if (this.ent.draggedBy) return;                    // the spring owns them
    if (this.state === 'inbed' || this.state === 'dead') return; // kinematic

    if (this.state === 'pinned') {                     // squished under a heroic tackle
      body.setLinvel({ x: 0, y: body.linvel().y, z: 0 }, true);
      return;
    }
    if (this.state === 'sedated') return;              // floppy

    let target = this.walkTarget;
    if (this.ent.escortedBy) {
      const cp = this.ent.escortedBy.pos;
      target = { x: cp.x, z: cp.z };
    } else if (this.state === 'angry') {
      const nurse = g.nurse.pos;
      // only chase the nurse on the same floor; otherwise fume by the entrance
      target = Math.abs(nurse.y - body.translation().y) < 1.5
        ? { x: nurse.x, z: nurse.z }
        : { x: g.map.insideWaypoint.x, z: g.map.insideWaypoint.z };
    } else if (this.state === 'agitated') {
      this.wanderTimerReal -= dtReal;
      if (this.wanderTimerReal <= 0) {
        this.wanderTimerReal = 0.7;
        const a = g.rng.next() * Math.PI * 2;
        this.walkTarget = { x: body.translation().x + Math.sin(a) * 6, z: body.translation().z + Math.cos(a) * 6 };
      }
      target = this.walkTarget;
    }

    if (!target || speed === 0) {
      const v = body.linvel();
      body.setLinvel({ x: v.x * 0.8, y: v.y, z: v.z * 0.8 }, true);
      return;
    }
    const p = body.translation();
    const dx = target.x - p.x, dz = target.z - p.z;
    const d = Math.hypot(dx, dz);
    const stopAt = this.ent.escortedBy ? 1.5 : (this.state === 'angry' ? 1.1 : 0.3);
    if (d < stopAt) {
      body.setLinvel({ x: 0, y: body.linvel().y, z: 0 }, true);
      if (this.route?.length) { this.walkTarget = this.route.shift(); return; } // next waypoint
      if (this.state === 'arriving') {
        if (this.seat) g.seatPatient(this);      // plop down in the chair
        else this.state = 'waiting';
      }
      if ((this.state === 'walkout' || this.state === 'leaving') && d < 1.2) g.removePatient(this.ent);
      return;
    }
    this.yaw = Math.atan2(dx, dz);
    body.setLinvel({ x: (dx / d) * speed, y: body.linvel().y, z: (dz / d) * speed }, true);
  }

  // ---------------- transitions ----------------
  _goCritical() {
    if (this.critical) return;
    this.critical = true;
    this.ent.setFace('crit');
    this._say('critical', 'critical');
    this.game.ui.toast(`${this.displayName} is CRASHING!`, 'bad');
    this.game.audio?.alarm();
  }

  die(cause) {
    if (this.state === 'dead') return;
    // last-second save chance if correct meds were already flowing
    if (this.treated && this.game.rng.chance(this.case.rescueChance ?? 0.5)) return;
    this.state = 'dead'; this.deadCause = cause;
    this.ent.setFace('dead');
    this.ent.escortedBy = null;
    if (this.ent.draggedBy) { this.ent.draggedBy.dragging = null; this.ent.draggedBy = null; }
    this._sayRaw('💀', 'critical');
    this.game.onDeath(this, cause);
  }

  agitate() {
    if (['dead', 'walkout'].includes(this.state)) return;
    if (this.bed) this.game.freeBed(this);
    this.game.setPatientDynamic(this.ent);
    this.state = 'agitated';
    this.hooked = false;
    if (this.labState === 'drawn') this.labState = 'none'; // yanked the IV, ruined the draw
    this.ent.setFace('angry');
    this._sayRaw('*RIPS OUT IV* FREEDOM!!', 'angry');
    this.game.ui.toast(`${this.displayName} is agitated — tackle them!`, 'bad');
  }

  pin() {
    this.state = 'pinned';
    this.pinnedUntilReal = this.game.timeReal + 5;
    this._sayRaw('oof—');
  }

  sedate() {
    this.state = 'sedated';
    this.sedatedUntil = this.game.clock.minutes + 150;
    this.ent.setFace('normal');
    this._sayRaw('…nini 💤');
    this.game.ui.toast(`${this.displayName} sedated. Back to bed with them.`, 'good');
  }

  onGrabbed() {
    this.ent.escortedBy = null;
    this.sitting = false;
    if (this.bed) this.game.freeBed(this);
    if (this.seat) { this.seat.taken = null; this.seat = null; }
    this.game.setPatientDynamic(this.ent);
    if (this.state === 'waiting' || this.state === 'arriving' || this.state === 'angry') this.state = 'escorted';
    if (this.state === 'inbed') this.state = 'escorted';
  }

  // ---------------- speech ----------------
  _say(kind, cls) {
    const pool = this.case.bubbles[kind];
    if (pool?.length) this._sayRaw(this.game.rng.pick(pool), cls);
  }
  _sayRaw(text, cls) { this.game.ui.bubbles.say(this.ent, text, { cls }); }
}
