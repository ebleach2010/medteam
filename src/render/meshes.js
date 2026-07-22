import * as THREE from 'three';

// Shared low-poly geometry + a small flat-color material cache (mobile draw-call diet).
const matCache = new Map();
export const mat = (color) => {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
};

const capGeo = new THREE.CapsuleGeometry(0.3, 1.0, 3, 8);
const headGeo = new THREE.SphereGeometry(0.24, 10, 8);
const armGeo = new THREE.BoxGeometry(0.12, 0.5, 0.12);
const itemGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const vialGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.24, 8);
const paperGeo = new THREE.BoxGeometry(0.26, 0.02, 0.34);

const SKINS = [0xffd9b3, 0xe8b88a, 0xc68e5e, 0x9c6b43, 0x7a4f2e];
const GOWNS = [0x9db5e6, 0xa6d8c6, 0xe6c39d, 0xd3a6e6, 0xe6a6a6];

export function makeCharacterMesh(role) {
  const g = new THREE.Group();
  const bodyColor = role === 'nurse' ? 0x2fb59e : 0xf2f2f7;
  const body = new THREE.Mesh(capGeo, mat(bodyColor));
  body.position.y = 0.8;
  const head = new THREE.Mesh(headGeo, mat(0xffd9b3));
  head.position.y = 1.62;
  const hat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.3),
    mat(role === 'nurse' ? 0xffffff : 0x3a4a6b));
  hat.position.y = 1.82;
  const armL = new THREE.Mesh(armGeo, mat(bodyColor)); armL.position.set(-0.42, 0.95, 0);
  const armR = new THREE.Mesh(armGeo, mat(bodyColor)); armR.position.set(0.42, 0.95, 0);
  g.add(body, head, hat, armL, armR);
  g.userData = { armL, armR, head };
  return g;
}

export function makePatientMesh(rng) {
  const g = new THREE.Group();
  const skin = rng.pick(SKINS), gown = rng.pick(GOWNS);
  const body = new THREE.Mesh(capGeo, mat(gown)); body.position.y = 0.8;
  const head = new THREE.Mesh(headGeo, mat(skin)); head.position.y = 1.62;
  const armL = new THREE.Mesh(armGeo, mat(skin)); armL.position.set(-0.42, 0.95, 0);
  const armR = new THREE.Mesh(armGeo, mat(skin)); armR.position.set(0.42, 0.95, 0);
  g.add(body, head, armL, armR);
  g.userData = { head, skin, body };
  return g;
}

export function setFace(patientMesh, face) {
  const u = patientMesh.userData;
  u.head.material = mat(face === 'angry' ? 0xff4646 : face === 'dead' ? 0x8f9aa8 :
    face === 'crit' ? 0xb8c4de : u.skin);
}

export function makeItemMesh(kind, color) {
  if (kind === 'vial') {
    const m = new THREE.Mesh(vialGeo, new THREE.MeshLambertMaterial({ color: 0xb02030 }));
    return m;
  }
  if (kind === 'paper') return new THREE.Mesh(paperGeo, mat(0xf6f2e6));
  return new THREE.Mesh(itemGeo, mat(color ?? 0xcccccc)); // med box
}

// ------- props -------
export function makeBed(accent = 0x76a9ea) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 2.1), mat(0xe8ecf4));
  frame.position.y = 0.25;
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.12, 1.3), mat(accent));
  blanket.position.set(0, 0.56, 0.3);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.4), mat(0xffffff));
  pillow.position.set(0, 0.56, -0.75);
  g.add(frame, blanket, pillow);
  return g;
}

export function makeChair() {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), mat(0x5a79b8));
  seat.position.y = 0.4;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 0.08), mat(0x5a79b8));
  back.position.set(0, 0.72, 0.26);
  g.add(seat, back);
  return g;
}

export function makeCentrifuge() {
  const g = new THREE.Group();
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.0), mat(0xccd4e0));
  table.position.y = 0.4;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.4, 12), mat(0x8892aa));
  drum.position.y = 1.0;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.06, 12), mat(0x4a5a7a));
  lid.position.y = 1.23;
  g.add(table, drum, lid);
  g.userData = { drum, lid };
  return g;
}

export function makeScanner() {
  const g = new THREE.Group();
  const bedS = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 2.6), mat(0xe0e4ee));
  bedS.position.y = 0.2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.22, 8, 20), mat(0xf5f7fb));
  ring.position.set(0, 1.0, -0.5);
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 1.0), mat(0xb9c2d4));
  base.position.set(0, 0.1, -0.5);
  g.add(bedS, ring, base);
  return g;
}

export function makeShelf(bandColor) {
  const g = new THREE.Group();
  const unit = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 0.6), mat(0xd9dfe9));
  unit.position.y = 0.5;
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.62), mat(bandColor));
  band.position.y = 1.02;
  g.add(unit, band);
  return g;
}

export function makeDesk() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 1.1), mat(0x9fb4d8));
  top.position.y = 0.45;
  g.add(top);
  return g;
}
