import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

export async function initPhysics() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  return new Physics(world);
}

export class Physics {
  constructor(world) { this.world = world; }
  step() { this.world.step(); }

  staticBox(x, y, z, hx, hy, hz, friction = 0.8) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction), body);
    return body;
  }

  // Character/patient capsule. tiltWobble=true leaves X/Z rotation free (yaw locked)
  // so an upright-spring can produce the drunken Human-Fall-Flat stagger.
  capsuleBody(x, z, { radius = 0.3, halfHeight = 0.5, mass = 70, tiltWobble = false,
                      linDamp = 0.6, angDamp = 3.0 } = {}) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, halfHeight + radius + 0.05, z)
      .setLinearDamping(linDamp).setAngularDamping(angDamp).setCanSleep(false);
    if (tiltWobble) desc.enabledRotations(true, false, true);
    else desc.lockRotations();
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.capsule(halfHeight, radius)
      .setFriction(0.25).setDensity(mass / (Math.PI * radius * radius * (2 * halfHeight + 4 * radius / 3)));
    this.world.createCollider(col, body);
    return body;
  }

  itemBody(x, y, z, { hx = 0.09, hy = 0.09, hz = 0.09, mass = 0.3 } = {}) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z).setLinearDamping(0.4).setAngularDamping(1.5));
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.7).setDensity(mass / (8 * hx * hy * hz)),
      body);
    return body;
  }
}

// Spring pulling a body toward a target point — the grab/carry/drag mechanic.
// Applied as impulses each fixed tick; items dangle, patients flop. Clamped so
// nothing explodes when yanked through a doorway. Returns the applied impulse
// so the holder can receive the equal-and-opposite reaction (HFF does this —
// it's where the tug-of-war comedy comes from).
export function springToward(body, target, { k, c, maxForce, dt }) {
  const p = body.translation(), v = body.linvel();
  let fx = k * (target.x - p.x) - c * v.x;
  let fy = k * (target.y - p.y) - c * v.y;
  let fz = k * (target.z - p.z) - c * v.z;
  const mag = Math.hypot(fx, fy, fz);
  if (mag > maxForce) { const s = maxForce / mag; fx *= s; fy *= s; fz *= s; }
  const ix = fx * dt, iy = fy * dt, iz = fz * dt;
  body.applyImpulse({ x: ix, y: iy, z: iz }, true);
  return { x: ix, y: iy, z: iz };
}

// Soft upright spring: torque impulse that rights a tilting capsule but lets it
// list, stagger, and faceplant (weaken k briefly for comedy).
export function uprightSpring(body, { k, c, dt }) {
  const q = body.rotation();
  // current up axis = q * (0,1,0)
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.y * q.z + q.w * q.x);
  // torque axis = up_current × up_world(0,1,0) = (-uz, 0, ux) → rights the body
  const tx = -uz, tz = ux;
  const av = body.angvel();
  body.applyTorqueImpulse({
    x: (k * tx - c * av.x) * dt,
    y: (-c * av.y) * dt,
    z: (k * tz - c * av.z) * dt,
  }, true);
  return uy; // caller can check how upright we are
}
