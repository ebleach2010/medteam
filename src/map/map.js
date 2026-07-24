import * as THREE from 'three';
import { mat, emat, glowSprite, GLOW_TEX, makeBed, makeChair, makeCentrifuge, makeScanner, makeShelf, makeDesk } from '../render/meshes.js';
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
  // zone-tinted terrazzo: warm lobby, cool ward, mint lab wing, lilac discharge
  const FLOOR_TINTS = [0xeadfc2, 0xc6d8e8, 0xc8e0d0, 0xd8cde6];
  ZONES.forEach((s, zi) => {
    const w = s.x2 - s.x1, d = s.z2 - s.z1;
    const m = new THREE.MeshStandardMaterial({ map: tex.clone(), roughness: 0.85, metalness: 0.08 });
    m.color.setHex(FLOOR_TINTS[zi]);
    m.map.repeat.set(w / 4, d / 4);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    top.rotation.x = -Math.PI / 2;
    top.position.set((s.x1 + s.x2) / 2, 0.006, (s.z1 + s.z2) / 2);
    top.receiveShadow = true;
    statics.add(top);
  });

  // soft contact shadow under furniture — fake AO, huge depth win from above
  const shadowBlob = (x, z, w, d, o = 0.30) => {
    const sMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: GLOW_TEX, color: 0x000000, transparent: true, opacity: o, depthWrite: false }));
    sMesh.rotation.x = -Math.PI / 2;
    sMesh.position.set(x, 0.016, z);
    statics.add(sMesh);
  };

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
  hwall(-7, -30, -6, [-28, -24, -20, -16, -12, -8].map((x) => ({ at: x, w: 2.2 }))); // wider doors — tows snag less
  [-26, -22, -18, -14, -10].forEach((x) => vwall(x, -12, -7));
  vwall(-6, -12, 2, [{ at: -5.5, w: 2.6 }]);                      // Z2/Z3 corridor door
  // Z3 rooms 7–10 + lab + diagnostics
  hwall(-12, -6, 14, [{ at: 8.5, w: 4.4 }]);                      // to discharge
  hwall(-7, -6, 14, [-3.5, 1.5, 6.5, 11.5].map((x) => ({ at: x, w: 2.2 })));
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
  const bandMat = mat(0x5d99b0);
  const wainsMat = mat(0xc2d0da);
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const w of wallSegs) {
    const len = w.e - w.s, mid = (w.s + w.e) / 2;
    const m = new THREE.Mesh(wallGeo, wallMat);
    const band = new THREE.Mesh(wallGeo, bandMat);
    const wains = new THREE.Mesh(wallGeo, wainsMat); // lower wainscot panel
    if (w.horiz) {
      m.scale.set(len, WALL_H, 0.3); m.position.set(mid, WALL_H / 2, w.at);
      band.scale.set(len, 0.1, 0.34); band.position.set(mid, 0.64, w.at);
      wains.scale.set(len, 0.46, 0.35); wains.position.set(mid, 0.24, w.at);
      physics.staticBox(mid, WALL_H / 2, w.at, len / 2, WALL_H / 2, 0.15);
    } else {
      m.scale.set(0.3, WALL_H, len); m.position.set(w.at, WALL_H / 2, mid);
      band.scale.set(0.34, 0.1, len); band.position.set(w.at, 0.64, mid);
      wains.scale.set(0.35, 0.46, len); wains.position.set(w.at, 0.24, mid);
      physics.staticBox(w.at, WALL_H / 2, mid, 0.15, WALL_H / 2, len / 2);
    }
    m.castShadow = true;
    statics.add(m, band, wains);
  }

  // baseboard + wall-base contact shading — ONE merged mesh each, so the
  // whole hospital gets grounded for two draw calls
  {
    const aoC = document.createElement('canvas');
    aoC.width = 64; aoC.height = 64;
    const ag = aoC.getContext('2d');
    const grad = ag.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.42)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ag.fillStyle = grad; ag.fillRect(0, 0, 64, 64);
    const aoTex = new THREE.CanvasTexture(aoC);
    const pos = [], uv = [], idx = [];
    const AO_W = 0.62, EPS = 0.011;
    const quad = (ax, az, bx, bz, cx2, cz2, dx2, dz2) => {
      const b = pos.length / 3;
      pos.push(ax, EPS, az, bx, EPS, bz, cx2, EPS, cz2, dx2, EPS, dz2);
      uv.push(0, 1, 0, 1, 1, 0, 1, 0); // wall edge dark → fades out
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    };
    for (const w of wallSegs) {
      if (w.horiz) {
        quad(w.s, w.at + 0.18, w.e, w.at + 0.18, w.e, w.at + 0.18 + AO_W, w.s, w.at + 0.18 + AO_W);
        quad(w.e, w.at - 0.18, w.s, w.at - 0.18, w.s, w.at - 0.18 - AO_W, w.e, w.at - 0.18 - AO_W);
      } else {
        quad(w.at - 0.18, w.s, w.at - 0.18, w.e, w.at - 0.18 - AO_W, w.e, w.at - 0.18 - AO_W, w.s);
        quad(w.at + 0.18, w.e, w.at + 0.18, w.s, w.at + 0.18 + AO_W, w.s, w.at + 0.18 + AO_W, w.e);
      }
    }
    const aoGeo = new THREE.BufferGeometry();
    aoGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    aoGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    aoGeo.setIndex(idx);
    const aoMesh = new THREE.Mesh(aoGeo, new THREE.MeshBasicMaterial({
      map: aoTex, transparent: true, depthWrite: false,
    }));
    aoMesh.renderOrder = 1;
    statics.add(aoMesh);
  }
  // dark skirting line at every wall foot (merged boxes → one mesh)
  {
    const skirt = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0x5b6874), wallSegs.length);
    const m4 = new THREE.Matrix4();
    wallSegs.forEach((w, i) => {
      const len = w.e - w.s, mid = (w.s + w.e) / 2;
      if (w.horiz) m4.makeScale(len, 0.09, 0.4), m4.setPosition(mid, 0.045, w.at);
      else m4.makeScale(0.4, 0.09, len), m4.setPosition(w.at, 0.045, mid);
      skirt.setMatrixAt(i, m4);
    });
    statics.add(skirt);
  }

  // hospital wayfinding: colored guide stripes painted down the main corridor
  {
    const stripe = (x, z, w, d, color) => {
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }));
      sm.rotation.x = -Math.PI / 2;
      sm.position.set(x, 0.014, z);
      sm.renderOrder = 2;
      statics.add(sm);
    };
    stripe(-8, -5.05, 42, 0.16, 0xd8564a);  // red — exam rooms
    stripe(-8, -5.5, 42, 0.16, 0x3f9d8a);   // teal — lab & diagnostics
    stripe(-6.5, -5.95, 39, 0.16, 0x4bb35f); // green — discharge
    stripe(8.5, -9.5, 0.16, 5.0, 0x4bb35f);  // green turns south through the arch
    stripe(-14.5, -1.5, 0.16, 7.1, 0xd8564a); // red feeds up through the triage door
    stripe(-16.5, 2.8, 4.16, 0.16, 0xd8564a);
  }

  // ---- the ten patient rooms: bed + desk each, numbered ----
  const beds = [];
  const roomMonitors = [];
  const roomDesks = [];
  const roomLights = [];
  const ROOM_X = [-28, -24, -20, -16, -12, -8, -3.5, 1.5, 6.5, 11.5];
  const BLANKETS = [0x9fc4e8, 0x8fceb4, 0xe8c49f];
  ROOM_X.forEach((cx, i) => {
    const g = makeBed(BLANKETS[i % 3]);
    g.position.set(cx - 0.7, 0, -9.9);
    statics.add(g);
    shadowBlob(cx - 0.7, -9.9, 2.0, 3.2);
    shadowBlob(cx + 1.05, -10.6, 1.7, 1.3);
    const matt = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.4),
      new THREE.MeshStandardMaterial({ color: BLANKETS[i % 3], roughness: 0.95, transparent: true, opacity: 0.38 }));
    matt.rotation.x = -Math.PI / 2;
    matt.position.set(cx - 0.4, 0.012, -9.6);
    matt.receiveShadow = true;
    statics.add(matt);
    physics.staticBox(cx - 0.7, 0.25, -9.9, 0.5, 0.25, 1.05);
    beds.push({ x: cx - 0.7, z: -9.9, y: 0, room: 'room', roomNo: i + 1, occupant: null, index: i });
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.78, 0.6), mat(0xd9c6a8));
    desk.position.set(cx + 1.05, 0.39, -10.6);
    desk.castShadow = true;
    statics.add(desk);
    physics.staticBox(cx + 1.05, 0.39, -10.6, 0.5, 0.39, 0.3);
    roomDesks.push({ x: cx + 1.05, z: -10.6, y: 0.82, roomNo: i + 1, clipboard: null });
    // wall monitor: a REAL screen — canvas texture the Monitors system paints
    const monCanvas = document.createElement('canvas');
    monCanvas.width = 256; monCanvas.height = 160;
    const monTex = new THREE.CanvasTexture(monCanvas);
    monTex.colorSpace = THREE.SRGBColorSpace;
    const monG = new THREE.Group();
    monG.position.set(cx - 0.7, 0.88, -11.72);
    monG.rotation.x = -0.52; // tilted mount, angled at the top-down camera
    const monFrame = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.84, 0.06), mat(0x232d3a));
    const monScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 0.72),
      new THREE.MeshBasicMaterial({ map: monTex }));
    monScreen.position.z = 0.034;
    monG.add(monFrame, monScreen);
    statics.add(monG);
    roomMonitors.push({ index: i, roomNo: i + 1, canvas: monCanvas, tex: monTex, screen: monScreen, standby: false });
    // status light over the door (unique material — per-room color control)
    const lightMat = new THREE.MeshStandardMaterial({ color: 0x8a94a4, emissive: 0x8a94a4, emissiveIntensity: 0.25, roughness: 0.4 });
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lightMat);
    light.position.set(cx, 1.5, -7.35);
    statics.add(light);
    roomLights.push({ mesh: light, mat: lightMat });
  });

  // ---- triage: reception + waiting + KNOCKABLE props ----
  const seats = [];
  for (let i = 0; i < 8; i++) {
    const x = -23.5 + (i % 4) * 2.1, z = 10.2 + Math.floor(i / 4) * 2.2; // pulled toward the door — less hiking
    const c = makeChair();
    c.position.set(x, 0, z);
    statics.add(c);
    seats.push({ x, z, taken: null });
  }
  // ---- reception: a REAL front desk — counter run + side return, stone top
  // with an overhang, accent kick, work surface with monitor/keyboard/papers,
  // and a receptionist parked behind it (rig added by the Game).
  const counterBase = mat(0x8fa8bd), counterTop = mat(0xe8e4da), kick = mat(0x51677c);
  const counterSeg = (x, z, hx, hz) => {
    const base = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 1.02, hz * 2), counterBase);
    base.position.set(x, 0.51, z); base.castShadow = true;
    const band = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.02, 0.16, hz * 2 + 0.02), kick);
    band.position.set(x, 0.10, z);
    const top = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.24, 0.07, hz * 2 + 0.24), counterTop);
    top.position.set(x, 1.06, z); top.castShadow = true;
    statics.add(base, band, top);
    physics.staticBox(x, 0.55, z, hx + 0.12, 0.55, hz + 0.12);
  };
  counterSeg(-24.2, 9.9, 1.9, 0.35);   // front run (faces the entrance)
  counterSeg(-26.35, 8.9, 0.35, 1.35); // side return
  // inner work surface + the receptionist's clutter
  const work = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.72, 0.8), mat(0xb9c6d2));
  work.position.set(-24.2, 0.36, 9.05); statics.add(work);
  const monB = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.32, 0.06), mat(0x2b3442));
  monB.position.set(-24.7, 0.95, 9.1); monB.rotation.y = 0.25; monB.castShadow = true;
  const monScr = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.26), emat(0x9fd8ff, 0.7));
  monScr.position.set(-24.72, 0.95, 9.14); monScr.rotation.y = 0.25 + Math.PI;
  const kbd = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.16), mat(0x3a4454));
  kbd.position.set(-24.6, 0.74, 9.35); kbd.rotation.y = 0.2;
  const papers = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.26), mat(0xf6f2e6));
  papers.position.set(-23.6, 0.76, 9.2); papers.rotation.y = -0.3;
  const penCup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8), mat(0xc0392b));
  penCup.position.set(-23.2, 0.79, 9.05);
  statics.add(monB, monScr, kbd, papers, penCup);
  shadowBlob(-24.2, 9.5, 5.4, 2.4, 0.26);
  shadowBlob(-26.35, 8.9, 1.6, 3.6, 0.26);
  const receptionSeat = { x: -24.2, z: 8.35 }; // the Game parks a seated rig here

  // ---- waiting-area dressing (depth!) ----
  // rug under the chairs + a kids' corner mat — big top-down readability wins
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 5.6), mat(0x9fb3c8));
  rug.rotation.x = -Math.PI / 2; rug.position.set(-20.4, 0.022, 14.6);
  const rugTrim = new THREE.Mesh(new THREE.PlaneGeometry(9.8, 6.0), mat(0x51677c));
  rugTrim.rotation.x = -Math.PI / 2; rugTrim.position.set(-20.4, 0.018, 14.6);
  const kidsMat = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), mat(0xf2c14e));
  kidsMat.rotation.x = -Math.PI / 2; kidsMat.position.set(-27.3, 0.024, 16.6);
  statics.add(rugTrim, rug, kidsMat);
  // vending machine (glowing front), water cooler, coffee table, wall TV
  const vend = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.8), mat(0xc0392b));
  vend.position.set(-16.9, 1.0, 12.4); vend.castShadow = true;
  const vendGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.5), emat(0xbfe8ff, 0.55));
  vendGlass.position.set(-17.46, 1.05, 12.4); vendGlass.rotation.y = -Math.PI / 2;
  physics.staticBox(-16.9, 1.0, 12.4, 0.55, 1.0, 0.4);
  const coolerBase = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), mat(0xdfe5ea));
  coolerBase.position.set(-26.6, 0.5, 12.2); coolerBase.castShadow = true;
  physics.staticBox(-26.6, 0.6, 12.2, 0.3, 0.6, 0.3);
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.4, 0.9), mat(0xd9c6a8));
  table.position.set(-20.4, 0.2, 14.7); table.castShadow = true;
  physics.staticBox(-20.4, 0.2, 14.7, 0.85, 0.2, 0.45);
  const tvFrame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.0, 0.1), mat(0x232a36));
  tvFrame.position.set(-20.5, 2.1, 17.0);
  const tvScr = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.82), emat(0x6fa8d8, 0.5));
  tvScr.position.set(-20.5, 2.1, 16.94); tvScr.rotation.y = Math.PI;
  statics.add(vend, vendGlass, coolerBase, table, tvFrame, tvScr);
  shadowBlob(-16.9, 12.4, 2.0, 1.6, 0.3);
  shadowBlob(-26.6, 12.2, 1.1, 1.1, 0.26);
  shadowBlob(-20.4, 14.7, 2.6, 1.7, 0.24);

  // rampage waypoints: the WHOLE waiting area — angry patients storm between
  // these and shove whatever physics props are in reach
  const knockSpots = [
    [-25.8, 11.2], [-23.2, 11.4], [-20.4, 13.2], [-18.2, 12.8], [-17.4, 14.8],
    [-20.4, 16.2], [-23.5, 15.6], [-26.3, 14.4], [-27.0, 16.5], [-21.8, 14.7],
  ];
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
    shadowBlob(x, z, 3.0, 1.1, 0.26);
    shelfUnits.push({ shelf: SHELVES[i], x, z });
  });

  // ---- staff station (Z2 south strip) ----
  const desk = makeDesk();
  desk.position.set(-16, 0, -1.2);
  statics.add(desk);
  physics.staticBox(-16, 0.45, -1.2, 1.6, 0.45, 0.55);
  shadowBlob(-16, -1.2, 4.0, 1.8, 0.26);
  // the nurses' station: idle staff SIT here until dispatched
  // tucked toward the west end of the desk — clear of the door funnel at
  // (-14.5, 2) so a dragged patient never plows through the seated crew
  const staffSeats = {
    aide: { x: -18.6, z: -0.3, yaw: Math.PI },
    surgeon: { x: -17.4, z: -0.3, yaw: Math.PI },
    porter: { x: -16.2, z: -0.3, yaw: Math.PI },
    tech: { x: -15.0, z: -0.3, yaw: Math.PI },
  };
  for (const key of ['aide', 'surgeon', 'porter', 'tech']) {
    const c = makeChair();
    c.position.set(staffSeats[key].x, 0, staffSeats[key].z + 0.15);
    c.rotation.y = Math.PI;
    statics.add(c);
  }
  // MED-DOC 4000: green-phosphor consult terminal on the desk's east end
  const crt = new THREE.Group();
  const crtCase = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.48, 0.5), mat(0xd8d2bd));
  crtCase.position.y = 0.24;
  crtCase.castShadow = true;
  const crtScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), emat(0x39ff6e, 0.75));
  crtScreen.position.set(0, 0.26, 0.258);
  const crtKeys = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.2), mat(0xbfb9a4));
  crtKeys.position.set(0, 0.03, 0.42);
  crt.add(crtCase, crtScreen, crtKeys);
  crt.position.set(-14.75, 0.9, -1.2);
  crt.rotation.y = Math.PI; // screen faces the corridor side
  statics.add(crt);
  const medDoc = { x: -14.75, z: -2.6 }; // stand here → MED-DOC prompt

  // TRIAGE terminal: MED-DOC's blue twin on the desk's west end
  const crt2 = new THREE.Group();
  const crt2Case = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.48, 0.5), mat(0xc9cfd8));
  crt2Case.position.y = 0.24;
  crt2Case.castShadow = true;
  const crt2Screen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), emat(0x4aa8ff, 0.75));
  crt2Screen.position.set(0, 0.26, 0.258);
  const crt2Keys = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.2), mat(0xb2b8c2));
  crt2Keys.position.set(0, 0.03, 0.42);
  crt2.add(crt2Case, crt2Screen, crt2Keys);
  crt2.position.set(-17.25, 0.9, -1.2);
  crt2.rotation.y = Math.PI;
  statics.add(crt2);
  const triagePC = { x: -17.25, z: -2.6 }; // stand here → TRIAGE BOARD prompt

  // when dispatched they round the desk via a fixed lane, then sprint
  // lanes bow NORTH around the seated row first, then round the desk end —
  // running along the row itself just body-checks your seated colleagues
  const stationExit = {
    west: [{ x: -19.4, z: 0.9 }, { x: -19.2, z: -2.7 }],
    east: [{ x: -13.6, z: 0.9 }, { x: -13.6, z: -2.7 }],
  };

  // ---- LAB (Z3 south-west) ----
  const centMesh = makeCentrifuge();
  centMesh.position.set(-3.6, 0, 0.6);
  statics.add(centMesh);
  shadowBlob(-3.6, 0.6, 2.4, 1.6, 0.28);
  physics.staticBox(-3.6, 0.4, 0.6, 0.8, 0.4, 0.5);
  const centrifuge = { x: -2.4, z: 0, y: 0, mesh: centMesh, busy: null, timer: 0, outX: -1.6, outZ: -0.9 };

  // ---- DIAGNOSTICS (Z3 south-east): the one machine ----
  const scan = makeScanner();
  scan.position.set(8.6, 0, 0.4);
  statics.add(scan);
  shadowBlob(8.6, 0.5, 3.2, 2.2, 0.28);
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
    roomDesks, roomLights, roomMonitors, knockSpots, triageDesk, receptionSeat, staffSeats, stationExit, medDoc, triagePC,
    discharge, gateOut, firePit, fire,
    floorYAt: () => 0,
    zoneOf, zoneDoors: ZONE_DOORS,
    entrance: { x: -28.2, z: 10 },
    spawnOutside: { x: -32.5, z: 10 },
    insideWaypoint: { x: -26.5, z: 11 },
    nurseSpawn: { x: -17.5, z: -2.8 },
    doctorSpawn: { x: -14, z: -2.8 },
    porterSpawn: { x: -14.8, z: -0.2 },
    labDoor: { x: -2, z: -4.8 },
    roomDoor: (i) => ({ x: ROOM_X[i], z: -6 }),
  };
}
