import * as THREE from 'three';
import { mat, emat, makeBed, makeChair, makeCentrifuge, makeScanner, makeShelf, makeDesk } from '../render/meshes.js';
import { SHELVES } from '../data/meds.js';

// Terraced multi-floor hospital, matching the cutaway reference art:
//   F1 (y 0.0)  reception · waiting rows · EMERGENCY ROOM gurneys · pharmacy wall
//   F2 (y 2.3)  ward rooms (med-surge) + BIRTHPLACE + nurse hub
//   F3 (y 4.6)  LAB (centrifuge) + ICU
//   F4 (y 6.9)  IMAGING (CT)
// Floors are offset slabs joined by real staircases — you sprint (and haul
// patients) up them. Compact on purpose: everything is a short frantic run.

const WALL_H = 1.15;
const F = { f1: 0, f2: 2.3, f3: 4.6, f4: 6.9 };
const SLABS = [
  { y: F.f1, x1: -30, z1: 2, x2: -2, z2: 20 },
  { y: F.f2, x1: -30, z1: -12, x2: -6, z2: 2 },
  { y: F.f3, x1: -6, z1: -12, x2: 14, z2: 2 },
  { y: F.f4, x1: 2, z1: -24, x2: 14, z2: -12 },
];

export function floorYAt(x, z) {
  for (const s of SLABS) if (x >= s.x1 - 0.5 && x <= s.x2 + 0.5 && z >= s.z1 - 0.5 && z <= s.z2 + 0.5) return s.y;
  return 0;
}

// generic terrazzo tile (repeated per slab)
function terrazzoTexture() {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#e9eaec';
  g.fillRect(0, 0, s, s);
  const chips = ['#b8bfca', '#c9c1b2', '#a9b8cf', '#d8cfc2', '#9fb4b8'];
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = chips[i % chips.length];
    g.globalAlpha = 0.15 + Math.random() * 0.12;
    const w = 1 + Math.random() * 3;
    g.fillRect(Math.random() * s, Math.random() * s, w, w * 0.8);
  }
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(130,140,158,0.22)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildMap(scene, physics) {
  const statics = new THREE.Group();
  scene.add(statics);
  const tex = terrazzoTexture();

  // ---- slabs ----
  for (const s of SLABS) {
    const w = s.x2 - s.x1, d = s.z2 - s.z1;
    const m = new THREE.MeshStandardMaterial({ map: tex.clone(), roughness: 0.85, metalness: 0.08 });
    m.map.repeat.set(w / 4, d / 4);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), mat(0xcfd3da));
    slab.position.set((s.x1 + s.x2) / 2, s.y - 0.25, (s.z1 + s.z2) / 2);
    statics.add(slab);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    top.rotation.x = -Math.PI / 2;
    top.position.set((s.x1 + s.x2) / 2, s.y + 0.006, (s.z1 + s.z2) / 2);
    top.receiveShadow = true;
    statics.add(top);
    physics.staticBox((s.x1 + s.x2) / 2, s.y - 0.25, (s.z1 + s.z2) / 2, w / 2, 0.25, d / 2);
  }

  // ---- walls (per slab, with gaps) ----
  const wallSegs = [];
  const hwall = (y, z, x1, x2, gaps = []) => addWall(true, y, z, x1, x2, gaps);
  const vwall = (y, x, z1, z2, gaps = []) => addWall(false, y, x, z1, z2, gaps);
  function addWall(horiz, y, at, a, b, gaps) {
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
    for (const [s, e] of spans) wallSegs.push({ horiz, y, at, s, e });
  }

  // F1: perimeter (entrance gap on west wall), ER room, pharmacy is open shelving
  hwall(F.f1, 2, -30, -2, [{ at: -14.5, w: 3.2 }]);            // north (stair S1 gap)
  hwall(F.f1, 20, -30, -2);                                     // south
  vwall(F.f1, -30, 2, 20, [{ at: 10, w: 3.4 }]);                // west + ENTRANCE
  vwall(F.f1, -2, 2, 20);                                       // east
  vwall(F.f1, -10, 3, 12, [{ at: 7.2, w: 2.6 }]);               // ER west wall + door
  hwall(F.f1, 12, -10, -2, [{ at: -6, w: 2.6 }]);               // ER south wall + door

  // F2: perimeter (stair gaps south + east), ward room dividers
  hwall(F.f2, -12, -30, -6);
  hwall(F.f2, 2, -30, -6, [{ at: -14.5, w: 3.2 }]);             // stair S1 arrives
  vwall(F.f2, -30, -12, 2);
  vwall(F.f2, -6, -12, 2, [{ at: -3.5, w: 3.2 }]);              // stair S2 leaves
  hwall(F.f2, -7, -30, -6, [{ at: -27.8, w: 2 }, { at: -23.4, w: 2 }, { at: -19, w: 2 }, { at: -14.6, w: 2 }, { at: -9.2, w: 2.4 }]);
  vwall(F.f2, -25.6, -12, -7); vwall(F.f2, -21.2, -12, -7);
  vwall(F.f2, -16.8, -12, -7); vwall(F.f2, -12.4, -12, -7);

  // F3: perimeter (stair gaps west + north), lab walls
  hwall(F.f3, -12, -6, 14, [{ at: 12.4, w: 3.0 }]);             // stair S3 leaves
  hwall(F.f3, 2, -6, 14);
  vwall(F.f3, -6, -12, 2, [{ at: -3.5, w: 3.2 }]);              // stair S2 arrives
  vwall(F.f3, 14, -12, 2);
  vwall(F.f3, 3, -12, -4);                                      // lab east wall
  hwall(F.f3, -4, -6, 3, [{ at: -1.5, w: 2.4 }]);               // lab south wall + door

  // F4: perimeter (stair gap south)
  hwall(F.f4, -24, 2, 14);
  hwall(F.f4, -12, 2, 14, [{ at: 12.4, w: 3.0 }]);              // stair S3 arrives
  vwall(F.f4, 2, -24, -12);
  vwall(F.f4, 14, -24, -12);

  const wallMat = mat(0xf2f1ee);
  const bandMat = mat(0x9fb9c6);
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const w of wallSegs) {
    const len = w.e - w.s, mid = (w.s + w.e) / 2;
    const m = new THREE.Mesh(wallGeo, wallMat);
    const band = new THREE.Mesh(wallGeo, bandMat);
    if (w.horiz) {
      m.scale.set(len, WALL_H, 0.3); m.position.set(mid, w.y + WALL_H / 2, w.at);
      band.scale.set(len, 0.1, 0.34); band.position.set(mid, w.y + 0.64, w.at);
      physics.staticBox(mid, w.y + WALL_H / 2, w.at, len / 2, WALL_H / 2, 0.15);
    } else {
      m.scale.set(0.3, WALL_H, len); m.position.set(w.at, w.y + WALL_H / 2, mid);
      band.scale.set(0.34, 0.1, len); band.position.set(w.at, w.y + 0.64, mid);
      physics.staticBox(w.at, w.y + WALL_H / 2, mid, 0.15, WALL_H / 2, len / 2);
    }
    m.castShadow = true;
    statics.add(m, band);
  }

  // ---- staircases (ramp collider + step meshes + side rails) ----
  const stepMat = mat(0xdfe2e8);
  const railMat = new THREE.MeshStandardMaterial({ color: 0xbfd2dd, transparent: true, opacity: 0.45, roughness: 0.3 });
  function stairs(x, z, axis, dir, yLo, yHi, width = 3, run = 6) {
    const rise = yHi - yLo;
    const angle = Math.atan2(rise, run);
    const len = Math.hypot(rise, run);
    const cx = axis === 'z' ? x : x + (dir * run) / 2;
    const cz = axis === 'z' ? z + (dir * run) / 2 : z;
    const cy = (yLo + yHi) / 2;
    // thick slab collider (thin ones let fast bodies tunnel through and vanish
    // under the stairs); center sunk so the walking surface stays on the steps
    if (axis === 'z') physics.staticRamp(cx, cy - 0.34, cz, width / 2, 0.45, len / 2, 'x', -dir * angle);
    else physics.staticRamp(cx, cy - 0.34, cz, len / 2, 0.45, width / 2, 'z', dir * angle);
    // visible steps
    const n = 10;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const sx = axis === 'z' ? x : x + dir * run * f;
      const sz = axis === 'z' ? z + dir * run * f : z;
      const sy = yLo + rise * f;
      const step = new THREE.Mesh(wallGeo, stepMat);
      if (axis === 'z') step.scale.set(width, 0.24, run / n + 0.06);
      else step.scale.set(run / n + 0.06, 0.24, width);
      step.position.set(sx, sy - 0.06, sz);
      statics.add(step);
    }
    // side rails (visual + collider) so you don't yeet off the stairs sideways
    for (const side of [-1, 1]) {
      const rx = axis === 'z' ? x + side * (width / 2 + 0.08) : cx;
      const rz = axis === 'z' ? cz : z + side * (width / 2 + 0.08);
      const rail = new THREE.Mesh(wallGeo, railMat);
      if (axis === 'z') rail.scale.set(0.12, 0.9, run + 0.6);
      else rail.scale.set(run + 0.6, 0.9, 0.12);
      rail.position.set(rx, cy + 0.55, rz);
      rail.rotation[axis === 'z' ? 'x' : 'z'] = (axis === 'z' ? -dir : dir) * angle;
      statics.add(rail);
      if (axis === 'z') physics.staticRamp(rx, cy + 0.55, rz, 0.16, 0.5, len / 2 + 0.3, 'x', -dir * angle);
      else physics.staticRamp(rx, cy + 0.55, rz, len / 2 + 0.3, 0.5, 0.16, 'z', dir * angle);
    }
  }
  stairs(-14.5, 8, 'z', -1, F.f1, F.f2);   // F1 → F2: runs north from z=8 to z=2
  stairs(-12, -3.5, 'x', 1, F.f2, F.f3);   // F2 → F3: runs east from x=-12 to x=-6
  stairs(12.4, -6, 'z', -1, F.f3, F.f4);   // F3 → F4: runs north along the east edge

  // ---- outdoor asphalt (ambulance bay) flush with F1 so nothing falls forever ----
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), mat(0x9aa1ab));
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(-8, -0.012, 0);
  asphalt.receiveShadow = true;
  statics.add(asphalt);
  physics.staticBox(-8, -0.26, 0, 45, 0.25, 35);
  // drop-off zebra stripes by the entrance
  for (let i = 0; i < 5; i++) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 2.6), mat(0xe8e4d8));
    stripe.position.set(-31.6 - i * 0.9, 0.006, 10);
    statics.add(stripe);
  }

  // ---- beds ----
  const beds = [];
  const GURNEY = [0xd35450, 0x4a7fd0, 0xe0c04a, 0xd35450, 0x4a7fd0, 0xe0c04a];
  const addBed = (x, z, y, room, accent) => {
    const g = makeBed(accent);
    g.position.set(x, y, z);
    statics.add(g);
    physics.staticBox(x, y + 0.25, z, 0.5, 0.25, 1.05);
    beds.push({ x, z, y, room, occupant: null, index: beds.length });
  };
  // F1 ER: 6 gurneys in two rows
  [[-8.5, 4.6], [-6.5, 4.6], [-4.5, 4.6], [-8.5, 9.6], [-6.5, 9.6], [-4.5, 9.6]]
    .forEach(([x, z], i) => addBed(x, z, F.f1, 'ed', GURNEY[i]));
  // F2 wards: 4 med-surge rooms + birthplace (2 beds)
  [[-27.8], [-23.4], [-19], [-14.6]].forEach(([x]) => addBed(x, -9.8, F.f2, 'medsurge', 0x7fd8a8));
  addBed(-10.6, -9.8, F.f2, 'ob', 0xf0a6d8);
  addBed(-7.9, -9.8, F.f2, 'ob', 0xf0a6d8);
  // F3 ICU: 4 beds (east of the lab, clear of the S3 staircase at x>11)
  [4.6, 6.4, 8.2, 10].forEach((x) => addBed(x, -9.6, F.f3, 'icu', 0xea8d76));

  // ---- F1 waiting rows + reception ----
  const seats = [];
  for (let i = 0; i < 8; i++) {
    const x = -23.5 + (i % 4) * 2.1, z = 13.6 + Math.floor(i / 4) * 2.2;
    const c = makeChair();
    c.position.set(x, F.f1, z);
    statics.add(c);
    seats.push({ x, z, taken: null });
  }
  // curved-ish reception desk (three angled segments)
  [[-25.5, 8, 0.5], [-24.2, 9.2, 0.15], [-23.8, 10.8, -0.2]].forEach(([x, z, rot]) => {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 2.0), mat(0xd9c6a8));
    seg.position.set(x, F.f1 + 0.5, z);
    seg.rotation.y = rot;
    seg.castShadow = true;
    statics.add(seg);
    physics.staticBox(x, F.f1 + 0.5, z, 0.55, 0.5, 1.0);
  });
  const recTop = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 4.6), mat(0xf4efe4));
  recTop.position.set(-24.6, F.f1 + 1.04, 9.4);
  recTop.rotation.y = 0.15;
  statics.add(recTop);

  // ---- F1 pharmacy shelving wall (east side, south of the ER) ----
  const shelfUnits = [];
  [[- 3.2, 14], [-3.2, 16.2], [-3.2, 18.4]].forEach(([x, z], i) => {
    const s = makeShelf([0xf2c14e, 0x6ee0d8, 0x7a5cff][i]);
    s.rotation.y = Math.PI / 2;
    s.position.set(x, F.f1, z);
    statics.add(s);
    physics.staticBox(x, F.f1 + 0.5, z, 0.3, 0.5, 1.3);
    shelfUnits.push({ shelf: SHELVES[i], x, z });
  });

  // ---- F2 nurse hub ----
  const desk = makeDesk();
  desk.position.set(-18, F.f2, -3);
  statics.add(desk);
  physics.staticBox(-18, F.f2 + 0.45, -3, 1.6, 0.45, 0.55);

  // ---- F3 lab bench + centrifuge ----
  const centMesh = makeCentrifuge();
  centMesh.position.set(-3.4, F.f3, -9.8);
  statics.add(centMesh);
  physics.staticBox(-3.4, F.f3 + 0.4, -9.8, 0.8, 0.4, 0.5);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.85, 0.8), mat(0xccd4e0));
  bench.position.set(0.4, F.f3 + 0.43, -11.3);
  statics.add(bench);
  physics.staticBox(0.4, F.f3 + 0.43, -11.3, 1.7, 0.43, 0.4);
  const centrifuge = { x: -2.2, z: -9, y: F.f3, mesh: centMesh, busy: null, timer: 0, outX: -1.4, outZ: -8 };

  // ---- F4 imaging ----
  const scan = makeScanner();
  scan.position.set(10, F.f4, -20.5);
  statics.add(scan);
  physics.staticBox(10, F.f4 + 0.5, -21, 1.1, 0.5, 0.5);
  const imagingPad = { x: 10, z: -19.2, y: F.f4 };
  // PT decor: two therapy benches
  for (const x of [4.5, 6.5]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 1.8), mat(0x7fa8d8));
    t.position.set(x, F.f4 + 0.25, -21);
    statics.add(t);
    physics.staticBox(x, F.f4 + 0.25, -21, 0.4, 0.25, 0.9);
  }

  // ---- glow rings on interactables ----
  const rings = [];
  const floorRing = (x, z, y, color, r = 1.5) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.35, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.045, z);
    ring.material.fog = false;
    statics.add(ring);
    rings.push({ mesh: ring, x, z });
  };
  floorRing(-2.2, -9, F.f3, 0x36e0d6);        // centrifuge
  floorRing(10, -19.2, F.f4, 0xb083ff, 1.7);  // imaging pad
  floorRing(-3.4, 16.2, F.f1, 0xff5db0, 1.7); // pharmacy wall

  // drop-target ring (hops to the nearest free bed while hauling)
  const dropRing = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.3, 36),
    new THREE.MeshBasicMaterial({ color: 0x4dd07a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  dropRing.rotation.x = -Math.PI / 2;
  dropRing.material.fog = false;
  statics.add(dropRing);

  return {
    beds, seats, centrifuge, imagingPad, shelfUnits, rings, dropRing, floorYAt,
    entrance: { x: -28.2, z: 10 },
    spawnOutside: { x: -32.5, z: 10 },
    insideWaypoint: { x: -27, z: 13.4 }, // south of the reception desk — no more desk-wedged patients
    nurseSpawn: { x: -20, z: 8 },
    doctorSpawn: { x: -18, z: 10 },
  };
}
