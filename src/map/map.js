import * as THREE from 'three';
import { mat, emat, glowSprite, makeBed, makeChair, makeCentrifuge, makeScanner, makeShelf, makeDesk } from '../render/meshes.js';
import { SHELVES } from '../data/meds.js';

// Single-player hospital: compact, sectioned, VERY recognizable.
//   Z1  TRIAGE: entrance · reception (knockable props) · waiting · PHARMACY wall
//   Z2  ROOMS 1–6 along the north wall + staff station
//   Z3  ROOMS 7–10 + LAB + DIAGNOSTICS (the one machine)
//   Z4  DISCHARGE gate + INCINERATOR pit
const WALL_H = 1.15;
const ZONES = [
  { x1: -30, z1: 2, x2: -2, z2: 20 },
  { x1: -30, z1: -12, x2: -6, z2: 2 },
  { x1: -6, z1: -12, x2: 14, z2: 2 },
  { x1: 2, z1: -24, x2: 14, z2: -12 },
];
export const zoneOf = (x, z) => ZONES.findIndex((s) => x >= s.x1 - 0.6 && x <= s.x2 + 0.6 && z >= s.z1 - 0.6 && z <= s.z2 + 0.6);
export const ZONE_DOORS = [{ x: -14.5, z: 2 }, { x: -6, z: -5.5 }, { x: 8.5, z: -12 }];

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

  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(100, 80), mat(0x9aa1ab));
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(-8, -0.012, -2);
  asphalt.receiveShadow = true;
  statics.add(asphalt);
  physics.staticBox(-8, -0.26, -2, 50, 0.25, 40);
  for (let i = 0; i < 5; i++) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 2.6), mat(0xe8e4d8));
    stripe.position.set(-31.6 - i * 0.9, 0.006, 10);
    statics.add(stripe);
  }
  for (const s of ZONES) {
    const w = s.x2 - s.x1, d = s.z2 - s.z1;
    const m = new THREE.MeshStandardMaterial({ map: tex.clone(), roughness: 0.85, metalness: 0.08 });
    m.map.repeat.set(w / 4, d / 4);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    top.rotation.x = -Math.PI / 2;
    top.position.set((s.x1 + s.x2) / 2, 0.006, (s.z1 + s.z2) / 2);
    top.receiveShadow = true;
    statics.add(top);
  }

  // ---- walls ----
  const wallSegs = [];
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
    for (const [s, e] of spans) if (e - s > 0.01) wallSegs.push({ horiz, at, s, e });
  }

  // Z1 triage
  hwall(20, -30, -2);
  vwall(-30, 2, 20, [{ at: 10, w: 3.4 }]);                        // ENTRANCE
  hwall(2, -30, -2, [{ at: -14.5, w: 5 }]);                       // Z1/Z2 door
  vwall(-2, 2, 20);
  // Z2 rooms 1–6 (doors face south into the corridor)
  hwall(-12, -30, -6);
  vwall(-30, -12, 2);
  hwall(-7, -30, -6, [-28, -24, -20, -16, -12, -8].map((x) => ({ at: x, w: 1.9 })));
  [-26, -22, -18, -14, -10].forEach((x) => vwall(x, -12, -7));
  vwall(-6, -12, 2, [{ at: -5.5, w: 2.6 }]);                      // Z2/Z3 corridor door
  // Z3 rooms 7–10 + lab + diagnostics
  hwall(-12, -6, 14, [{ at: 8.5, w: 4.4 }]);                      // to discharge
  hwall(-7, -6, 14, [-3.5, 1.5, 6.5, 11.5].map((x) => ({ at: x, w: 1.9 })));
  [-1, 4, 9].forEach((x) => vwall(x, -12, -7));
  hwall(2, -6, 14);
  vwall(14, -12, 2);
  hwall(-4, -6, 14, [{ at: -2, w: 2.2 }, { at: 8, w: 2.6 }]);     // lab + diagnostics doors
  vwall(2, -4, 2);                                                 // lab | diagnostics divider
  // Z4 discharge
  hwall(-24, 2, 14, [{ at: 5, w: 3 }]);                           // the GATE
  vwall(2, -24, -12);
  vwall(14, -24, -12);

  const wallMat = mat(0xf2f1ee);
  const bandMat = mat(0x9fb9c6);
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const w of wallSegs) {
    const len = w.e - w.s, mid = (w.s + w.e) / 2;
    const m = new THREE.Mesh(wallGeo, wallMat);
    const band = new THREE.Mesh(wallGeo, bandMat);
    if (w.horiz) {
      m.scale.set(len, WALL_H, 0.3); m.position.set(mid, WALL_H / 2, w.at);
      band.scale.set(len, 0.1, 0.34); band.position.set(mid, 0.64, w.at);
      physics.staticBox(mid, WALL_H / 2, w.at, len / 2, WALL_H / 2, 0.15);
    } else {
      m.scale.set(0.3, WALL_H, len); m.position.set(w.at, WALL_H / 2, mid);
      band.scale.set(0.34, 0.1, len); band.position.set(w.at, 0.64, mid);
      physics.staticBox(w.at, WALL_H / 2, mid, 0.15, WALL_H / 2, len / 2);
    }
    m.castShadow = true;
    statics.add(m, band);
  }

  // ---- the ten patient rooms: bed + desk each, numbered ----
  const beds = [];
  const roomDesks = [];
  const ROOM_X = [-28, -24, -20, -16, -12, -8, -3.5, 1.5, 6.5, 11.5];
  ROOM_X.forEach((cx, i) => {
    const g = makeBed(0x9fc4e8);
    g.position.set(cx - 0.7, 0, -9.9);
    statics.add(g);
    physics.staticBox(cx - 0.7, 0.25, -9.9, 0.5, 0.25, 1.05);
    beds.push({ x: cx - 0.7, z: -9.9, y: 0, room: 'room', roomNo: i + 1, occupant: null, index: i });
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.78, 0.6), mat(0xd9c6a8));
    desk.position.set(cx + 1.05, 0.39, -10.6);
    desk.castShadow = true;
    statics.add(desk);
    physics.staticBox(cx + 1.05, 0.39, -10.6, 0.5, 0.39, 0.3);
    roomDesks.push({ x: cx + 1.05, z: -10.6, y: 0.82, roomNo: i + 1, clipboard: null });
    // wall monitor prop
    const mon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.06), emat(0x6effe6, 0.35));
    mon.position.set(cx - 0.7, 0.95, -11.7);
    statics.add(mon);
  });

  // ---- triage: reception + waiting + KNOCKABLE props ----
  const seats = [];
  for (let i = 0; i < 8; i++) {
    const x = -23.5 + (i % 4) * 2.1, z = 13.6 + Math.floor(i / 4) * 2.2;
    const c = makeChair();
    c.position.set(x, 0, z);
    statics.add(c);
    seats.push({ x, z, taken: null });
  }
  [[-25.5, 8, 0.5], [-24.2, 9.2, 0.15], [-23.8, 10.8, -0.2]].forEach(([x, z, rot]) => {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 2.0), mat(0xd9c6a8));
    seg.position.set(x, 0.5, z);
    seg.rotation.y = rot;
    seg.castShadow = true;
    statics.add(seg);
    physics.staticBox(x, 0.5, z, 0.55, 0.5, 1.0);
  });
  const knockSpots = [[-25.4, 7.4], [-25, 8.4], [-24.3, 9.6], [-23.9, 10.4], [-23.7, 11.3], [-24.6, 8.9]];
  const triageDesk = { x: -24.4, z: 9.4 };

  // plants + posters (depth dressing)
  for (const [x, z] of [[-29, 3], [-3, 3], [-29, 19], [-3, 19], [13, 1], [3, -23]]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 10), mat(0x8a5a3c));
    pot.position.set(x, 0.25, z);
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), mat(0x3f8a4f));
    bush.position.set(x, 0.85, z);
    bush.castShadow = true;
    statics.add(pot, bush);
  }

  // ---- pharmacy wall (Z1 south) ----
  const shelfUnits = [];
  [[-13, 19.2], [-9.5, 19.2], [-6, 19.2]].forEach(([x, z], i) => {
    const s = makeShelf([0xf2c14e, 0x6ee0d8, 0x7a5cff][i]);
    s.position.set(x, 0, z);
    statics.add(s);
    physics.staticBox(x, 0.5, z, 1.3, 0.5, 0.3);
    shelfUnits.push({ shelf: SHELVES[i], x, z });
  });

  // ---- staff station (Z2 south strip) ----
  const desk = makeDesk();
  desk.position.set(-16, 0, -1.2);
  statics.add(desk);
  physics.staticBox(-16, 0.45, -1.2, 1.6, 0.45, 0.55);

  // ---- LAB (Z3 south-west) ----
  const centMesh = makeCentrifuge();
  centMesh.position.set(-3.6, 0, 0.6);
  statics.add(centMesh);
  physics.staticBox(-3.6, 0.4, 0.6, 0.8, 0.4, 0.5);
  const centrifuge = { x: -2.4, z: 0, y: 0, mesh: centMesh, busy: null, timer: 0, outX: -1.6, outZ: -0.9 };

  // ---- DIAGNOSTICS (Z3 south-east): the one machine ----
  const scan = makeScanner();
  scan.position.set(8.6, 0, 0.4);
  statics.add(scan);
  physics.staticBox(8.6, 0.5, 0.9, 1.1, 0.5, 0.5);
  const diagnostics = {
    machine: { x: 8.6, z: 0.4 },
    dock: { x: 8.6, z: -1.2 },      // patient parks here during the scan
    tech: { x: 6.6, z: -0.6 },      // rad tech's post
    door: { x: 8, z: -4 },
  };
  const imagingPad = { x: diagnostics.dock.x, z: diagnostics.dock.z, y: 0 }; // legacy alias

  // ---- Z4: discharge + pit ----
  const discharge = { x: 5, z: -18, r: 2.3 };
  const gateOut = { x: 5, z: -26 };
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.25, 0.7), mat(0x4dd07a));
  doorFrame.position.set(5, WALL_H + 0.1, -24);
  statics.add(doorFrame);
  const firePit = { x: 11.3, z: -18.5, r: 1.7 };
  const pitRim = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.22, 10, 28), mat(0x5a5148));
  pitRim.rotation.x = Math.PI / 2;
  pitRim.position.set(firePit.x, 0.12, firePit.z);
  statics.add(pitRim);
  const pitHole = new THREE.Mesh(new THREE.CircleGeometry(1.7, 28), new THREE.MeshBasicMaterial({ color: 0x160a04 }));
  pitHole.rotation.x = -Math.PI / 2;
  pitHole.position.set(firePit.x, 0.02, firePit.z);
  statics.add(pitHole);
  const flames = [];
  const flameGeo = new THREE.ConeGeometry(0.34, 1.2, 7);
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(flameGeo, emat(i % 2 ? 0xff8a3c : 0xffb43c, 1.4));
    const a = (i / 5) * Math.PI * 2;
    f.position.set(firePit.x + Math.cos(a) * 0.7, 0.55, firePit.z + Math.sin(a) * 0.7);
    statics.add(f);
    flames.push(f);
  }
  const fireGlow = glowSprite(0xff7a2c, 6, 0.5);
  fireGlow.position.set(firePit.x, 1.2, firePit.z);
  statics.add(fireGlow);
  const fire = { flames, glow: fireGlow, flare: 0 };

  // ---- rings ----
  const rings = [];
  const floorRing = (x, z, color, r = 1.5) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.35, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.045, z);
    ring.material.fog = false;
    statics.add(ring);
    rings.push({ mesh: ring, x, z });
  };
  floorRing(centrifuge.x, centrifuge.z, 0x36e0d6);
  floorRing(diagnostics.dock.x, diagnostics.dock.z, 0xb083ff, 1.6);
  floorRing(-9.5, 17.6, 0xff5db0, 1.7);
  floorRing(discharge.x, discharge.z, 0x4dd07a, 2.0);
  floorRing(firePit.x, firePit.z, 0xff6a2c, 1.9);

  const dropRing = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.3, 36),
    new THREE.MeshBasicMaterial({ color: 0x4dd07a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  dropRing.rotation.x = -Math.PI / 2;
  dropRing.material.fog = false;
  statics.add(dropRing);

  return {
    beds, seats, centrifuge, imagingPad, diagnostics, shelfUnits, rings, dropRing,
    roomDesks, knockSpots, triageDesk,
    discharge, gateOut, firePit, fire,
    floorYAt: () => 0,
    zoneOf, zoneDoors: ZONE_DOORS,
    entrance: { x: -28.2, z: 10 },
    spawnOutside: { x: -32.5, z: 10 },
    insideWaypoint: { x: -27, z: 13.4 },
    nurseSpawn: { x: -17.5, z: -2.8 },
    doctorSpawn: { x: -14, z: -2.8 },
    porterSpawn: { x: -14.8, z: -0.2 },
    labDoor: { x: -2, z: -4.8 },
    roomDoor: (i) => ({ x: ROOM_X[i], z: -6 }),
  };
}
