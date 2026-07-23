import * as THREE from 'three';
import { mat, emat, makeBed, makeChair, makeCentrifuge, makeScanner, makeShelf, makeDesk } from '../render/meshes.js';
import { SHELVES, MEDS } from '../data/meds.js';

// canvas floor texture: bright terrazzo (speckled near-white) with faint
// pastel zone washes and colored zone borders — the HFF-hospital floor
function makeFloorTexture() {
  const W = 2048, H = 1280; // maps onto the 58 × 34 m floor slab
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const u = (x) => ((x + 29) / 58) * W;
  const v = (z) => ((z + 17) / 34) * H;
  const rect = (x1, z1, x2, z2, col) => {
    g.fillStyle = col;
    g.fillRect(u(x1), v(z1), u(x2) - u(x1), v(z2) - v(z1));
  };
  rect(-29, -17, 29, 17, '#e7e8ea');            // terrazzo base
  // whisper-faint zone washes (wayfinding without killing the brightness)
  rect(-28, -16, -14, -6, 'rgba(240,150,80,0.09)');   // ICU
  rect(-14, -16, 0, -6, 'rgba(90,200,150,0.09)');     // med-surge
  rect(0, -16, 14, -6, 'rgba(200,120,220,0.09)');     // birthplace
  rect(14, -16, 28, -6, 'rgba(110,150,240,0.09)');    // imaging
  rect(-28, -2, -18, 16, 'rgba(60,190,180,0.10)');    // lab
  rect(-18, -2, 8, 8, 'rgba(110,150,240,0.07)');      // ED bays
  rect(16, -2, 28, 16, 'rgba(230,100,180,0.08)');     // pharmacy
  // terrazzo speckle
  const chips = ['#b8bfca', '#c9c1b2', '#a9b8cf', '#d8cfc2', '#9fb4b8'];
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = chips[i % chips.length];
    g.globalAlpha = 0.14 + Math.random() * 0.12;
    const s = 1 + Math.random() * 2.4;
    g.fillRect(Math.random() * W, Math.random() * H, s, s * 0.8);
  }
  g.globalAlpha = 1;
  // subtle 2 m tile seams
  g.strokeStyle = 'rgba(130,140,158,0.20)';
  g.lineWidth = 2;
  for (let x = -28; x <= 28; x += 2) { g.beginPath(); g.moveTo(u(x), 0); g.lineTo(u(x), H); g.stroke(); }
  for (let z = -16; z <= 16; z += 2) { g.beginPath(); g.moveTo(0, v(z)); g.lineTo(W, v(z)); g.stroke(); }
  // colored zone border lines (like taped wayfinding lanes)
  const border = (x1, z1, x2, z2, col) => {
    g.strokeStyle = col; g.lineWidth = 6;
    g.strokeRect(u(x1) + 3, v(z1) + 3, u(x2) - u(x1) - 6, v(z2) - v(z1) - 6);
  };
  border(-28, -16, -14, -6, 'rgba(235,140,70,0.5)');
  border(-14, -16, 0, -6, 'rgba(70,190,140,0.5)');
  border(0, -16, 14, -6, 'rgba(190,110,215,0.5)');
  border(14, -16, 28, -6, 'rgba(100,140,235,0.5)');
  border(-28, -2, -18, 16, 'rgba(50,180,170,0.5)');
  border(16, -2, 28, 16, 'rgba(225,95,170,0.5)');
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// One hospital floor, 56 × 32 m, origin at center. North = -z.
//   North wing:  ICU | MED-SURGE | BIRTHPLACE | IMAGING     (z -16..-6)
//   Corridor                                                 (z -6..-2)
//   South wing:  LAB | ED BAYS + WAITING | NURSE ST | PHARMACY (z -2..16)
// Doors are ~2.4 m gaps — wide enough to drag a flailing patient through. Barely.

const WALL_H = 1.1; // low walls: the tilted top-down camera sees over them

const SHELF_COLORS = {
  topicals: 0xf2c14e, antibiotics: 0xf06e9c, resp: 0x6ee0d8,
  cardiac: 0xffa1e0, critical: 0xffd23c, sedation: 0x7a5cff,
};

export function buildMap(scene, physics) {
  const statics = new THREE.Group();
  scene.add(statics);

  // ---- floor: painted lino sheet (room colors baked into one canvas texture) ----
  const slab = new THREE.Mesh(new THREE.BoxGeometry(58, 0.2, 34), mat(0x1a1e2e));
  slab.position.y = -0.11;
  statics.add(slab);
  const floorMat = new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.85, metalness: 0.08 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(58, 34), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.005;
  floor.receiveShadow = true;
  statics.add(floor);
  physics.staticBox(0, -0.1, 0, 29, 0.1, 17);

  // ---- walls ----
  const wallSegs = [];
  // hwall: along x at fixed z. gaps: [{at, w}]
  const hwall = (z, x1, x2, gaps = []) => addWall(true, z, x1, x2, gaps);
  const vwall = (x, z1, z2, gaps = []) => addWall(false, x, z1, z2, gaps);
  function addWall(horiz, at, a, b, gaps) {
    let spans = [[a, b]];
    for (const gp of gaps) {
      const next = [];
      for (const [s, e] of spans) {
        const g1 = gp.at - gp.w / 2, g2 = gp.at + gp.w / 2;
        if (g2 <= s || g1 >= e) { next.push([s, e]); continue; }
        if (g1 > s) next.push([s, g1]);
        if (g2 < e) next.push([g2, e]);
      }
      spans = next;
    }
    for (const [s, e] of spans) wallSegs.push({ horiz, at, s, e });
  }

  // perimeter (entrance on south wall at x=-5)
  hwall(-16, -28, 28);
  hwall(16, -28, 28, [{ at: -5, w: 3.2 }]);
  vwall(-28, -16, 16); vwall(28, -16, 16);
  // north wing dividers + its corridor wall (a door per room)
  vwall(-14, -16, -6); vwall(0, -16, -6); vwall(14, -16, -6);
  hwall(-6, -28, 28, [{ at: -21, w: 2.4 }, { at: -7, w: 2.4 }, { at: 7, w: 2.4 }, { at: 21, w: 2.4 }]);
  // corridor south wall (big ED mouth + lab/nurse/pharmacy doors)
  hwall(-2, -28, 28, [{ at: -23, w: 2.4 }, { at: -5, w: 6 }, { at: 12, w: 3 }, { at: 22, w: 2.4 }]);
  // south wing dividers
  vwall(-18, -2, 16, [{ at: 5, w: 2.2 }]);   // lab ↔ ED shortcut door
  vwall(8, -2, 16, [{ at: 10, w: 2.4 }]);    // ED/waiting ↔ nurse station
  vwall(16, -2, 16, [{ at: 6, w: 2.4 }]);    // nurse station ↔ pharmacy
  // ED bays / waiting divider
  hwall(8, -18, 8, [{ at: -12, w: 2.6 }, { at: 0, w: 2.6 }]);

  // white walls with a teal wainscot band — bright HFF hospital, not a bunker
  const wallMat = mat(0xf2f1ee);
  const bandMat = mat(0x8fb7c9);
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const w of wallSegs) {
    const len = w.e - w.s, mid = (w.s + w.e) / 2;
    const m = new THREE.Mesh(wallGeo, wallMat);
    const band = new THREE.Mesh(wallGeo, bandMat);
    if (w.horiz) {
      m.scale.set(len, WALL_H, 0.3); m.position.set(mid, WALL_H / 2, w.at);
      band.scale.set(len, 0.1, 0.34); band.position.set(mid, 0.62, w.at);
      physics.staticBox(mid, WALL_H / 2, w.at, len / 2, WALL_H / 2, 0.15);
    } else {
      m.scale.set(0.3, WALL_H, len); m.position.set(w.at, WALL_H / 2, mid);
      band.scale.set(0.34, 0.1, len); band.position.set(w.at, 0.62, mid);
      physics.staticBox(w.at, WALL_H / 2, mid, 0.15, WALL_H / 2, len / 2);
    }
    m.castShadow = true;
    statics.add(m, band);
  }

  // ---- beds ----
  const beds = [];
  const addBed = (x, z, room, accent) => {
    const g = makeBed(accent); g.position.set(x, 0, z);
    statics.add(g);
    physics.staticBox(x, 0.25, z, 0.5, 0.25, 1.05);
    beds.push({ x, z, room, occupant: null, index: beds.length });
  };
  for (let i = 0; i < 6; i++) addBed(-15 + i * 4, 0.6, 'ed', 0x76a9ea);
  for (let i = 0; i < 4; i++) addBed(-25.5 + i * 3.2, -12.5, 'icu', 0xea8d76);
  for (let i = 0; i < 6; i++) addBed(-12.5 + i * 2.3, -12.5, 'medsurge', 0x7fd8a8);
  for (let i = 0; i < 2; i++) addBed(4 + i * 5, -12.5, 'ob', 0xf0a6d8);

  // ---- waiting chairs ----
  const seats = [];
  for (let i = 0; i < 8; i++) {
    const x = -16.5 + i * 2.1, z = 13.5;
    const c = makeChair(); c.position.set(x, 0, z);
    statics.add(c);
    seats.push({ x, z, taken: null });
  }

  // ---- lab: centrifuge ----
  const centMesh = makeCentrifuge();
  centMesh.position.set(-24.5, 0, 5);
  statics.add(centMesh);
  physics.staticBox(-24.5, 0.4, 5, 0.8, 0.4, 0.5);
  const centrifuge = { x: -23.2, z: 5.8, mesh: centMesh, busy: null, timer: 0, outX: -23.2, outZ: 7 };

  // ---- imaging scanner ----
  const scan = makeScanner();
  scan.position.set(21, 0, -11.5);
  statics.add(scan);
  physics.staticBox(21, 0.5, -12, 1.1, 0.5, 0.5); // gantry base only; pad stays walkable
  const imagingPad = { x: 21, z: -10.2 };

  // ---- pharmacy shelves (one per med class) ----
  const shelfUnits = [];
  const shelfPos = [[19.3, 0.8], [23.2, 0.8], [27, 0.8], [19.3, 8.5], [23.2, 8.5], [27, 8.5]];
  SHELVES.forEach((shelfId, i) => {
    const [x, z] = shelfPos[i];
    const s = makeShelf(SHELF_COLORS[shelfId]);
    s.position.set(x, 0, z);
    statics.add(s);
    physics.staticBox(x, 0.5, z, 1.3, 0.5, 0.3);
    shelfUnits.push({ shelf: shelfId, x, z, meds: MEDS.filter((m) => m.shelf === shelfId) });
  });

  // ---- nurse station desk ----
  const desk = makeDesk(); desk.position.set(12, 0, 6);
  statics.add(desk);
  physics.staticBox(12, 0.45, 6, 1.6, 0.45, 0.55);

  // ---- wood thresholds under every door gap (reads as a doorway from above) ----
  const sillMat = mat(0xc9a875);
  for (const [x, z, w, d] of [
    [-21, -6, 2.4, 0.5], [-7, -6, 2.4, 0.5], [7, -6, 2.4, 0.5], [21, -6, 2.4, 0.5],
    [-23, -2, 2.4, 0.5], [-5, -2, 6, 0.5], [12, -2, 3, 0.5], [22, -2, 2.4, 0.5],
    [-18, 5, 0.5, 2.2], [8, 10, 0.5, 2.4], [16, 6, 0.5, 2.4],
    [-12, 8, 2.6, 0.5], [0, 8, 2.6, 0.5], [-5, 16, 3.2, 0.5],
  ]) {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), sillMat);
    sill.position.set(x, 0.03, z);
    statics.add(sill);
  }

  // ---- glow rings marking interactables (pulse when you're close) ----
  const rings = [];
  const floorRing = (x, z, color, r = 1.5) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.35, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.04, z);
    ring.material.fog = false;
    statics.add(ring);
    rings.push({ mesh: ring, x, z });
    return ring;
  };
  floorRing(-23.2, 5.8, 0x36e0d6);          // centrifuge
  floorRing(21, -10.2, 0xb083ff, 1.7);      // imaging pad
  floorRing(23.2, 2, 0xff5db0, 1.6);        // pharmacy cabinet row 1
  floorRing(23.2, 9.6, 0xff5db0, 1.6);      // pharmacy cabinet row 2

  return {
    beds, seats, centrifuge, imagingPad, shelfUnits, rings,
    entrance: { x: -5, z: 15.2 },
    spawnOutside: { x: -5, z: 16.6 },
    nurseSpawn: { x: 10, z: 3 },
    doctorSpawn: { x: 13.5, z: 3 },
    rooms: {
      icu: { x1: -28, z1: -16, x2: -14, z2: -6 },
      medsurge: { x1: -14, z1: -16, x2: 0, z2: -6 },
      ob: { x1: 0, z1: -16, x2: 14, z2: -6 },
      imaging: { x1: 14, z1: -16, x2: 28, z2: -6 },
    },
  };
}
