// Human-Fall-Flat-style blob rig: a lathe-turned body where the shoulders
// merge into a huge faceless egg head, stubby rounded limbs, sticky-reach
// arms, and a soft blob shadow. No neck, no face — the head tint IS the face
// (red = furious, gray = dead).
import * as THREE from 'three';
import { mat, GLOW_TEX } from './meshes.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

function limb(len, rTop, rBot, material, footMat) {
  const pivot = new THREE.Group();
  const seg = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 10), material);
  seg.position.y = -len / 2;
  seg.castShadow = true;
  pivot.add(seg);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(rBot * 1.15, 10, 10), footMat ?? material);
  tip.position.y = -len - rBot * 0.35;
  pivot.add(tip);
  return pivot;
}

// palette: { suit, shade, head, cap?, collar? }
export function buildRig(p) {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(0.95);
  root.add(inner);
  const bob = new THREE.Group();
  inner.add(bob);

  const suit = mat(p.suit), shade = mat(p.shade);

  const torso = new THREE.Group(); bob.add(torso);
  const chest = new THREE.Group(); torso.add(chest);

  // the blob body: lathe profile from crotch to closed shoulders
  const profile = [
    new THREE.Vector2(0.02, 0.30), new THREE.Vector2(0.24, 0.33),
    new THREE.Vector2(0.38, 0.52), new THREE.Vector2(0.43, 0.74),
    new THREE.Vector2(0.41, 0.92), new THREE.Vector2(0.33, 1.06),
    new THREE.Vector2(0.16, 1.14), new THREE.Vector2(0.02, 1.16),
  ];
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 20), suit);
  body.castShadow = true;
  chest.add(body);
  if (p.collar) {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 8, 18), mat(p.collar));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.06;
    chest.add(collar);
  }

  // huge faceless egg head, sunk straight into the shoulders
  const head = new THREE.Group(); head.position.y = 1.38; chest.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 18), mat(p.head));
  skull.scale.set(1, 1.12, 1);
  skull.castShadow = true;
  head.add(skull);
  if (p.cap) { // scrub cap dome
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8, 0, TAU, 0, Math.PI * 0.4), mat(p.cap));
    cap.position.y = 0.06;
    cap.scale.set(1, 1.05, 1);
    head.add(cap);
  }

  const armL = limb(0.52, 0.13, 0.10, suit); armL.position.set(-0.40, 0.98, 0); chest.add(armL);
  const armR = limb(0.52, 0.13, 0.10, suit); armR.position.set(0.40, 0.98, 0); chest.add(armR);
  const legL = limb(0.36, 0.16, 0.13, shade); legL.position.set(-0.18, 0.40, 0); chest.add(legL);
  const legR = limb(0.36, 0.16, 0.13, shade); legR.position.set(0.18, 0.40, 0); chest.add(legR);

  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6),
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

// Gait + poses. speed01 drives cadence/stride/lean; `reach` = sticky HFF arms
// up-and-forward; `sitting` = waiting-room chair pose; `lying` = bed/floor.
export function animateRig(root, dt, now, speed01, { reach = false, lying = false, dead = false, sitting = false, dragged = false } = {}) {
  const r = root.userData.rig;
  const cadence = lerp(0.9, 3.4, speed01);
  r.walkClock += cadence * TAU * dt;
  const still = lying || sitting;
  const stride = still ? 0 : lerp(0, 1.0, speed01);
  const armSwing = still ? 0 : lerp(0.08, 1.05, speed01);
  const lean = still ? 0 : lerp(0, 0.24, speed01);
  const bobAmt = still ? 0 : lerp(0, 0.11, speed01);

  const breathe = dead ? 0 : Math.sin(now * 1.6) * 0.02;
  r.chest.scale.set(1, 1 + breathe, 1);
  let bobY = Math.abs(Math.sin(r.walkClock)) * bobAmt + breathe * 0.5;
  if (sitting) bobY = -0.26;
  r.bob.position.y = bobY;
  r.torso.rotation.x = sitting ? 0.08 : lean;
  r.head.rotation.x = -lean * 0.6;

  let lL = Math.sin(r.walkClock) * stride;
  let lR = Math.sin(r.walkClock + Math.PI) * stride;
  if (sitting) { const k = now * 1.4; lL = -1.45 + Math.sin(k) * 0.08; lR = -1.45 + Math.sin(k + Math.PI) * 0.08; }
  r.legL.rotation.x = lL;
  r.legR.rotation.x = lR;

  const idleSway = Math.sin(now * 1.3) * 0.08 * (1 - speed01);
  let aL = Math.sin(r.walkClock + Math.PI) * armSwing + idleSway;
  let aR = Math.sin(r.walkClock) * armSwing - idleSway;
  if (sitting) { aL = aR = -0.4; }
  if (lying) { aL = aR = dead ? -0.9 : -0.25; }
  if (dragged) { aL = Math.sin(now * 8) * 0.9 - 0.5; aR = Math.sin(now * 8 + 2.1) * 0.9 - 0.5; } // flail
  if (reach) { aL = aR = -1.55; }                    // HFF sticky hands, up and out
  r.armL.rotation.x += (aL - r.armL.rotation.x) * 0.35;
  r.armR.rotation.x += (aR - r.armR.rotation.x) * 0.35;
  const splay = reach ? 0.32 : lerp(0.08, 0.22, speed01);
  r.armL.rotation.z += (splay - r.armL.rotation.z) * 0.3;
  r.armR.rotation.z += (-splay - r.armR.rotation.z) * 0.3;
}

export function setRigFace(root, color) {
  root.userData.rig.skull.material = mat(color);
}
