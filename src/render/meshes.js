import * as THREE from 'three';

// Shared material caches (mobile draw-call diet). MeshStandardMaterial +
// emissives, matching the tether rec-room look (warm key light + neon accents).
const matCache = new Map();
export const mat = (color) => {
  if (!matCache.has(color)) {
    matCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.08 }));
  }
  return matCache.get(color);
};
const ematCache = new Map();
export const emat = (color, intensity = 0.8) => {
  const k = `${color}:${intensity}`;
  if (!ematCache.has(k)) {
    ematCache.set(k, new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: intensity, roughness: 0.5,
    }));
  }
  return ematCache.get(k);
};

// radial glow sprite texture (canvas) — for lamp blooms and blob shadows
export const GLOW_TEX = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

export function glowSprite(color, size, opacity) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW_TEX, color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  s.material.fog = false;
  s.scale.set(size, size, 1);
  return s;
}

// ---------- characters (articulated rigs, see rig.js) ----------
import { buildRig, setRigFace } from './rig.js';

// Palettes lifted from the low-poly reference minis: staff in scrub sets with
// their kit (stethoscope / nurse cap / gloves / badge), patients as everyday
// people — skin tones, hair, casual clothes.
const WHITE_SNEAKER = 0xe9ecf1;
const GLOVE = 0x9fc9ec;

const ROLE_RIGS = {
  doctor: { top: 0x3fa79b, bottom: 0x2f8a80, skin: 0xe8c39e, hairColor: 0x6b4a2f, hairStyle: 'short',
    stethoscope: true, gloves: GLOVE, shoes: WHITE_SNEAKER },
  nurse: { top: 0xe89aa4, bottom: 0xdd8894, skin: 0xf0cfae, hairColor: 0x9a4f2e, hairStyle: 'long',
    nurseCap: true, shoes: 0xffffff },
  tech: { top: 0x5fbf7a, bottom: 0x4aa565, skin: 0x8a5a3c, hairColor: 0x50565e, hairStyle: 'short',
    badge: true, shoes: WHITE_SNEAKER },
  aide: { top: 0x8fc3e8, bottom: 0x76abd4, skin: 0xf0cfae, hairColor: 0x9ec464, hairStyle: 'short',
    gloves: GLOVE, shoes: WHITE_SNEAKER },
  porter: { top: 0x5a8fd0, bottom: 0x466fa8, skin: 0xd8a87c, hairColor: 0x3a2e24, hairStyle: 'short',
    shoes: WHITE_SNEAKER },
  surgeon: { top: 0x9e4a56, bottom: 0x7c3944, skin: 0xc98e68, scrubCap: 0x6e3a42,
    gloves: GLOVE, shoes: WHITE_SNEAKER },
  receptionist: { top: 0x8f7fc9, bottom: 0x5f5490, skin: 0xf0cfae, hairColor: 0x5a3c28, hairStyle: 'long',
    shoes: 0x6b5f4c },
};
export function makeCharacterMesh(role) {
  return buildRig(ROLE_RIGS[role] ?? ROLE_RIGS.nurse);
}

// patient wardrobe — sampled straight off the reference's bottom rows
const SKINS = [0xf2d6b8, 0xe8c39e, 0xd8a87c, 0xb07a4e, 0x8a5a3c, 0x6e4428];
const HAIRS = [0x2e2620, 0x4a3626, 0x6b4a2f, 0x9a4f2e, 0xd8b86a, 0x9aa0a8, 0xdfe2e6];
const TOPS = [0xb083c9, 0xc96a52, 0x6fbf6f, 0x9a8fc9, 0x8fb3d8, 0xd8cbb0, 0xe0b0b8, 0x7a9c6b, 0x88b6c9];
const BOTTOMS = [0x4a6a9c, 0x39598c, 0x6e5a44, 0x8a7a5c, 0x3c4658, 0x7a5c88];
const SHOES = [0x4a4038, 0x2e3440, 0x8a8f98, 0xe8eaee];

export function makePatientMesh(rng, opts = {}) {
  const skin = rng.pick(SKINS);
  const r = rng.next();
  const hairStyle = r < 0.5 ? 'short' : r < 0.82 ? 'long' : 'bald';
  const g = buildRig({
    top: rng.pick(TOPS), bottom: rng.pick(BOTTOMS), skin,
    hairColor: rng.pick(HAIRS), hairStyle,
    shoes: rng.pick(SHOES),
    bandage: !!opts.bandage,
  });
  g.userData.skin = skin;
  return g;
}

export function setFace(patientMesh, face) {
  setRigFace(patientMesh, face === 'angry' ? 0xff5348 : face === 'dead' ? 0x9aa3b0 :
    face === 'crit' ? 0xc4cede : (patientMesh.userData.skin ?? 0xe8c39e));
}

// ---------- props ----------
export function makeBed(accent = 0x76a9ea) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 2.1), mat(0xe8ecf4));
  frame.position.y = 0.25; frame.castShadow = true;
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.12, 1.3), mat(accent));
  blanket.position.set(0, 0.56, 0.3);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.4), mat(0xffffff));
  pillow.position.set(0, 0.56, -0.75);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.05, 0.05), mat(0xb9c2d4));
  rail.position.set(0, 0.55, -1.02);
  g.add(frame, blanket, pillow, rail);
  return g;
}

export function makeChair() {
  // beige waiting-room chair, HFF-hospital style
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.6), mat(0xcbbfa4));
  seat.position.y = 0.42;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.58, 0.1), mat(0xcbbfa4));
  back.position.set(0, 0.76, 0.27);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.4, 0.5), mat(0x6b5f4c));
  legs.position.y = 0.2;
  g.add(seat, back, legs);
  return g;
}

export function makeCentrifuge() {
  const g = new THREE.Group();
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.0), mat(0xccd4e0));
  table.position.y = 0.4; table.castShadow = true;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.4, 14), mat(0x8892aa));
  drum.position.y = 1.0;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.06, 14), mat(0x4a5a7a));
  lid.position.y = 1.23;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), emat(0x36e0d6, 1.2));
  lamp.position.set(0.3, 1.28, 0.3);
  g.add(table, drum, lid, lamp, glowSprite(0x36e0d6, 1.4, 0.35));
  g.children[g.children.length - 1].position.set(0.3, 1.3, 0.3);
  g.userData = { drum, lid };
  return g;
}

export function makeScanner() {
  const g = new THREE.Group();
  const bedS = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 2.6), mat(0xe0e4ee));
  bedS.position.y = 0.2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.22, 10, 22), mat(0xf5f7fb));
  ring.position.set(0, 1.0, -0.5); ring.castShadow = true;
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.05, 8, 22), emat(0xb083ff, 1.1));
  eye.position.set(0, 1.0, -0.38);
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 1.0), mat(0xb9c2d4));
  base.position.set(0, 0.1, -0.5);
  g.add(bedS, ring, eye, base);
  return g;
}

export function makeShelf(bandColor) {
  const g = new THREE.Group();
  const unit = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 0.6), mat(0xd9dfe9));
  unit.position.y = 0.5; unit.castShadow = true;
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.62), emat(bandColor, 0.55));
  band.position.y = 1.02;
  // little med boxes painted on: three emissive pill drawers
  for (let i = 0; i < 3; i++) {
    const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.5, 0.06), mat(0xf2f6fb));
    drawer.position.set(-0.8 + i * 0.8, 0.55, 0.31);
    g.add(drawer);
  }
  g.add(unit, band);
  return g;
}

export function makeDesk() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 1.1), mat(0x9fb4d8));
  top.position.y = 0.45; top.castShadow = true;
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.05), emat(0x6effe6, 0.7));
  screen.position.set(-0.8, 1.12, 0);
  g.add(top, screen);
  return g;
}

// ---------- items ----------
const itemGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const vialGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.24, 8);
const paperGeo = new THREE.BoxGeometry(0.26, 0.02, 0.34);

export function makeItemMesh(kind, color, size) {
  if (kind === 'vial') return new THREE.Mesh(vialGeo, mat(0xb02030));
  if (kind === 'paper') return new THREE.Mesh(paperGeo, mat(0xf6f2e6));
  if (kind === 'prop' && size) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size.hx * 2, size.hy * 2, size.hz * 2), mat(color ?? 0xcccccc));
    m.castShadow = true;
    return m;
  }
  const m = new THREE.Mesh(itemGeo, mat(color ?? 0xcccccc));
  m.castShadow = true;
  return m;
}
