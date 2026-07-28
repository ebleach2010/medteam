import * as THREE from 'three';

// Blood on the floor. Patients whose failure mode is exsanguination leak while
// they're untreated — faster the sicker they are — and the puddle grows and
// spreads from wherever they happen to be. Drag a bleeder down the corridor and
// you'll trail it into the hallway, which is where it becomes YOUR problem:
// every time you walk onto a pool you roll a 10% chance to wipe out.
const MAX_POOLS = 56;
const POOL_MAX_R = 0.85;      // a single blob caps here, then spreads to a new one
const SLIP_CHANCE = 0.1;      // independent roll per crossing, not every 10th

function bloodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  // dark wet centre fading to a thin bright rim — reads as liquid, not a decal
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(96,6,10,1)');
  grd.addColorStop(0.55, 'rgba(126,10,14,1)');
  grd.addColorStop(0.86, 'rgba(150,18,22,0.95)');
  grd.addColorStop(1, 'rgba(150,18,22,0)');
  g.fillStyle = grd;
  // slightly irregular splat rather than a perfect circle
  g.beginPath();
  for (let i = 0; i <= 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const r = 58 + Math.sin(a * 3.1) * 4 + Math.cos(a * 5.7) * 3;
    const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Blood {
  constructor(game) {
    this.game = game;
    this.pools = [];            // { x, z, r }
    this.group = new THREE.Group();
    game.renderer.scene.add(this.group);
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: bloodTexture(), transparent: true, depthWrite: false, opacity: 0.95,
    });
    mat.fog = false;
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_POOLS);
    this.mesh.count = 0;
    this.mesh.renderOrder = 3;   // over the floor + AO, under the glow rings
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  clear() {
    this.pools.length = 0;
    this.mesh.count = 0;
  }

  // how hard is this patient bleeding right now? 0 = not at all
  _rate(sim) {
    if (sim.case?.fail !== 'bleed') return 0;
    if (sim.treated || sim.resolved) return 0;         // haemostasis achieved
    if (sim.state === 'dead') return 0;
    const tier = sim.case.tier ?? 2;
    let r = 0.02 + (tier - 1) * 0.022;                 // sicker cases bleed harder
    if (sim.critical) r *= 2.4;                        // actively exsanguinating
    return r;
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
    this.pools.push({ x: x + jx, z: z + jz, r: Math.max(0.12, amount * 3) });
  }

  tick(dt) {
    for (const p of this.game.world.byTag('patients')) {
      const rate = this._rate(p.sim);
      if (rate <= 0) continue;
      const t = p.body.translation();
      this.addAt(t.x, t.z, rate * dt);
    }
    this._mopSmear();
    this._paint();
    this._slipChecks();
  }

  // the mop. It does not clean. Dragging it across a pool only smears fresh
  // blood along wherever you walk — the floor can only ever get worse.
  _mopSmear() {
    const g = this.game;
    const mop = g._mop;
    if (!mop?.heldBy) return;
    const ch = mop.heldBy;
    const t = ch.body.translation();
    const v = ch.body.linvel();
    if (Math.hypot(v.x, v.z) < 0.6) return;    // you have to be pushing it
    for (const p of this.pools) {
      if (p.r < 0.2) continue;
      if (Math.hypot(p.x - t.x, p.z - t.z) < p.r + 0.55) {
        this._smearAcc = (this._smearAcc ?? 0) + 1;
        if (this._smearAcc % 8 === 0) {
          this.addAt(t.x + Math.sin(ch.yaw) * 0.55, t.z + Math.cos(ch.yaw) * 0.55, 0.11);
        }
        return;
      }
    }
  }

  _paint() {
    const n = Math.min(this.pools.length, MAX_POOLS);
    for (let i = 0; i < n; i++) {
      const p = this.pools[i];
      const s = p.r * 2.4; // texture has transparent margin, so oversize a touch
      this._v.set(p.x, 0.019, p.z);
      this._s.set(s, s, 1);
      this._m4.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m4);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // is (x,z) standing in blood? (a bit inside the rim — edges are thin)
  isIn(x, z) {
    for (const p of this.pools) {
      if (p.r < 0.2) continue;
      if (Math.hypot(p.x - x, p.z - z) < p.r * 0.92) return true;
    }
    return false;
  }

  // one independent 10% roll each time a character walks ONTO blood
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
      // a true, independent 10% roll on EVERY crossing — the only thing that
      // skips the roll is standing still ON the rim (you have to be crossing it)
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
