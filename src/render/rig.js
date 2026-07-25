// Human-Fall-Flat-style blob rig: a lathe-turned body with rounded shoulders
// and hips, a soft neck into a big faceless egg head, and JOINTED arms + legs
// (shoulder/elbow, hip/knee) so the figure reads as one cohesive body and can
// actually sit in a chair. The head tint IS the face (red = furious, gray = dead).
import * as THREE from 'three';
import { mat, GLOW_TEX } from './meshes.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

// two-segment limb: pivot (shoulder/hip, with a rounding ball) → upper → joint
// (elbow/knee ball) → lower → rounded tip (hand/foot). Returns both pivots so
// the animator can pose the joint.
function makeLimb(uLen, lLen, r0, r1, r2, m, tipM) {
  const pivot = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(r0 * 1.28, 12, 10), m);
  ball.castShadow = true;
  pivot.add(ball);
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, uLen, 12), m);
  upper.position.y = -uLen / 2; upper.castShadow = true;
  pivot.add(upper);
  const joint = new THREE.Group(); joint.position.y = -uLen; pivot.add(joint);
  const knee = new THREE.Mesh(new THREE.SphereGeometry(r1 * 1.12, 10, 8), m);
  joint.add(knee);
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, lLen, 12), m);
  lower.position.y = -lLen / 2; lower.castShadow = true;
  joint.add(lower);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(r2 * 1.25, 10, 10), tipM ?? m);
  tip.position.y = -lLen - r2 * 0.25;
  joint.add(tip);
  return { pivot, joint };
}

// palette (matches the low-poly reference minis):
// { top, bottom, skin, hairColor?, hairStyle?: 'short'|'long'|'bald',
//   nurseCap?, scrubCap?, gloves?, stethoscope?, badge?, shoes?, bandage? }
export function buildRig(p) {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(0.8);
  root.add(inner);
  const bob = new THREE.Group();
  inner.add(bob);

  const topM = mat(p.top), botM = mat(p.bottom), skinM = mat(p.skin);

  const torso = new THREE.Group(); bob.add(torso);
  const chest = new THREE.Group(); torso.add(chest);

  const lathe = (pts, m) => {
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), 20), m);
    mesh.castShadow = true;
    return mesh;
  };
  // rounded body: hips swell out then in, shirt rises into sloped shoulders
  const hips = lathe([[0.02, 0.24], [0.18, 0.29], [0.26, 0.5], [0.28, 0.74], [0.26, 0.82]], botM);
  const shirt = lathe([[0.26, 0.8], [0.30, 0.96], [0.32, 1.06], [0.28, 1.16], [0.17, 1.24], [0.05, 1.27]], topM);
  chest.add(hips, shirt);

  // soft neck bridging the shoulders and the head (no floating gap)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.14, 12), skinM);
  neck.position.y = 1.28; chest.add(neck);

  // faceless skin-toned head
  const head = new THREE.Group(); head.position.y = 1.5; chest.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.29, 20, 16), skinM);
  skull.scale.set(1, 1.16, 0.98);
  skull.castShadow = true;
  head.add(skull);

  // hair — low-poly cap / bob / balding fringe
  if (p.hairColor != null && p.hairStyle !== 'none') {
    const hairM = mat(p.hairColor);
    if (p.hairStyle === 'bald') {
      const fringe = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.06, 6, 14, Math.PI * 1.3), hairM);
      fringe.rotation.x = Math.PI / 2;
      fringe.rotation.z = Math.PI * 0.85;
      fringe.position.y = 0.02;
      head.add(fringe);
    } else {
      const capH = new THREE.Mesh(new THREE.SphereGeometry(0.305, 16, 10, 0, TAU, 0, Math.PI * 0.54), hairM);
      capH.position.set(0, 0.04, -0.02);
      head.add(capH);
      if (p.hairStyle === 'long') {
        const back = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10, 0, TAU, Math.PI * 0.35, Math.PI * 0.5), hairM);
        back.position.set(0, -0.02, -0.06);
        back.scale.set(1, 1.2, 1.1);
        head.add(back);
      }
    }
  }
  if (p.nurseCap) {
    const capN = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 8, 0, TAU, 0, Math.PI * 0.45), mat(0xffffff));
    capN.position.set(0, 0.2, 0.02);
    capN.scale.set(1.12, 0.92, 1.12);
    const cr1 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.012), mat(0xd23b3b));
    const cr2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.012), mat(0xd23b3b));
    cr1.position.set(0, 0.3, 0.2); cr2.position.set(0, 0.3, 0.2);
    head.add(capN, cr1, cr2);
  }
  if (p.scrubCap) {
    const capS = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 10, 0, TAU, 0, Math.PI * 0.44), mat(p.scrubCap));
    capS.position.y = 0.05;
    head.add(capS);
  }
  if (p.bandage) {
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 6, 16), mat(0xf2efe6));
    wrap.rotation.x = Math.PI / 2;
    wrap.position.y = 0.08;
    head.add(wrap);
  }

  if (p.stethoscope) {
    const tube = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.028, 6, 16, Math.PI * 1.3), mat(0x2b3440));
    tube.rotation.z = Math.PI * 0.85;
    tube.position.set(0, 1.18, 0.22);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.022, 10), mat(0x8a94a4));
    bell.rotation.x = Math.PI / 2;
    bell.position.set(0.1, 1.0, 0.27);
    chest.add(tube, bell);
  }
  if (p.badge) {
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.02), mat(0xf2efe6));
    badge.position.set(0.13, 1.06, 0.26);
    badge.rotation.x = -0.15;
    chest.add(badge);
  }

  // jointed limbs — sleeves/pants in cloth colour, hands/feet in skin/shoe
  const handM = mat(p.gloves ?? p.skin);
  const shoeM = mat(p.shoes ?? 0x4a4038);
  const armL = makeLimb(0.30, 0.28, 0.095, 0.072, 0.062, topM, handM);
  const armR = makeLimb(0.30, 0.28, 0.095, 0.072, 0.062, topM, handM);
  armL.pivot.position.set(-0.30, 1.12, 0); armR.pivot.position.set(0.30, 1.12, 0);
  const legL = makeLimb(0.30, 0.28, 0.12, 0.095, 0.082, botM, shoeM);
  const legR = makeLimb(0.30, 0.28, 0.12, 0.095, 0.082, botM, shoeM);
  legL.pivot.position.set(-0.135, 0.66, 0); legR.pivot.position.set(0.135, 0.66, 0);
  chest.add(armL.pivot, armR.pivot, legL.pivot, legR.pivot);

  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2),
    new THREE.MeshBasicMaterial({ map: GLOW_TEX, color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  inner.add(blob);

  root.userData.rig = {
    bob, torso, chest, head, skull, armL, armR, legL, legR,
    walkClock: 0, grabPulse: 0,
  };
  return root;
}

// smooth a pivot's x-rotation toward a target
function easeX(node, target, k = 0.35) { node.rotation.x += (target - node.rotation.x) * k; }

// Gait + poses. speed01 drives cadence/stride/lean; `reach` = sticky HFF arms
// up-and-forward; `sitting` = butt-on-chair pose; `lying` = bed/floor.
export function animateRig(root, dt, now, speed01, { reach = false, lying = false, dead = false, sitting = false, dragged = false, sprawl = 0, busy = 0 } = {}) {
  const r = root.userData.rig;
  const cadence = lerp(0.9, 3.4, speed01);
  r.walkClock += cadence * TAU * dt;
  const still = lying || sitting || sprawl > 0;
  const stride = still ? 0 : lerp(0, 0.95, speed01);
  const armSwing = still ? 0 : lerp(0.08, 1.0, speed01);
  const lean = still ? 0 : lerp(0, 0.22, speed01);
  const bobAmt = still ? 0 : lerp(0, 0.1, speed01);

  const breathe = dead ? 0 : Math.sin(now * 1.6) * 0.02;
  r.chest.scale.set(1, 1 + breathe, 1);
  let bobY = Math.abs(Math.sin(r.walkClock)) * bobAmt + breathe * 0.5;
  if (sitting) bobY = -0.46;                    // drop the hips to seat height
  r.bob.position.y = bobY;
  r.torso.rotation.x = sitting ? 0.12 : lean;
  r.head.rotation.x = sitting ? -0.06 : -lean * 0.6;

  // ---- legs ----
  const swL = Math.sin(r.walkClock) * stride;
  const swR = Math.sin(r.walkClock + Math.PI) * stride;
  if (sitting) {
    // thighs forward (horizontal), shins straight down → seated L
    easeX(r.legL.pivot, 1.5); easeX(r.legR.pivot, 1.5);
    easeX(r.legL.joint, -1.5); easeX(r.legR.joint, -1.5);
  } else if (sprawl > 0) {
    // face-down on the floor, legs kicking to get back up
    const k = now * 11;
    easeX(r.legL.pivot, 0.15 + Math.sin(k) * 0.5 * sprawl, 0.4);
    easeX(r.legR.pivot, 0.15 + Math.sin(k + 1.7) * 0.5 * sprawl, 0.4);
    easeX(r.legL.joint, -0.3 - Math.max(0, Math.sin(k)) * 0.6 * sprawl, 0.4);
    easeX(r.legR.joint, -0.3 - Math.max(0, Math.sin(k + 1.7)) * 0.6 * sprawl, 0.4);
  } else if (lying) {
    easeX(r.legL.pivot, 0.02); easeX(r.legR.pivot, 0.02);
    easeX(r.legL.joint, dead ? 0.35 : 0.05); easeX(r.legR.joint, dead ? -0.2 : 0.05);
  } else {
    easeX(r.legL.pivot, swL, 0.5); easeX(r.legR.pivot, swR, 0.5);
    // knee flexes as the leg swings back (natural gait), stays near-straight otherwise
    easeX(r.legL.joint, -Math.max(0, -swL) * 0.9 - 0.05, 0.5);
    easeX(r.legR.joint, -Math.max(0, -swR) * 0.9 - 0.05, 0.5);
  }

  // ---- arms ----
  const idleSway = Math.sin(now * 1.3) * 0.06 * (1 - speed01);
  let aL = Math.sin(r.walkClock + Math.PI) * armSwing + idleSway;
  let aR = Math.sin(r.walkClock) * armSwing - idleSway;
  let elbow = -0.15; // slight resting bend
  if (sitting) {
    // hands up on the desk, typing away — plus a slow shift in the seat, so a
    // staffed station reads as ALIVE instead of a row of mannequins
    const k = now * 2.6 + busy;
    aL = -0.95 + Math.sin(k) * 0.07;
    aR = -0.95 + Math.sin(k + 1.7) * 0.07;
    elbow = -1.05 + Math.sin(k * 1.3) * 0.06;
    r.torso.rotation.y = Math.sin(now * 0.5 + busy) * 0.09;   // idle swivel
    r.head.rotation.y = Math.sin(now * 0.37 + busy * 1.3) * 0.22; // glances around
  } else {
    r.torso.rotation.y = 0;
    r.head.rotation.y = 0;
  }
  if (lying) { aL = aR = dead ? -0.9 : -0.25; elbow = -0.1; }
  if (sprawl > 0) {
    // arms thrash overhead, pushing at the floor — the flail
    const k = now * 12;
    aL = -1.2 + Math.sin(k) * 0.9 * sprawl;
    aR = -1.2 + Math.sin(k + 2.1) * 0.9 * sprawl;
    elbow = -0.5 - Math.abs(Math.sin(k * 1.3)) * 0.6 * sprawl;
  }
  if (dragged) { aL = Math.sin(now * 8) * 0.7 - 0.6; aR = Math.sin(now * 8 + 2.1) * 0.7 - 0.6; elbow = -0.6; }
  if (reach) { aL = aR = -1.5; elbow = -0.7; }           // sticky hands up and out, elbows bent
  easeX(r.armL.pivot, aL); easeX(r.armR.pivot, aR);
  easeX(r.armL.joint, elbow); easeX(r.armR.joint, elbow);
  const splay = reach ? 0.3 : lerp(0.12, 0.24, speed01);
  r.armL.pivot.rotation.z += (splay - r.armL.pivot.rotation.z) * 0.3;
  r.armR.pivot.rotation.z += (-splay - r.armR.pivot.rotation.z) * 0.3;
}

export function setRigFace(root, color) {
  root.userData.rig.skull.material = mat(color);
}
