import * as THREE from 'three';
import { makeCharacterMesh } from '../render/meshes.js';
import { animateRig } from '../render/rig.js';
import { springToward, uprightSpring, RAPIER } from '../physics/physics.js';

const SPRINT = 5.4;
const ACCEL = 0.16;
const TAU = Math.PI * 2;
const SLIP_TIME = 3.0;   // seconds face-down after a wipeout

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

  // park yourself in a terminal chair — same rooted, bolt-upright pose the
  // staff use. Any real push on the stick gets you back on your feet.
  sitAt(seat) {
    this.seatedAt = seat;
    this.release();
    this.body.setTranslation({ x: seat.x, y: this.body.translation().y, z: seat.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.yaw = seat.yaw ?? Math.PI;
    this.game.audio?.bed?.();
  }

  standUp() {
    if (!this.seatedAt) return;
    this.seatedAt = null;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  }

  fixedUpdate(dt) {
    const body = this.body;
    if (this.seatedAt) {
      // seated: hold the pose until you actually shove the stick
      if (Math.hypot(this.move.x, this.move.z) > 0.35) this.game.leaveTerminal?.(this);
      else { this.applyMove(0, 0); return; }
    }
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
    // no locomotion while sprawled — you can't run mid-faceplant, and braking
    // toward zero would kill the slide. Momentum bleeds off via floor friction.
    if (this.tackleTimer <= 0 && this.sprawlTimer <= 0) {
      body.applyImpulse({ x: 70 * dvx * ACCEL, y: 0, z: 70 * dvz * ACCEL }, true);
    }
    // face where we run (smoothed, rec-room style) — but not while down
    if (mag > 0.15 && this.sprawlTimer <= 0) {
      this.yaw = smoothAngle(this.yaw, Math.atan2(this.move.x, this.move.z), 10, dt);
    }
    // upright spring — stays limp for most of the sprawl so you lie flat and
    // slide, then re-stiffens near the end to shove you back to your feet
    this.sprawlTimer = Math.max(0, this.sprawlTimer - dt);
    const k = this.sprawlTimer > 0.6 ? 24 : this.sprawlTimer > 0 ? 420 : this.uprightK;
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
    const seated = !!(this.atPost || this.seatedAt) && !this.carrying && !this.dragging;
    // seated staff go kinematic, which FREEZES whatever tilt the capsule had
    // when they sat — that's what made the crew look drunk in their chairs.
    // Sitting is always bolt upright; only walkers keep the physics wobble.
    _yawQ.setFromAxisAngle(_up, this.yaw);
    // authored face-down pose during a slip: ramp prone in ~0.25s, hold, ease
    // back up in the last ~0.6s. Overrides the physics tumble so the flail
    // reads clearly rather than a stiff figure tipped on its side.
    const prone = this.sprawlTimer > 0
      ? Math.min(1, (this.slipMax - this.sprawlTimer) / 0.25, this.sprawlTimer / 0.6)
      : 0;
    if (seated) {
      this.mesh.position.set(p.x, p.y - 0.8, p.z);
      this.mesh.quaternion.copy(_yawQ);
    } else if (prone > 0) {
      // face the slide direction, pitched forward onto the belly
      const yaw = this.slipDir ? Math.atan2(this.slipDir.x, this.slipDir.z) : this.yaw;
      _yawQ.setFromAxisAngle(_up, yaw);
      _tiltQ.setFromAxisAngle(_side, prone * 1.5);   // pitch toward face-down
      this.mesh.position.set(p.x, p.y - 0.8 - prone * 0.35, p.z);
      this.mesh.quaternion.copy(_yawQ).multiply(_tiltQ);
    } else {
      this.mesh.position.set(p.x, p.y - 0.8, p.z);
      // The capsule tilts freely (X/Z rotation unlocked) for that HFF list.
      // Un-clamped, a stagger, a drag reaction, or a shove rolls the body so
      // far it reads as "running sideways". Clamp the physics tilt to a gentle
      // list before it reaches the mesh, then face travel with the yaw.
      _tiltQ.set(q.x, q.y, q.z, q.w).normalize();
      const ang = 2 * Math.acos(Math.min(1, Math.abs(_tiltQ.w)));
      const CAP = 0.2; // ~11° — a lean, never a topple
      if (ang > CAP) { _tiltScratch.identity().slerp(_tiltQ, CAP / ang); _tiltQ.copy(_tiltScratch); }
      this.mesh.quaternion.copy(_tiltQ).multiply(_yawQ);
    }
    // gait driven by actual velocity
    const v = this.body.linvel();
    const speed01 = Math.min(1, Math.hypot(v.x, v.z) / SPRINT);
    // only YOUR feet make noise — six sets of staff shoes is just static
    if (this === this.game.active && !seated && this.sprawlTimer <= 0) {
      this.game.audio.footstep(speed01, now);
    }
    animateRig(this.mesh, dt, now, speed01, {
      reach: !!(this.carrying || this.dragging) && this.sprawlTimer <= 0,
      sitting: seated,
      sprawl: prone,
      // desk work: a seated staffer taps at a keyboard instead of freezing
      busy: seated ? (this.seatPhase ??= Math.random() * 6) : 0,
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
      if (this === game.active) game.audio.grab();
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
      if (this === game.active) game.audio.grab();
      game.ui.toast(`Dragging ${bp.sim.displayName}`);
    }
  }

  release() {
    if ((this.carrying || this.dragging) && this === this.game.active) this.game.audio.drop();
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

  // wipe out on a wet floor: legs fly out, you belly-flop and KEEP your
  // momentum — sliding face-down and flailing for a few feet before you push
  // yourself back up. ~3 seconds of undignified.
  slip() {
    if (this.sprawlTimer > 0) return;
    this.sprawlTimer = SLIP_TIME;
    this.slipMax = SLIP_TIME;
    this.game.audio.slip();
    const v = this.body.linvel();
    const spd = Math.hypot(v.x, v.z);
    // slide along the way you were ACTUALLY going (fall back to facing)
    const dx = spd > 0.3 ? v.x / spd : Math.sin(this.yaw);
    const dz = spd > 0.3 ? v.z / spd : Math.cos(this.yaw);
    // SET the launch speed (don't add to it) so a sprint doesn't fling you
    // across the room — a firm belly-slide that floor friction eats over a
    // couple of seconds, carrying you a few feet. Small hop for the flop.
    const slide = Math.min(spd + 1.4, 5.5);
    this.body.setLinvel({ x: dx * slide, y: 1.8, z: dz * slide }, true);
    // tip forward onto the stomach (about the axis across the slide direction)
    this.body.applyTorqueImpulse({ x: dz * 45, y: 10, z: -dx * 45 }, true);
    this.slipDir = { x: dx, z: dz };
    if (this.dragging) this.release(); // you let go of whoever you were towing
  }

  tackle() {
    if (this.tackleTimer > 0) return;
    this.tackleTimer = 0.55;
    this.sprawlTimer = 1.1; // commit to the dive — recover upright after
    this.body.applyImpulse({ x: Math.sin(this.yaw) * 340, y: 60, z: Math.cos(this.yaw) * 340 }, true);
    this.game.audio.tackle();
    this.game.ui.toast('LEEEROY!');
  }
}
const _up = new THREE.Vector3(0, 1, 0);
const _side = new THREE.Vector3(1, 0, 0);
const _yawQ = new THREE.Quaternion();
const _tiltQ = new THREE.Quaternion();
const _tiltScratch = new THREE.Quaternion();
