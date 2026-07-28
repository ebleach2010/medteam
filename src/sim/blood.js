import * as THREE from 'three';

// Blood on the floor — the organic kind, not the circular-decal kind.
//
// Pools are irregular tinted splats: every instance gets its own shade of
// red, its own rotation, and a stretched shape, so overlapping blobs read as
// one liquid mess instead of a polka-dot pattern. Pools GROW where a patient
// is bleeding, and once they're big enough they CREEP — each pool drifts a
// chain of child blobs out of its room, through the door, into the hallway.
//
// The mop never removes any of it. Dragging the head through blood lays down
// STREAKS — long, lighter, striated smear marks along the direction of the
// drag — which is all mopping a scene like this was ever going to achieve.
const MAX_POOLS = 128;
const MAX_STREAKS = 110;
const POOL_MAX_R = 0.85;
const SLIP_CHANCE = 0.1;
// the ward's room-door x positions — creep aims for the nearest door, then
// the corridor (kept in sync with map.js ROOM_X)
const DOOR_X = [-28, -24, -20, -16, -12, -8];

// an irregular splat: wet dark centre, ragged fingered rim. Drawn WHITE so
// per-instance colors tint it into the full range of dried-to-fresh reds.
function splatTexture(seed = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.62, 'rgba(255,255,255,0.97)');
  grd.addColorStop(0.88, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  // heavily perturbed rim with a few long fingers — nothing circular about it
  const f1 = 2 + Math.floor(rnd() * 3), f2 = 5 + Math.floor(rnd() * 4);
  g.beginPath();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    let r = 44 + Math.sin(a * f1 + rnd()) * 9 + Math.cos(a * f2) * 6;
    if (i % 9 === 0) r += 10 + rnd() * 8;            // a finger reaching out
    const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
  // satellite droplets around the rim
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, rr = 52 + rnd() * 10;
    g.beginPath();
    g.arc(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr, 1.5 + rnd() * 3, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// a mop streak: a long smear with striations from the strings, ragged at both
// ends, thinning toward the edges. Also white — tinted per instance.
function streakTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  for (let row = 0; row < 7; row++) {
    const y = 9 + row * 7 + (row % 2 ? 2 : -1);
    const alpha = 0.5 + (row % 3) * 0.18;
    const grd = g.createLinearGradient(0, 0, 128, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.12 + (row % 3) * 0.05, `rgba(255,255,255,${alpha})`);
    grd.addColorStop(0.85 - (row % 2) * 0.06, `rgba(255,255,255,${alpha * 0.8})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, y, 128, 2.4 + (row % 2));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// pool shades: fresh arterial through drying maroon
const POOL_SHADES = [0x8c0e14, 0x7a0a10, 0x99141a, 0x6e070c, 0x8a1018, 0x5e060a];
// streak shades: thinner film — lighter, browner
const STREAK_SHADES = [0xa32c26, 0x96231f, 0xb03a30, 0x8a1e1a];

export class Blood {
  constructor(game) {
    this.game = game;
    this.pools = [];            // { x, z, r, rot, sx, sz, shade }
    this.streaks = [];          // { x, z, yaw, len, w, shade }
    this.group = new THREE.Group();
    game.renderer.scene.add(this.group);
    const geo = new THREE.PlaneGeometry(1, 1);

    const poolMat = new THREE.MeshBasicMaterial({
      map: splatTexture(7), transparent: true, depthWrite: false, opacity: 0.96,
    });
    poolMat.fog = false;
    this.mesh = new THREE.InstancedMesh(geo, poolMat, MAX_POOLS);
    this.mesh.count = 0;
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    const streakMat = new THREE.MeshBasicMaterial({
      map: streakTexture(), transparent: true, depthWrite: false, opacity: 0.8,
    });
    streakMat.fog = false;
    this.streakMesh = new THREE.InstancedMesh(geo, streakMat, MAX_STREAKS);
    this.streakMesh.count = 0;
    this.streakMesh.renderOrder = 4;    // smears sit ON the pools
    this.streakMesh.frustumCulled = false;
    this.group.add(this.streakMesh);

    this._m4 = new THREE.Matrix4();
    this._qFlat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this._qYaw = new THREE.Quaternion();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
    this._creepAcc = 0;
  }

  clear() {
    this.pools.length = 0;
    this.streaks.length = 0;
    this.mesh.count = 0;
    this.streakMesh.count = 0;
  }

  // how hard is this patient bleeding right now? 0 = not at all
  _rate(sim) {
    if (sim.treated || sim.resolved) return 0;         // haemostasis achieved
    if (sim.state === 'dead') return 0;
    // chaos: every one of the ten is a catastrophe — while they're crashing
    // they bleed where they lie, so every pool on the floor is traceably THEIRS
    if (this.game.chaos) return sim.critical ? 0.05 : 0.008;
    if (sim.case?.fail !== 'bleed') return 0;
    const tier = sim.case.tier ?? 2;
    let r = 0.02 + (tier - 1) * 0.022;                 // sicker cases bleed harder
    if (sim.critical) r *= 2.4;                        // actively exsanguinating
    return r;
  }

  _newPool(x, z, r) {
    const rng = this.game.rng;
    this.pools.push({
      x, z, r,
      rot: rng.next() * Math.PI * 2,
      sx: 0.75 + rng.next() * 0.6,                     // stretched, never a disc
      sz: 0.75 + rng.next() * 0.6,
      shade: POOL_SHADES[(rng.next() * POOL_SHADES.length) | 0],
    });
  }

  addAt(x, z, amount) {
    // grow the nearest pool; once it's saturated, spread into a new blob so the
    // puddle creeps outward instead of turning into one giant disc
    let best = null, bestD = Infinity;
    for (const p of this.pools) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best && bestD < POOL_MAX_R * 0.9 && best.r < POOL_MAX_R) {
      best.r = Math.min(POOL_MAX_R, best.r + amount);
      return;
    }
    if (best && bestD < 0.42) return; // saturated right here — spread elsewhere
    if (this.pools.length >= MAX_POOLS) {
      if (best) best.r = Math.min(POOL_MAX_R, best.r + amount * 0.5);
      return;
    }
    const jx = (this.game.rng.next() - 0.5) * 0.5;
    const jz = (this.game.rng.next() - 0.5) * 0.5;
    this._newPool(x + jx, z + jz, Math.max(0.12, amount * 3));
  }

  // a lighter smear mark laid along the mop's direction of travel
  addStreak(x, z, yaw) {
    const rng = this.game.rng;
    if (this.streaks.length >= MAX_STREAKS) this.streaks.shift(); // oldest smear fades under new ones
    this.streaks.push({
      x, z, yaw: yaw + rng.range(-0.12, 0.12),
      len: 0.9 + rng.next() * 0.7,
      w: 0.26 + rng.next() * 0.12,
      shade: STREAK_SHADES[(rng.next() * STREAK_SHADES.length) | 0],
    });
  }

  // the shotgun's wall paint: a vertical splat with drips, facing `yaw`
  wallSpray(x, y, z, yaw) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.1),
      new THREE.MeshBasicMaterial({ map: splatTexture(41), transparent: true, depthWrite: false, opacity: 0.95, color: 0x7c0b10 }));
    m.material.fog = false;
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.scale.y = 1.35;                                  // gravity stretches the drips
    m.renderOrder = 5;
    return m;
  }

  // pools don't sit still: the big ones bleed a chain of child blobs toward
  // the nearest room door, then out into the hallway. The floor is a slope in
  // spirit, and the hallway is downhill.
  _creep(dt) {
    this._creepAcc += dt;
    if (this._creepAcc < 2.2) return;
    this._creepAcc = 0;
    if (this.pools.length >= MAX_POOLS - 6) return;
    const rng = this.game.rng;
    let budget = 2;                                    // at most two creeps a beat
    for (const p of this.pools) {
      if (budget <= 0) break;
      if (p.r < 0.5 || rng.next() < 0.6) continue;
      let dx, dz;
      if (p.z < -6.2) {
        // inside a room: creep for the door
        let doorX = DOOR_X[0];
        for (const d of DOOR_X) if (Math.abs(d - p.x) < Math.abs(doorX - p.x)) doorX = d;
        dx = doorX - p.x; dz = -4.2 - p.z;
      } else if (p.z < 0.5) {
        // in the corridor: drift along the hallway
        dx = (rng.next() < 0.5 ? -1 : 1) * 2; dz = 0.6;
      } else {
        // lobby: settle outward, slowly
        dx = rng.range(-1, 1); dz = rng.range(-1, 1);
      }
      const len = Math.hypot(dx, dz) || 1;
      const step = p.r * 0.7 + 0.25;
      this._newPool(
        p.x + (dx / len) * step + rng.range(-0.15, 0.15),
        p.z + (dz / len) * step + rng.range(-0.15, 0.15),
        0.16 + rng.next() * 0.12,
      );
      budget -= 1;
    }
  }

  tick(dt) {
    for (const p of this.game.world.byTag('patients')) {
      const rate = this._rate(p.sim);
      if (rate <= 0) continue;
      const t = p.body.translation();
      this.addAt(t.x, t.z, rate * dt);
    }
    if (this.game.chaos) this._creep(dt);
    this._mopSmear();
    this._paint();
    this._slipChecks();
  }

  // the mop. It does not clean. Dragging its head across a pool lays lighter,
  // striated smear marks along the direction of travel — spreading the blood
  // is the only thing it will ever do.
  _mopSmear() {
    const g = this.game;
    const mop = g._mop;
    if (!mop?.heldBy) return;
    const ch = mop.heldBy;
    const t = mop.body.translation();          // the head is what smears
    const v = ch.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    if (speed < 0.6) return;                   // you have to be pushing it
    for (const p of this.pools) {
      if (p.r < 0.2) continue;
      if (Math.hypot(p.x - t.x, p.z - t.z) < p.r + 0.55) {
        this._smearAcc = (this._smearAcc ?? 0) + 1;
        if (this._smearAcc % 6 === 0) {
          const yaw = Math.atan2(v.x, v.z);    // streak lies along the drag
          this.addStreak(t.x + Math.sin(yaw) * 0.3, t.z + Math.cos(yaw) * 0.3, yaw);
        }
        if (this._smearAcc % 18 === 0) {       // and the blood itself travels
          this.addAt(t.x + Math.sin(ch.yaw) * 0.5, t.z + Math.cos(ch.yaw) * 0.5, 0.1);
        }
        return;
      }
    }
  }

  _paint() {
    const n = Math.min(this.pools.length, MAX_POOLS);
    for (let i = 0; i < n; i++) {
      const p = this.pools[i];
      const s = p.r * 2.4;
      this._qYaw.setFromAxisAngle(this._up, p.rot);
      this._q.copy(this._qYaw).multiply(this._qFlat);
      this._v.set(p.x, 0.019 + (i % 7) * 0.0004, p.z);   // micro z-fighting spread
      this._s.set(s * p.sx, s * p.sz, 1);
      this._m4.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m4);
      this.mesh.setColorAt(i, this._c.setHex(p.shade));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    const m = Math.min(this.streaks.length, MAX_STREAKS);
    for (let i = 0; i < m; i++) {
      const st = this.streaks[i];
      // the texture streaks run along X; yaw the quad so they run along the drag
      this._qYaw.setFromAxisAngle(this._up, st.yaw + Math.PI / 2);
      this._q.copy(this._qYaw).multiply(this._qFlat);
      this._v.set(st.x, 0.026 + (i % 5) * 0.0004, st.z);
      this._s.set(st.len, st.w, 1);
      this._m4.compose(this._v, this._q, this._s);
      this.streakMesh.setMatrixAt(i, this._m4);
      this.streakMesh.setColorAt(i, this._c.setHex(st.shade));
    }
    this.streakMesh.count = m;
    this.streakMesh.instanceMatrix.needsUpdate = true;
    if (this.streakMesh.instanceColor) this.streakMesh.instanceColor.needsUpdate = true;
  }

  // is (x,z) standing in blood? (a bit inside the rim — edges are thin)
  isIn(x, z) {
    for (const p of this.pools) {
      if (p.r < 0.2) continue;
      if (Math.hypot(p.x - x, p.z - z) < p.r * 0.92) return true;
    }
    return false;
  }

  // one roll each time a character walks ONTO blood
  _slipChecks() {
    for (const ch of [this.game.nurse, this.game.doctor]) {
      if (!ch) continue;
      const t = ch.body.translation();
      const wet = this.isIn(t.x, t.z);
      const was = ch._inBlood ?? false;
      ch._inBlood = wet;
      if (!wet || was) continue;                 // only on entering the pool
      if (ch.sprawlTimer > 0) continue;          // already down
      const v = ch.body.linvel();
      const speed = Math.hypot(v.x, v.z);
      if (speed < 0.2) continue;
      if (this.game.chaos) {
        // chaos rules: hit blood at a run and you GO DOWN, every single time.
        // The only way across is to slow to a careful walk.
        if (speed < 3.3) continue;
      } else if (!this.game.rng.chance(SLIP_CHANCE)) continue;
      ch.slip();
      if (ch === this.game.active) {
        this.game.ui.toast(this.game.chaos
          ? '🩸 The blood takes you down AGAIN. Walk. Slowly.'
          : '🩸 You hit the blood and go down. Wonderful.', 'bad');
        this.game.barks?.say('slip', true);   // ch.slip() already made the wet skid
      }
    }
  }
}
