import * as THREE from 'three';
import { makeCharacterMesh } from '../render/meshes.js';
import { animateRig } from '../render/rig.js';
import { springToward, uprightSpring } from '../physics/physics.js';

const SPRINT = 5.4;
const ACCEL = 0.16;
const TAU = Math.PI * 2;

// locomotion tuned hot: even a half-push is a jog. You are always in a rush.
function targetSpeed(mag) {
  if (mag < 0.12) return 0;
  if (mag < 0.5) return 2.2 + ((mag - 0.12) / 0.38) * 1.2;   // brisk walk
  if (mag < 0.85) return 3.4 + ((mag - 0.5) / 0.35) * 1.2;   // jog
  return 4.6 + ((mag - 0.85) / 0.15) * (SPRINT - 4.6);       // sprint
}
function smoothAngle(cur, tgt, l, dt) {
  const d = ((tgt - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return cur + d * (1 - Math.exp(-l * dt));
}

// The wobbly star of the show. One dynamic capsule with X/Z tilt free and a
// soft upright spring — it lists while sprinting, staggers when yanked, and
// faceplants on a missed tackle. Arms are cosmetic and point at what you grab.
export class Character {
  constructor(game, role, x, z) {
    this.game = game;
    this.role = role; // 'nurse' | 'doctor'
    this.body = game.physics.capsuleBody(x, z, { tiltWobble: true, mass: 70 });
    this.mesh = makeCharacterMesh(role);
    game.renderer.scene.add(this.mesh);
    this.move = { x: 0, z: 0 };
    this.yaw = 0;
    this.carrying = null;       // item entity
    this.dragging = null;       // patient entity
    this.grabHeld = false;      // HFF sticky hands: true while the button is down
    this.medDwell = 0;          // time spent holding a med against a patient
    this.tackleTimer = 0;       // >0 while lunging
    this.sprawlTimer = 0;       // >0 while upright spring weakened (faceplant)
    this.uprightK = 1300;
  }

  get pos() { return this.body.translation(); }

  handAnchor() {
    const p = this.pos; // body-relative height — works on every floor
    return { x: p.x + Math.sin(this.yaw) * 0.55, y: p.y - 0.05, z: p.z + Math.cos(this.yaw) * 0.55 };
  }

  applyMove(x, z) { this.move.x = x; this.move.z = z; }

  fixedUpdate(dt) {
    const body = this.body;
    // movement: joystick magnitude → walk/jog/sprint target, chased by impulses
    const mag = Math.min(1, Math.hypot(this.move.x, this.move.z));
    let cap = targetSpeed(mag);
    if (this.game.adrenaline && this === this.game.active) cap *= 1.25; // heart pounding, legs flying
    if (this.dragging) cap *= 0.8; // the reaction impulse provides the real resistance
    if (this.carrying) cap *= 0.94;
    const dirX = mag > 0.01 ? this.move.x / mag : 0;
    const dirZ = mag > 0.01 ? this.move.z / mag : 0;
    const v = body.linvel();
    const dvx = dirX * cap - v.x;
    const dvz = dirZ * cap - v.z;
    if (this.tackleTimer <= 0) {
      body.applyImpulse({ x: 70 * dvx * ACCEL, y: 0, z: 70 * dvz * ACCEL }, true);
    }
    // face where we run (smoothed, rec-room style)
    if (mag > 0.15) {
      this.yaw = smoothAngle(this.yaw, Math.atan2(this.move.x, this.move.z), 10, dt);
    }
    // upright spring — weakened while sprawling for the faceplant
    this.sprawlTimer = Math.max(0, this.sprawlTimer - dt);
    const k = this.sprawlTimer > 0 ? 90 : this.uprightK;
    uprightSpring(body, { k, c: 95, dt });

    this.tackleTimer = Math.max(0, this.tackleTimer - dt);

    // sticky hands: while the grab button is held and hands are empty, keep
    // trying to latch onto whatever drifts into reach (HFF-style)
    if (this.grabHeld && !this.carrying && !this.dragging) this.tryGrab();

    // carry springs
    if (this.carrying) {
      const a = this.handAnchor();
      springToward(this.carrying.body, a, { k: 55, c: 4, maxForce: 30, dt });
    }
    if (this.dragging) {
      // staff wheeling a patient thread tight doorways, so they keep the looser
      // gurney tow; YOU get the tightened, damped tow that feels controlled
      const staffTow = !!this.game.tasks?.has?.(this);
      const me = this.body.translation();
      const fwd = staffTow ? 0.55 : 0.72;
      const a = { x: me.x + Math.sin(this.yaw) * fwd, y: me.y - (staffTow ? 0.55 : 0.34), z: me.z + Math.cos(this.yaw) * fwd };
      const imp = springToward(this.dragging.body,
        a, staffTow ? { k: 3200, c: 700, maxForce: 2400, dt } : { k: 2400, c: 1000, maxForce: 2200, dt });
      // reaction: staff shrug it off; for you a light tug so a heavy patient has
      // SOME weight without wrenching you off course (the old 0.3 felt drunk)
      this.body.applyImpulse({ x: -imp.x * (staffTow ? 0.3 : 0.12), y: 0, z: -imp.z * (staffTow ? 0.3 : 0.12) }, true);
      const db = this.dragging.body;
      const dv = db.linvel();
      let dp = db.translation();
      // hard tether: grip is a grip, not a bungee.
      const TETHER = staffTow ? 1.15 : 0.95;
      const gap = Math.hypot(dp.x - a.x, dp.z - a.z);
      if (gap > TETHER) {
        const f = TETHER / gap;
        db.setTranslation({ x: a.x + (dp.x - a.x) * f, y: dp.y, z: a.z + (dp.z - a.z) * f }, true);
        db.setLinvel({ x: dv.x * 0.4, y: dv.y, z: dv.z * 0.4 }, true);
        dp = db.translation();
      }
      // unstick yank: if the tow jams on a corner, hop it over the snag
      const far = Math.hypot(dp.x - a.x, dp.z - a.z) > (staffTow ? 1.05 : 0.9);
      if (far && Math.hypot(dv.x, dv.z) < 0.2) this._stuckT = (this._stuckT ?? 0) + dt;
      else this._stuckT = 0;
      if (this._stuckT > 0.42) {
        db.applyImpulse({ x: (a.x - dp.x) * 13, y: 170, z: (a.z - dp.z) * 13 }, true);
        this._stuckT = 0;
      }
    }
  }

  syncMesh(dt, now) {
    const p = this.body.translation();
    const q = this.body.rotation();
    this.mesh.position.set(p.x, p.y - 0.8, p.z);
    // yaw from movement, tilt from physics (the wobble stays!)
    _yawQ.setFromAxisAngle(_up, this.yaw);
    _tiltQ.set(q.x, q.y, q.z, q.w);
    this.mesh.quaternion.copy(_tiltQ).multiply(_yawQ);
    // gait driven by actual velocity
    const v = this.body.linvel();
    const speed01 = Math.min(1, Math.hypot(v.x, v.z) / SPRINT);
    animateRig(this.mesh, dt, now, speed01, {
      reach: !!(this.carrying || this.dragging),
      sitting: !!this.atPost && !this.carrying && !this.dragging,
    });
  }

  tryGrab() {
    const game = this.game;
    if (this.carrying || this.dragging) return;
    const a = this.handAnchor();
    // nearest item first
    let best = null, bestD = 1.5;
    for (const it of game.world.byTag('items')) {
      if (it.heldBy) continue;
      const p = it.body.translation();
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      if (d < bestD) { best = it; bestD = d; }
    }
    if (best) {
      this.carrying = best; best.heldBy = this;
      game.ui.toast(`Grabbed: ${best.label}`);
      return;
    }
    // then a grabbable patient — forgiving HFF magnetism: reach from the hand
    // OR from the body, whichever is closer
    const me = this.pos;
    let bp = null, bpD = 2.1;
    for (const pt of game.world.byTag('patients')) {
      if (!pt.sim.isGrabbable()) continue;
      const p = pt.body.translation();
      if (Math.abs(p.y - me.y) > 1.6) continue; // same floor only
      const d = Math.min(Math.hypot(p.x - a.x, p.z - a.z), Math.hypot(p.x - me.x, p.z - me.z) + 0.3);
      if (d < bpD) { bp = pt; bpD = d; }
    }
    if (bp) {
      bp.sim.onGrabbed();
      this.dragging = bp; bp.draggedBy = this;
      game.ui.toast(`Dragging ${bp.sim.displayName}`);
    }
  }

  release() {
    if (this.carrying) {
      const it = this.carrying;
      it.heldBy = null; this.carrying = null;
      // toss it gently forward — free comedy, also how you hand papers over
      it.body.applyImpulse({ x: Math.sin(this.yaw) * 0.6, y: 0.3, z: Math.cos(this.yaw) * 0.6 }, true);
      this.game.onItemReleased(it, this);
    } else if (this.dragging) {
      const pt = this.dragging;
      pt.draggedBy = null; this.dragging = null;
      this.game.onPatientReleased(pt, this);
    }
  }

  tackle() {
    if (this.tackleTimer > 0) return;
    this.tackleTimer = 0.55;
    this.sprawlTimer = 1.1; // commit to the dive — recover upright after
    this.body.applyImpulse({ x: Math.sin(this.yaw) * 340, y: 60, z: Math.cos(this.yaw) * 340 }, true);
    this.game.ui.toast('LEEEROY!');
  }
}
const _up = new THREE.Vector3(0, 1, 0);
const _yawQ = new THREE.Quaternion();
const _tiltQ = new THREE.Quaternion();
