// Articulated character rig + gait, ported from tether's rec-room astronaut:
// cylinder torso with sphere caps, pivot-at-top swinging limbs, gloves, boots,
// breathing chest, forward lean with speed, and a soft blob shadow. Reskinned
// here as scrubs / white coats / hospital gowns.
import * as THREE from 'three';
import { mat, GLOW_TEX } from './meshes.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

function limb(len, rTop, rBot, material) {
  const pivot = new THREE.Group();
  const seg = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 10), material);
  seg.position.y = -len / 2;
  seg.castShadow = true;
  pivot.add(seg);
  return pivot;
}

// palette: { suit, shade, accent, skin, hair, cap? , badge? }
export function buildRig(p) {
  const root = new THREE.Group();
  const inner = new THREE.Group();       // scaled body (feet at y=0)
  inner.scale.setScalar(0.8);
  root.add(inner);
  const bob = new THREE.Group();
  inner.add(bob);

  const suit = mat(p.suit), shade = mat(p.shade), accent = mat(p.accent), skin = mat(p.skin);

  const torso = new THREE.Group(); torso.position.y = 1.02; bob.add(torso);
  const chest = new THREE.Group(); torso.add(chest);
  const torsoMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.40, 0.78, 14), suit);
  torsoMesh.position.y = 0.05; torsoMesh.castShadow = true; chest.add(torsoMesh);
  const capUp = new THREE.Mesh(new THREE.SphereGeometry(0.40, 14, 12), suit);
  capUp.position.y = 0.44; chest.add(capUp);
  const capDn = new THREE.Mesh(new THREE.SphereGeometry(0.40, 14, 10), shade);
  capDn.position.y = -0.32; chest.add(capDn);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.055, 8, 18), accent);
  collar.rotation.x = Math.PI / 2; collar.position.y = 0.5; chest.add(collar);
  if (p.badge) {
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12),
      new THREE.MeshBasicMaterial({ color: p.badge }));
    badge.position.set(0.14, 0.2, 0.395); chest.add(badge);
  }

  // head: skin sphere + hair/scrub cap
  const head = new THREE.Group(); head.position.y = 0.62; chest.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 16), skin);
  skull.castShadow = true; head.add(skull);
  if (p.cap) { // scrub cap: flattened dome
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.355, 16, 8, 0, TAU, 0, Math.PI * 0.42), mat(p.cap));
    cap.position.y = 0.03; head.add(cap);
  } else {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.352, 16, 8, 0, TAU, 0, Math.PI * 0.5), mat(p.hair));
    hair.position.y = 0.015; hair.rotation.x = -0.25; head.add(hair);
  }
  // simple face: two dark eyes so facing direction reads
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), mat(0x1b2233));
    eye.position.set(0.12 * s, 0.04, 0.31); head.add(eye);
  }

  const armL = limb(0.74, 0.12, 0.10, suit); armL.position.set(-0.44, 0.42, 0); chest.add(armL);
  const armR = limb(0.74, 0.12, 0.10, suit); armR.position.set(0.44, 0.42, 0); chest.add(armR);
  for (const a of [armL, armR]) {
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), skin);
    glove.position.y = -0.78; a.add(glove);
  }
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), suit);
    cap.position.set(0.44 * s, 0.42, 0); chest.add(cap);
  }

  const legL = limb(0.78, 0.14, 0.12, shade); legL.position.set(-0.20, -0.30, 0); chest.add(legL);
  const legR = limb(0.78, 0.14, 0.12, shade); legR.position.set(0.20, -0.30, 0); chest.add(legR);
  const bootGeo = new THREE.BoxGeometry(0.22, 0.15, 0.33);
  for (const l of [legL, legR]) {
    const boot = new THREE.Mesh(bootGeo, mat(0x3a3550));
    boot.position.set(0, -0.80, 0.06); l.add(boot);
  }

  // soft blob shadow grounds the character
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({ map: GLOW_TEX, color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02; inner.add(blob);

  root.userData.rig = {
    bob, torso, chest, head, skull, armL, armR, legL, legR,
    walkClock: 0, skinColor: p.skin,
  };
  return root;
}

// Gait + poses, straight from the rec room: cadence/stride/lean scale with
// speed, arms counter-swing legs, chest breathes, idle keeps a tiny sway.
export function animateRig(root, dt, now, speed01, { reach = false, lying = false, dead = false } = {}) {
  const r = root.userData.rig;
  const cadence = lerp(0.9, 3.4, speed01);
  r.walkClock += cadence * TAU * dt;
  const stride = lying ? 0 : lerp(0, 0.95, speed01);
  const armSwing = lying ? 0 : lerp(0.08, 1.05, speed01);
  const lean = lying ? 0 : lerp(0, 0.26, speed01);
  const bobAmt = lying ? 0 : lerp(0, 0.13, speed01);

  const breathe = dead ? 0 : Math.sin(now * 1.6) * 0.018;
  r.chest.scale.set(1, 1 + breathe, 1);
  r.bob.position.y = Math.abs(Math.sin(r.walkClock)) * bobAmt + breathe * 0.55;
  r.torso.rotation.x = lean;
  r.head.rotation.x = -lean * 0.6;

  r.legL.rotation.x = Math.sin(r.walkClock) * stride;
  r.legR.rotation.x = Math.sin(r.walkClock + Math.PI) * stride;
  const idleSway = Math.sin(now * 1.3) * 0.08 * (1 - speed01);
  let aL = Math.sin(r.walkClock + Math.PI) * armSwing + idleSway;
  let aR = Math.sin(r.walkClock) * armSwing - idleSway;
  if (reach) { aL = aR = -1.25; }                       // arms out toward what you hold
  if (lying) { aL = aR = dead ? -0.9 : -0.25; }         // flopped / folded
  r.armL.rotation.x += (aL - r.armL.rotation.x) * 0.35;
  r.armR.rotation.x += (aR - r.armR.rotation.x) * 0.35;
  r.armL.rotation.z = lerp(0.06, 0.22, speed01);
  r.armR.rotation.z = -lerp(0.06, 0.22, speed01);
}

export function setRigFace(root, color) {
  root.userData.rig.skull.material = mat(color);
}
