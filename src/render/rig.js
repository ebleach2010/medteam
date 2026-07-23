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

// palette (matches the low-poly reference minis):
// { top, bottom, skin, hairColor?, hairStyle?: 'short'|'long'|'bald',
//   nurseCap?, scrubCap?, gloves?, stethoscope?, badge?, shoes?, bandage? }
export function buildRig(p) {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(0.95);
  root.add(inner);
  const bob = new THREE.Group();
  inner.add(bob);

  const topM = mat(p.top), botM = mat(p.bottom), skinM = mat(p.skin);

  const torso = new THREE.Group(); bob.add(torso);
  const chest = new THREE.Group(); torso.add(chest);

  // two-part body with a waistline: pants/hips below, shirt above
  const lathe = (pts, m) => {
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), 18), m);
    mesh.castShadow = true;
    return mesh;
  };
  const hips = lathe([[0.02, 0.27], [0.26, 0.32], [0.38, 0.52], [0.42, 0.78]], botM);
  const shirt = lathe([[0.42, 0.74], [0.41, 0.92], [0.33, 1.06], [0.16, 1.14], [0.02, 1.16]], topM);
  chest.add(hips, shirt);

  // faceless skin-toned head set into the shoulders
  const head = new THREE.Group(); head.position.y = 1.40; chest.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 14), skinM);
  skull.scale.set(1, 1.18, 0.96);
  skull.castShadow = true;
  head.add(skull);

  // hair, like the minis: a low-poly cap / bob / balding fringe
  if (p.hairColor != null && p.hairStyle !== 'none') {
    const hairM = mat(p.hairColor);
    if (p.hairStyle === 'bald') {
      const fringe = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.06, 6, 12, Math.PI * 1.3), hairM);
      fringe.rotation.x = Math.PI / 2;
      fringe.rotation.z = Math.PI * 0.85; // gap at the front — shiny up top
      fringe.position.y = 0.02;
      head.add(fringe);
    } else {
      const capH = new THREE.Mesh(new THREE.SphereGeometry(0.295, 14, 8, 0, TAU, 0, Math.PI * 0.52), hairM);
      capH.position.set(0, 0.045, -0.02);
      head.add(capH);
      if (p.hairStyle === 'long') {
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.13), hairM);
        back.position.set(0, -0.10, -0.20);
        head.add(back);
      }
    }
  }
  if (p.nurseCap) { // white cap with the little red cross
    const capN = new THREE.Mesh(new THREE.SphereGeometry(0.20, 12, 6, 0, TAU, 0, Math.PI * 0.45), mat(0xffffff));
    capN.position.set(0, 0.20, 0.02);
    capN.scale.set(1.15, 0.9, 1.15);
    const cr1 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.012), mat(0xd23b3b));
    const cr2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.012), mat(0xd23b3b));
    cr1.position.set(0, 0.28, 0.19); cr2.position.set(0, 0.28, 0.19);
    head.add(capN, cr1, cr2);
  }
  if (p.scrubCap) { // surgeon's dome
    const capS = new THREE.Mesh(new THREE.SphereGeometry(0.30, 14, 8, 0, TAU, 0, Math.PI * 0.42), mat(p.scrubCap));
    capS.position.y = 0.06;
    head.add(capS);
  }
  if (p.bandage) { // head-injury wrap
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.07, 6, 14), mat(0xf2efe6));
    wrap.rotation.x = Math.PI / 2;
    wrap.position.y = 0.08;
    head.add(wrap);
  }

  // accessories on the chest
  if (p.stethoscope) {
    const tube = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.032, 6, 14, Math.PI * 1.3), mat(0x2b3440));
    tube.rotation.z = Math.PI * 0.85; // drapes around the neck, open at the top
    tube.position.set(0, 1.10, 0.30);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.025, 10), mat(0x8a94a4));
    bell.rotation.x = Math.PI / 2;
    bell.position.set(0.13, 0.94, 0.36);
    chest.add(tube, bell);
  }
  if (p.badge) {
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.02), mat(0xf2efe6));
    badge.position.set(0.16, 1.0, 0.33);
    badge.rotation.x = -0.15;
    chest.add(badge);
  }

  // arms: sleeve in shirt color, hands in skin (or exam gloves)
  const handM = mat(p.gloves ?? p.skin);
  const shoeM = mat(p.shoes ?? 0x4a4038);
  const armL = limb(0.52, 0.13, 0.10, topM, handM); armL.position.set(-0.40, 0.98, 0); chest.add(armL);
  const armR = limb(0.52, 0.13, 0.10, topM, handM); armR.position.set(0.40, 0.98, 0); chest.add(armR);
  const legL = limb(0.36, 0.16, 0.13, botM, shoeM); legL.position.set(-0.18, 0.40, 0); chest.add(legL);
  const legR = limb(0.36, 0.16, 0.13, botM, shoeM); legR.position.set(0.18, 0.40, 0); chest.add(legR);

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
