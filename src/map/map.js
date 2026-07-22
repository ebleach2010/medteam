import * as THREE from 'three';
import { mat, makeBed, makeChair, makeCentrifuge, makeScanner, makeShelf, makeDesk } from '../render/meshes.js';
import { SHELVES, MEDS } from '../data/meds.js';

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

  // ---- floor with room tints ----
  const floor = new THREE.Mesh(new THREE.BoxGeometry(58, 0.2, 34), mat(0x30394f));
  floor.position.y = -0.1;
  statics.add(floor);
  physics.staticBox(0, -0.1, 0, 29, 0.1, 17);
  const tint = (x, z, w, d, color) => {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color));
    t.rotation.x = -Math.PI / 2; t.position.set(x, 0.02, z);
    statics.add(t);
  };
  tint(-21, -11, 13.6, 9.6, 0x394a6b);  // ICU
  tint(-7, -11, 13.6, 9.6, 0x3b5266);   // med-surge
  tint(7, -11, 13.6, 9.6, 0x5c4a66);    // birthplace
  tint(21, -11, 13.6, 9.6, 0x2f3a52);   // imaging
  tint(0, -4, 55.6, 3.6, 0x46536e);     // corridor
  tint(-23, 7, 9.6, 17.6, 0x3f5a5e);    // lab
  tint(-5, 3, 25.6, 9.6, 0x4b5b7c);     // ED bays
  tint(-5, 12, 25.6, 7.6, 0x445070);    // waiting room
  tint(12, 7, 7.6, 17.6, 0x50607e);     // nurse station
  tint(22, 7, 11.6, 17.6, 0x54506e);    // pharmacy

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

  const wallMat = mat(0xb9c2d4);
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const w of wallSegs) {
    const len = w.e - w.s, mid = (w.s + w.e) / 2;
    const m = new THREE.Mesh(wallGeo, wallMat);
    if (w.horiz) { m.scale.set(len, WALL_H, 0.3); m.position.set(mid, WALL_H / 2, w.at); physics.staticBox(mid, WALL_H / 2, w.at, len / 2, WALL_H / 2, 0.15); }
    else { m.scale.set(0.3, WALL_H, len); m.position.set(w.at, WALL_H / 2, mid); physics.staticBox(w.at, WALL_H / 2, mid, 0.15, WALL_H / 2, len / 2); }
    statics.add(m);
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

  // room label sprites are skipped (HTML HUD carries orientation); tints suffice.
  return {
    beds, seats, centrifuge, imagingPad, shelfUnits,
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
