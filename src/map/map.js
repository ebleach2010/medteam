import * as THREE from 'three';
import { mat, emat, glowSprite, GLOW_TEX, makeBed, makeChair, makeOfficeChair, makeShelf, makeDesk } from '../render/meshes.js';
import { SHELVES } from '../data/meds.js';

// Single-player hospital: compact, sectioned, VERY recognizable.
//   Z1  TRIAGE: entrance · reception (knockable props) · waiting · PHARMACY wall
//   Z2  ROOMS 1–6 along the north wall + staff station
//   Z3  ROOMS 7–10 + LAB + DIAGNOSTICS (the one machine)
//   Z4  DISCHARGE gate + INCINERATOR pit
//
// Architecture is two-tier for the chase camera (which always looks north,
// straight down -z, with zero x offset):
//   TALL walls — every north/south-running wall (edge-on to the camera, they
//   can never stand between you and the lens) and the far "backdrop" walls.
//   These get windows, mullions and the city outside. Real building.
//   LOW walls — any east/west wall that could block the view gets the classic
//   dollhouse cutaway: hip-height solid + a see-through glass upper so the
//   architecture still reads full height.
const WALL_H = 1.3;         // cutaway tier
const TALL_H = 2.75;        // full tier
const GLASS_TOP = 2.0;      // glass uppers rise to here (below the camera ray at bedside)
const ZONES = [
  { x1: -30, z1: 2, x2: -2, z2: 20 },   // lobby: entrance · reception · waiting · pharmacy · DISCHARGE
  { x1: -30, z1: -12, x2: -6, z2: 2 },  // ward: 6 rooms · corridor · staff station · ETHER door
];
export const zoneOf = (x, z) => ZONES.findIndex((s) => x >= s.x1 - 0.6 && x <= s.x2 + 0.6 && z >= s.z1 - 0.6 && z <= s.z2 + 0.6);
export const ZONE_DOORS = [{ x: -14.5, z: 2 }];

// big pale porcelain tiles with thin grout — the polished-hospital floor
function tileTexture() {
  const s = 512, n = 4, ts = s / n; // 4×4 tiles per texture → 1.2 m tiles at repeat/4.8
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const v = 226 + ((tx + ty) % 2) * 5 + Math.floor(Math.random() * 5);
      g.fillStyle = `rgb(${v - 4},${v},${v + 4})`;
      g.fillRect(tx * ts, ty * ts, ts, ts);
      // faint diagonal polish streak on some tiles
      if ((tx * 7 + ty * 3) % 5 === 0) {
        g.fillStyle = 'rgba(255,255,255,0.10)';
        g.beginPath();
        g.moveTo(tx * ts, ty * ts + ts * 0.7);
        g.lineTo(tx * ts + ts * 0.7, ty * ts);
        g.lineTo(tx * ts + ts, ty * ts);
        g.lineTo(tx * ts, ty * ts + ts);
        g.fill();
      }
    }
  }
  g.strokeStyle = 'rgba(150,160,172,0.85)';
  g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * ts, 0); g.lineTo(i * ts, s); g.stroke();
    g.beginPath(); g.moveTo(0, i * ts); g.lineTo(s, i * ts); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// pale sky + hazy skyline gradient for the window panes
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#bfd9ee');
  grd.addColorStop(0.62, '#dcebf5');
  grd.addColorStop(1, '#c8d4dc');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildMap(scene, physics) {
  const statics = new THREE.Group();
  scene.add(statics);
  const tex = tileTexture();

  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(100, 80), mat(0x8f979f));
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
  // zone-tinted tile: warm lobby, cool ward, mint lab wing, lilac discharge —
  // pale enough to read as one polished floor, tinted enough to wayfind
  const FLOOR_TINTS = [0xf1ebdd, 0xdfe7f1, 0xdfece5, 0xe8e1f0];
  ZONES.forEach((s, zi) => {
    const w = s.x2 - s.x1, d = s.z2 - s.z1;
    const m = new THREE.MeshStandardMaterial({ map: tex.clone(), roughness: 0.5, metalness: 0.06 });
    m.color.setHex(FLOOR_TINTS[zi]);
    m.map.repeat.set(w / 4.8, d / 4.8);
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
  // opts: tall (full height), win (window band — exterior tall walls only),
  // fade (can hide the player from the chase cam → Game fades it), glass
  // (cutaway wall gets the transparent upper), jambs (wood door posts at gaps)
  const wallSegs = [];
  const jambSpots = [];   // [x, z] wood posts at cutaway doorways
  const hwall = (z, x1, x2, gaps = [], opts = {}) => addWall(true, z, x1, x2, gaps, opts);
  const vwall = (x, z1, z2, gaps = [], opts = {}) => addWall(false, x, z1, z2, gaps, opts);
  function addWall(horiz, at, a, b, gaps, opts) {
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
    for (const [s, e] of spans) if (e - s > 0.01) wallSegs.push({ horiz, at, s, e, ...opts });
    if (opts.jambs) {
      for (const gp of gaps) {
        for (const side of [-1, 1]) {
          const j = gp.at + side * (gp.w / 2 + 0.09);
          jambSpots.push(horiz ? [j, at] : [at, j]);
        }
      }
    }
  }

  // Z1 triage — z=20 is the camera-side face: cutaway (no glass here — the
  // camera often sits behind it, and tinted panes in the lens get old fast)
  hwall(20, -30, -2);
  vwall(-30, 2, 20, [{ at: 10, w: 3.4 }], { tall: true, win: true, face: 1 });   // ENTRANCE
  hwall(2, -30, -2, [{ at: -14.5, w: 5 }], { jambs: true });                     // Z1/Z2 door
  vwall(-2, 2, 20, [], { tall: true, win: true, face: -1 });
  // Z2 rooms 1–6 (doors face south into the corridor) + the ETHER wall east
  hwall(-12, -30, -6, [], { tall: true, win: true, face: 1 });                   // rooms' north window wall
  vwall(-30, -12, 2, [], { tall: true, win: true, face: 1 });                    // west exterior wall
  hwall(-7, -30, -6, [-28, -24, -20, -16, -12, -8].map((x) => ({ at: x, w: 2.2 })), { glass: true, jambs: true });
  [-26, -22, -18, -14, -10].forEach((x) => vwall(x, -12, -7, [], { tall: true })); // room dividers
  // east wall of the ward: SOLID (no physics gap) so you can't follow staff
  // into the ether — the automatic double-door is rendered on it (see below)
  vwall(-6, -12, 2, [], { tall: true });
  hwall(2, -6, -2);                                                              // caps the SE corner behind the ether wall

  // far-west backstop only — well past the discharge/entrance lot so it never
  // blocks the walk-in path (that lot at z~10 must stay open both ways)
  physics.staticBox(-37, 1.5, 10, 0.2, 1.5, 16);    // x=-37, clear of spawn (-32.5) and gate (-33)

  const wallMat = mat(0xf2f1ee);
  const bandMat = mat(0x5d99b0);
  const wainsMat = mat(0xc2d0da);
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  // fade groups: each wall that can stand between the chase cam and the
  // player gets its own {meshes, mats, when} — Game ghosts it when when(pos)
  const fadeGroups = {
    z4wall: { meshes: [], mats: [], when: (p) => p.z < -11.6 && p.x > 1.7 }, // rooms 9-10 / discharge shared wall
    gate: { meshes: [], mats: [], when: (p) => p.z < -23.6 },                // the EXIT wall, if you wander out
  };
  // fading segments need their own (transparent-capable) material clones
  const fadeMatOf = (groupKey, base) => {
    const m = base.clone();
    m.transparent = true;
    fadeGroups[groupKey].mats.push(m);
    return m;
  };
  for (const w of wallSegs) {
    const len = w.e - w.s, mid = (w.s + w.e) / 2;
    const H = w.tall ? TALL_H : WALL_H;
    const m = new THREE.Mesh(wallGeo, w.fade ? fadeMatOf(w.fade, wallMat) : wallMat);
    const band = new THREE.Mesh(wallGeo, w.fade ? fadeMatOf(w.fade, bandMat) : bandMat);
    const wains = new THREE.Mesh(wallGeo, w.fade ? fadeMatOf(w.fade, wainsMat) : wainsMat); // lower wainscot panel
    if (w.horiz) {
      m.scale.set(len, H, 0.3); m.position.set(mid, H / 2, w.at);
      band.scale.set(len, 0.1, 0.34); band.position.set(mid, 0.64, w.at);
      wains.scale.set(len, 0.46, 0.35); wains.position.set(mid, 0.24, w.at);
      physics.staticBox(mid, H / 2, w.at, len / 2, H / 2, 0.15);
    } else {
      m.scale.set(0.3, H, len); m.position.set(w.at, H / 2, mid);
      band.scale.set(0.34, 0.1, len); band.position.set(w.at, 0.64, mid);
      wains.scale.set(0.35, 0.46, len); wains.position.set(w.at, 0.24, mid);
      physics.staticBox(w.at, H / 2, mid, 0.15, H / 2, len / 2);
    }
    m.castShadow = true;
    statics.add(m, band, wains);
    if (w.fade) fadeGroups[w.fade].meshes.push(m, band, wains);
  }

  // wall caps: white rail on the cutaway tier, ceiling-line soffit on the tall
  // tier — one InstancedMesh each, so the whole trim package is two draw calls
  {
    const lows = wallSegs.filter((w) => !w.tall);
    const talls = wallSegs.filter((w) => w.tall && !w.fade);
    const capOf = (list, color, h, y, wide) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(color), list.length);
      const m4 = new THREE.Matrix4();
      list.forEach((w, i) => {
        const len = w.e - w.s + (w.horiz ? 0 : 0), mid = (w.s + w.e) / 2;
        if (w.horiz) m4.makeScale(len + 0.1, h, wide), m4.setPosition(mid, y, w.at);
        else m4.makeScale(wide, h, len + 0.1), m4.setPosition(w.at, y, mid);
        im.setMatrixAt(i, m4);
      });
      statics.add(im);
      return im;
    };
    capOf(lows, 0xf8f8f5, 0.1, WALL_H + 0.04, 0.42);
    capOf(talls, 0x8fa3b2, 0.16, TALL_H + 0.06, 0.4);
    // the fading segments' soffits join their fade groups
    for (const w of wallSegs.filter((s) => s.tall && s.fade)) {
      const len = w.e - w.s, mid = (w.s + w.e) / 2;
      const cap = new THREE.Mesh(wallGeo, fadeMatOf(w.fade, mat(0x8fa3b2)));
      if (w.horiz) { cap.scale.set(len + 0.1, 0.16, 0.4); cap.position.set(mid, TALL_H + 0.06, w.at); }
      else { cap.scale.set(0.4, 0.16, len + 0.1); cap.position.set(w.at, TALL_H + 0.06, mid); }
      statics.add(cap);
      fadeGroups[w.fade].meshes.push(cap);
    }
  }

  // door headers over the tall-wall gaps → real doorways, not missing teeth
  const headerMat = mat(0xf2f1ee);
  for (const w0 of [
    { horiz: false, at: -30, gap: { at: 10, w: 3.4 } },
    { horiz: false, at: -6, gap: { at: -5.5, w: 2.6 } },
    { horiz: true, at: -12, gap: { at: 8.5, w: 4.4 }, fade: 'z4wall' },
    { horiz: true, at: -24, gap: { at: 5, w: 3 }, fade: 'gate' },
  ]) {
    const h = TALL_H - 2.05;
    const head = new THREE.Mesh(wallGeo, w0.fade ? fadeMatOf(w0.fade, headerMat) : headerMat);
    if (w0.horiz) { head.scale.set(w0.gap.w + 0.2, h, 0.32); head.position.set(w0.gap.at, 2.05 + h / 2, w0.at); }
    else { head.scale.set(0.32, h, w0.gap.w + 0.2); head.position.set(w0.at, 2.05 + h / 2, w0.gap.at); }
    head.castShadow = true;
    statics.add(head);
    if (w0.fade) fadeGroups[w0.fade].meshes.push(head);
  }

  // glowing wayfinding signs on the doorways
  const signText = (txt, bg, fg = '#eafff2') => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 256, 64);
    g.fillStyle = fg;
    g.font = 'bold 30px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, 128, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t });
  };
  const addSign = (x, y, z, rotY, txt, bg, wdt = 1.7, fade = false, fg = '#eafff2') => {
    const bgMat = fade ? fadeMatOf(fade, mat(0x2c3540)) : mat(0x2c3540);
    const bgMesh = new THREE.Mesh(new THREE.BoxGeometry(wdt + 0.08, 0.5, 0.08), bgMat);
    bgMesh.position.set(x, y, z); bgMesh.rotation.y = rotY;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(wdt, 0.42), signText(txt, bg, fg));
    face.position.set(x, y, z).add(new THREE.Vector3(Math.sin(rotY) * 0.05, 0, Math.cos(rotY) * 0.05));
    face.rotation.y = rotY;
    statics.add(bgMesh, face);
    if (fade) { fadeGroups[fade].meshes.push(bgMesh, face); face.material.transparent = true; fadeGroups[fade].mats.push(face.material); }
  };
  addSign(-29.78, 2.5, 10, Math.PI / 2, '＋ EMERGENCY', '#a03028', 2.6, false, '#ffe9e6');
  addSign(-6.18, 2.3, -5.5, -Math.PI / 2, '⚕ STAFF ONLY', '#4a4f5e', 1.9); // over the ether door
  addSign(-29.78, 2.2, 6.5, Math.PI / 2, '🏠 DISCHARGE', '#2e6e3e', 2.0); // west wall by the entrance

  // wood door jambs at every cutaway doorway (single InstancedMesh)
  {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 1.62, 0.18), mat(0xb98d5f), jambSpots.length);
    const m4 = new THREE.Matrix4();
    jambSpots.forEach(([x, z], i) => {
      m4.makeTranslation(x, 0.81, z);
      im.setMatrixAt(i, m4);
    });
    im.castShadow = true;
    statics.add(im);
  }

  // glass uppers over the cutaway walls — one merged transparent mesh, plus a
  // single InstancedMesh of white mullion posts. Architecture reads full
  // height; the camera sees straight through.
  {
    const pos = [], idx = [];
    const trims = []; // {x, z, sx, sz, sy, y}
    for (const w of wallSegs) {
      if (!w.glass) continue;
      const y0 = WALL_H + 0.1, y1 = GLASS_TOP;
      const b = pos.length / 3;
      if (w.horiz) pos.push(w.s, y0, w.at, w.e, y0, w.at, w.e, y1, w.at, w.s, y1, w.at);
      else pos.push(w.at, y0, w.s, w.at, y0, w.e, w.at, y1, w.e, w.at, y1, w.s);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      const len = w.e - w.s, mid = (w.s + w.e) / 2;
      const postH = GLASS_TOP - WALL_H - 0.04;
      for (const t of [w.s + 0.05, w.e - 0.05]) { // end posts only — they read as door trim
        trims.push(w.horiz
          ? { x: t, z: w.at, sx: 0.09, sy: postH, sz: 0.09, y: (WALL_H + GLASS_TOP) / 2 + 0.03 }
          : { x: w.at, z: t, sx: 0.09, sy: postH, sz: 0.09, y: (WALL_H + GLASS_TOP) / 2 + 0.03 });
      }
      trims.push(w.horiz
        ? { x: mid, z: w.at, sx: len, sy: 0.09, sz: 0.09, y: GLASS_TOP + 0.02 }
        : { x: w.at, z: mid, sx: 0.09, sy: 0.09, sz: len, y: GLASS_TOP + 0.02 });
    }
    const glassGeo = new THREE.BufferGeometry();
    glassGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    glassGeo.setIndex(idx);
    const glass = new THREE.Mesh(glassGeo, new THREE.MeshBasicMaterial({
      color: 0xcfe4ef, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
    }));
    glass.renderOrder = 3;
    statics.add(glass);
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0xf5f6f3), trims.length);
    const m4 = new THREE.Matrix4();
    trims.forEach((t, i) => {
      m4.makeScale(t.sx, t.sy, t.sz);
      m4.setPosition(t.x, t.y, t.z);
      im.setMatrixAt(i, m4);
    });
    statics.add(im);
  }

  // windows in the tall exterior walls: sky panes + white mullion frames —
  // one merged pane mesh + one InstancedMesh of frame bars
  {
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTexture() });
    const panes = [];       // {x,z,rotY,w,h}
    const WIN_W = 1.5, WIN_H = 0.95, WIN_Y = 1.78, STRIDE = 2.2;
    for (const w of wallSegs) {
      if (!w.win) continue;
      const len = w.e - w.s;
      const n = Math.floor(len / STRIDE);
      if (n < 1) continue;
      const start = (w.s + w.e) / 2 - ((n - 1) * STRIDE) / 2;
      for (let i = 0; i < n; i++) {
        const t = start + i * STRIDE;
        if (w.horiz) panes.push({ x: t, z: w.at + 0.17 * (w.face ?? 1), rotY: (w.face ?? 1) > 0 ? 0 : Math.PI });
        else panes.push({ x: w.at + 0.17 * (w.face ?? 1), z: t, rotY: (w.face ?? 1) > 0 ? Math.PI / 2 : -Math.PI / 2 });
      }
    }
    const paneGeo = new THREE.PlaneGeometry(WIN_W, WIN_H);
    const merged = [];
    const frameIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0xf5f6f3), panes.length * 4);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eul = new THREE.Euler();
    let fi = 0;
    for (const p of panes) {
      const g = paneGeo.clone();
      g.rotateY(p.rotY);
      g.translate(p.x, WIN_Y, p.z);
      merged.push(g);
      eul.set(0, p.rotY, 0); q.setFromEuler(eul);
      const bars = [
        [WIN_W + 0.14, 0.1, 0.1, 0, WIN_H / 2 + 0.04],   // header
        [WIN_W + 0.14, 0.12, 0.14, 0, -WIN_H / 2 - 0.05], // sill
        [0.1, WIN_H + 0.12, 0.1, -WIN_W / 2 - 0.04, 0],
        [0.1, WIN_H + 0.12, 0.1, WIN_W / 2 + 0.04, 0],
      ];
      for (const [sx, sy, sz, ox, oy] of bars) {
        const off = new THREE.Vector3(ox, oy, 0.01).applyQuaternion(q);
        // q already swings local-x along the wall — scale stays in local axes
        m4.compose(new THREE.Vector3(p.x + off.x, WIN_Y + oy, p.z + off.z), q, new THREE.Vector3(sx, sy, sz));
        frameIM.setMatrixAt(fi++, m4);
      }
    }
    frameIM.count = fi;
    statics.add(frameIM);
    if (merged.length) {
      // manual merge: concat positions/uvs/indices
      const tot = new THREE.BufferGeometry();
      let vt = 0;
      const ps = [], uvs = [], ix = [];
      for (const g of merged) {
        const pa = g.getAttribute('position'), ua = g.getAttribute('uv');
        for (let i = 0; i < pa.count; i++) { ps.push(pa.getX(i), pa.getY(i), pa.getZ(i)); uvs.push(ua.getX(i), ua.getY(i)); }
        const gi = g.getIndex();
        for (let i = 0; i < gi.count; i++) ix.push(gi.getX(i) + vt);
        vt += pa.count;
      }
      tot.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3));
      tot.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      tot.setIndex(ix);
      statics.add(new THREE.Mesh(tot, skyMat));
    }
  }

  // the city outside — pale flat silhouettes past the windows, far enough
  // that they read as skyline, not floating crates on the glass
  {
    const N = 26;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }), N); // unlit — hazy backdrop
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    const spots = [];
    for (let i = 0; i < 9; i++) spots.push([-46 - (i % 3) * 8, -30 + i * 7]);         // west block
    for (let i = 0; i < 9; i++) spots.push([-38 + i * 8.5, -44 - (i % 3) * 8]);       // north block
    for (let i = 0; i < 8; i++) spots.push([28 + (i % 3) * 8, -26 + i * 7]);          // east block
    spots.slice(0, N).forEach(([x, z], i) => {
      const h = 5 + ((i * 37) % 10);
      const w = 5 + ((i * 13) % 7);
      m4.makeScale(w, h, w);
      m4.setPosition(x, h / 2 - 0.2, z);
      im.setMatrixAt(i, m4);
      col.setHex(i % 3 === 0 ? 0xb4c2cd : i % 3 === 1 ? 0xc0ccd6 : 0xccd6de);
      im.setColorAt(i, col);
    });
    statics.add(im);
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
    stripe(-18, -5.3, 24, 0.16, 0xd8564a);   // red guide line down the room fronts
    stripe(-7.2, -5.5, 0.16, 3.0, 0x4a4f5e); // grey turns to the STAFF-ONLY ether door
    stripe(-14.5, -1.5, 0.16, 7.1, 0xd8564a); // red feeds up through the triage door
    stripe(-20, 4.6, 0.16, 5.0, 0x4bb35f);   // green leads to the discharge exit
  }

  // ---- the ten patient rooms: bed + desk each, numbered ----
  const beds = [];
  const roomMonitors = [];
  const roomDesks = [];
  const roomLights = [];
  const ROOM_X = [-28, -24, -20, -16, -12, -8];
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
    // bedside cabinet: white body, wood top, drawer line — not a crate
    const cabBody = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.7, 0.55), mat(0xe9e6dd));
    cabBody.position.set(cx + 1.05, 0.35, -10.6);
    cabBody.castShadow = true;
    const cabTop = new THREE.Mesh(new THREE.BoxGeometry(1.03, 0.06, 0.62), mat(0xb98d5f));
    cabTop.position.set(cx + 1.05, 0.75, -10.6);
    const cabLine = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.03, 0.02), mat(0x8a8f98));
    cabLine.position.set(cx + 1.05, 0.42, -10.31);
    statics.add(cabBody, cabTop, cabLine);
    physics.staticBox(cx + 1.05, 0.39, -10.6, 0.5, 0.39, 0.3);
    roomDesks.push({ x: cx + 1.05, z: -10.6, y: 0.82, roomNo: i + 1, clipboard: null });
    // wall monitor: a REAL screen — canvas texture the Monitors system paints
    const monCanvas = document.createElement('canvas');
    monCanvas.width = 256; monCanvas.height = 160;
    const monTex = new THREE.CanvasTexture(monCanvas);
    monTex.colorSpace = THREE.SRGBColorSpace;
    const monG = new THREE.Group();
    monG.position.set(cx - 0.7, 1.02, -11.72);
    monG.rotation.x = -0.46; // tilted mount, angled at the chase camera
    const monFrame = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.84, 0.06), mat(0x232d3a));
    const monScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 0.72),
      new THREE.MeshBasicMaterial({ map: monTex }));
    monScreen.position.z = 0.034;
    monG.add(monFrame, monScreen);
    statics.add(monG);
    roomMonitors.push({ index: i, roomNo: i + 1, canvas: monCanvas, tex: monTex, screen: monScreen, standby: false });
    // status light over the door — on a stem so it reads as a fixture
    const lightMat = new THREE.MeshStandardMaterial({ color: 0x8a94a4, emissive: 0x8a94a4, emissiveIntensity: 0.25, roughness: 0.4 });
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.06), mat(0x5b6874));
    stem.position.set(cx, WALL_H + 0.12, -7);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lightMat);
    light.position.set(cx, WALL_H + 0.34, -7);
    statics.add(stem, light);
    roomLights.push({ mesh: light, mat: lightMat });
    // status board over the bed (reference's check-board) — shares the door
    // light's material, so it flips green/orange/red in sync for free
    const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.05), mat(0xf5f6f3));
    boardFrame.position.set(cx - 0.7, 2.0, -11.8);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.28), lightMat);
    board.position.set(cx - 0.7, 2.0, -11.77);
    statics.add(boardFrame, board);
  });

  // ---- triage: reception + waiting + KNOCKABLE props ----
  const seats = [];
  for (let i = 0; i < 8; i++) {
    // rows sit clear of the reception counter (which runs x −26.1…−22.3 at
    // z 9.55…10.25) — the old front row put chair #1 inside the desk
    const x = -23.5 + (i % 4) * 2.1, z = 11.7 + Math.floor(i / 4) * 2.2;
    const c = makeChair();
    c.position.set(x, 0, z);
    statics.add(c);
    seats.push({ x, z, taken: null });
  }
  // wood gang-beams under the chair rows — reference waiting rows
  for (const rz of [11.7, 13.9]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.09, 0.14), mat(0x8a6742));
    beam.position.set(-20.35, 0.16, rz + 0.1);
    statics.add(beam);
  }
  // ---- reception: a REAL front desk — wood counter run + side return, stone
  // top with an overhang, accent kick, work surface with monitor/keyboard/
  // papers, and a receptionist parked behind it (rig added by the Game).
  const counterBase = mat(0xb98d5f), counterTop = mat(0xefece2), kick = mat(0x8a6742);
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

  // departure-style ED status board high on the lobby's east wall + a self
  // check-in kiosk under it — straight out of the reference lobby
  {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 192;
    const g = c.getContext('2d');
    g.fillStyle = '#101a26'; g.fillRect(0, 0, 512, 192);
    g.fillStyle = '#1c2d40'; g.fillRect(0, 0, 512, 40);
    g.fillStyle = '#ffd76a';
    g.font = 'bold 24px monospace';
    g.fillText('MEDTEAM GENERAL — ED STATUS', 16, 28);
    const rows = [
      ['TRIAGE', 'OPEN', '#59e07a'], ['WAIT TIME', '12 MIN', '#ffd76a'],
      ['ROOMS', '10 · ALL WINGS', '#59e07a'], ['LAB / IMAGING', 'NORMAL', '#59e07a'],
      ['TRAUMA', 'STAND BY', '#ff7a5c'],
    ];
    g.font = 'bold 19px monospace';
    rows.forEach(([k, v, col], i) => {
      const y = 66 + i * 26;
      g.fillStyle = '#9fb4c8'; g.fillText(k, 24, y);
      g.fillStyle = col; g.fillText(v, 280, y);
      g.beginPath(); g.arc(262, y - 6, 5, 0, 7); g.fillStyle = col; g.fill();
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.24, 3.3), mat(0x232a36));
    frame.position.set(-2.16, 2.0, 11);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(3.16, 1.12),
      new THREE.MeshBasicMaterial({ map: t }));
    face.position.set(-2.22, 2.0, 11);
    face.rotation.y = -Math.PI / 2;
    statics.add(frame, face);
    // kiosk
    const kioskBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.35, 0.5), mat(0xeef1f5));
    kioskBody.position.set(-4.4, 0.675, 12); kioskBody.castShadow = true;
    const kioskScr = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.34), emat(0x8fd8c9, 0.7));
    kioskScr.position.set(-4.68, 1.18, 12); kioskScr.rotation.y = -Math.PI / 2; kioskScr.rotation.z = 0;
    const kioskBand = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.12, 0.52), mat(0x5d99b0));
    kioskBand.position.set(-4.4, 1.41, 12);
    statics.add(kioskBody, kioskScr, kioskBand);
    physics.staticBox(-4.4, 0.675, 12, 0.3, 0.675, 0.28);
    shadowBlob(-4.4, 12, 1.2, 1.1, 0.26);
  }

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
  // framed health posters on the tall walls
  {
    const posterAt = (x, y, z, rotY, color) => {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.9, 0.04), mat(0xf5f6f3));
      fr.position.set(x, y, z); fr.rotation.y = rotY;
      const art = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.78), mat(color));
      art.position.set(x + Math.sin(rotY) * 0.03, y, z + Math.cos(rotY) * 0.03);
      art.rotation.y = rotY;
      const strip1 = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.05), mat(0xf5f6f3));
      strip1.position.set(x + Math.sin(rotY) * 0.04, y - 0.18, z + Math.cos(rotY) * 0.04);
      strip1.rotation.y = rotY;
      statics.add(fr, art, strip1);
    };
    posterAt(-29.8, 1.75, 5.6, Math.PI / 2, 0x5d99b0);   // by the entrance
    posterAt(-29.8, 1.75, 16.4, Math.PI / 2, 0xd8564a);
    posterAt(-5.82, 1.8, -2.5, Math.PI / 2, 0x3f9d8a);   // corridor wall
    posterAt(13.8, 1.8, -18, -Math.PI / 2, 0x4bb35f);    // discharge hall
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
  // Six seats in one row at 1.1 m spacing: the four staff in the middle, and a
  // free chair at each END for YOU, one per terminal. The desk was widened to
  // carry them.
  const desk = makeDesk(6.1);
  desk.position.set(-15.85, 0, -1.2);
  statics.add(desk);
  physics.staticBox(-15.85, 0.45, -1.2, 3.05, 0.45, 0.55);
  shadowBlob(-15.85, -1.2, 6.9, 1.8, 0.26);
  // the nurses' station: idle staff SIT here (in wheeled office chairs) until
  // dispatched. Evenly spaced across the desk, chairs aligned exactly under
  // each seat so nobody clips or clusters, all facing the desk.
  const staffSeats = {
    aide: { x: -17.5, z: -0.2, yaw: Math.PI },
    surgeon: { x: -16.4, z: -0.2, yaw: Math.PI },
    porter: { x: -15.3, z: -0.2, yaw: Math.PI },
    tech: { x: -14.2, z: -0.2, yaw: Math.PI },
  };
  for (const key of ['aide', 'surgeon', 'porter', 'tech']) {
    const s = staffSeats[key];
    const c = makeOfficeChair(Math.PI); // seat faces the desk (staff face -z)
    // nudge the chair BEHIND the occupant so the backrest is at their back
    // instead of running through their chest
    c.position.set(s.x, 0, s.z + 0.16);
    statics.add(c);
    shadowBlob(s.x, s.z + 0.1, 0.85, 0.85, 0.24);
  }
  // MED-DOC 4000: green-phosphor consult terminal on the desk's east end.
  // rotation 0 puts the screen face on +z — which is where the camera lives,
  // so you can actually READ it, and it's also the side the chairs are on.
  const crt = new THREE.Group();
  const crtCase = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.48, 0.5), mat(0xd8d2bd));
  crtCase.position.y = 0.24;
  crtCase.castShadow = true;
  const crtScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), emat(0x39ff6e, 0.75));
  crtScreen.position.set(0, 0.26, 0.258);
  const crtKeys = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.2), mat(0xbfb9a4));
  crtKeys.position.set(0, 0.03, 0.42);
  const crtLed = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), emat(0x39ff6e, 1.4).clone());
  crtLed.position.set(-0.22, 0.06, 0.26);
  crt.add(crtCase, crtScreen, crtKeys, crtLed);
  crt.position.set(-13.1, 0.9, -1.3);
  crt.rotation.y = 0;        // screen toward the camera (and toward the chair)
  crt.scale.setScalar(2.1);  // ABSURDLY large — you can read it from the door
  statics.add(crt);
  // sit HERE to use it (the arcade cabinet of the ED)
  const medDoc = { x: -13.1, z: -0.2, yaw: Math.PI, kind: 'meddoc' };

  // TRIAGE terminal: MED-DOC's blue twin on the desk's west end
  const crt2 = new THREE.Group();
  const crt2Case = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.48, 0.5), mat(0xc9cfd8));
  crt2Case.position.y = 0.24;
  crt2Case.castShadow = true;
  const crt2Screen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), emat(0x4aa8ff, 0.75));
  crt2Screen.position.set(0, 0.26, 0.258);
  const crt2Keys = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.2), mat(0xb2b8c2));
  crt2Keys.position.set(0, 0.03, 0.42);
  const crt2Led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), emat(0x4aa8ff, 1.4).clone());
  crt2Led.position.set(-0.22, 0.06, 0.26);
  crt2.add(crt2Case, crt2Screen, crt2Keys, crt2Led);
  crt2.position.set(-18.6, 0.9, -1.3);
  crt2.rotation.y = 0;
  crt2.scale.setScalar(2.1); // matching giant twin
  statics.add(crt2);
  const triagePC = { x: -18.6, z: -0.2, yaw: Math.PI, kind: 'triage' };
  // a free chair at each terminal, matching the staff row
  for (const s of [medDoc, triagePC]) {
    const c = makeOfficeChair(Math.PI);
    c.position.set(s.x, 0, s.z + 0.16);
    statics.add(c);
    shadowBlob(s.x, s.z + 0.1, 0.85, 0.85, 0.24);
  }
  const termSeats = [medDoc, triagePC];
  const stationLights = [
    { mesh: crtLed, mat: crtLed.material, phase: 0 },
    { mesh: crt2Led, mat: crt2Led.material, phase: 1.6 },
  ];

  // when dispatched they round the desk via a fixed lane, then sprint
  // lanes bow NORTH around the seated row first, then round the desk end —
  // running along the row itself just body-checks your seated colleagues
  // the lanes clear the WIDENED desk — running them at the old x now walks
  // staff straight through the counter
  const stationExit = {
    west: [{ x: -19.8, z: 0.9 }, { x: -19.6, z: -2.7 }],
    east: [{ x: -12.3, z: 0.9 }, { x: -12.3, z: -2.7 }],
  };

  // ---- THE ETHER DOOR (east wall of the ward) ----
  // Labs, imaging and surgery no longer have rooms on the floor. Staff run
  // through this automatic double-door into the back-of-house "ether" (which
  // you can't enter) and return with results — or with the patient, scanned.
  // Frame + two sliding leaves; the Game slides them open as staff approach.
  const etherDoor = { x: -6, z: -5.5, w: 2.6 };            // the door's spot on the x=-6 wall
  const etherHold = { x: -4.0, z: -5.5 };                  // offstage parking (east of the wall, hidden)
  {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.15, etherDoor.w + 0.5), mat(0x3a4250));
    frame.position.set(-6, 1.07, -5.5); statics.add(frame);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, etherDoor.w + 0.6), mat(0x2c3340));
    lintel.position.set(-6, 2.05, -5.5); statics.add(lintel);
    const leaves = [];
    for (const s of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.95, etherDoor.w / 2), mat(0xcdd6e0));
      leaf.userData.base = -5.5 + s * (etherDoor.w / 4);
      leaf.userData.dir = s;
      leaf.position.set(-6.02, 1.0, leaf.userData.base);
      statics.add(leaf);
      leaves.push(leaf);
    }
    // hazard chevrons + a red "in use" lamp so it reads as a working airlock
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), emat(0xff4a4a, 0.4).clone());
    lamp.position.set(-6.14, 1.95, -5.5); statics.add(lamp);
    var etherFx = { leaves, lamp: lamp.material, openT: 0 };
  }

  // ---- DISCHARGE + INCINERATOR (compact, by the entrance / ward corner) ----
  const discharge = { x: -26.5, z: 6.2, r: 2.0 };          // walk them out the front
  const gateOut = { x: -33, z: 10 };                        // through the entrance, gone
  const firePit = { x: -8.2, z: 0.4, r: 1.3 };              // tucked in the ward's SE corner
  const pitRim = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.2, 10, 28), mat(0x5a5148));
  pitRim.rotation.x = Math.PI / 2;
  pitRim.position.set(firePit.x, 0.12, firePit.z);
  statics.add(pitRim);
  const pitHole = new THREE.Mesh(new THREE.CircleGeometry(1.25, 28), new THREE.MeshBasicMaterial({ color: 0x160a04 }));
  pitHole.rotation.x = -Math.PI / 2;
  pitHole.position.set(firePit.x, 0.02, firePit.z);
  statics.add(pitHole);
  const flames = [];
  const flameGeo = new THREE.ConeGeometry(0.3, 1.05, 7);
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(flameGeo, emat(i % 2 ? 0xff8a3c : 0xffb43c, 1.4));
    const a = (i / 5) * Math.PI * 2;
    f.position.set(firePit.x + Math.cos(a) * 0.52, 0.5, firePit.z + Math.sin(a) * 0.52);
    statics.add(f);
    flames.push(f);
  }
  const fireGlow = glowSprite(0xff7a2c, 4.4, 0.5);
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
  floorRing(-9.5, 17.6, 0xff5db0, 1.7);           // pharmacy
  floorRing(discharge.x, discharge.z, 0x4dd07a, 2.0);
  floorRing(firePit.x, firePit.z, 0xff6a2c, 1.35);
  floorRing(etherDoor.x - 0.9, etherDoor.z, 0x8aa0c0, 1.1); // the staff ether door
  floorRing(medDoc.x, medDoc.z + 0.1, 0x39ff6e, 0.85);   // the green terminal's chair
  floorRing(triagePC.x, triagePC.z + 0.1, 0x4aa8ff, 0.85); // …and the blue one's

  const dropRing = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.3, 36),
    new THREE.MeshBasicMaterial({ color: 0x4dd07a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  dropRing.rotation.x = -Math.PI / 2;
  dropRing.material.fog = false;
  statics.add(dropRing);

  // remember which fade-group meshes actually cast shadows, so the Game can
  // switch them off while the wall is ghosted (no shadows from thin air)
  const fadeWalls = Object.values(fadeGroups);
  for (const g of fadeWalls) for (const m of g.meshes) m.userData.casts = m.castShadow;

  return {
    beds, seats, shelfUnits, rings, dropRing,
    roomDesks, roomLights, roomMonitors, knockSpots, triageDesk, receptionSeat, staffSeats, stationExit, medDoc, triagePC, termSeats,
    discharge, gateOut, firePit, fire, fadeWalls, stationLights,
    etherDoor, etherHold, etherFx,
    floorYAt: () => 0,
    zoneOf, zoneDoors: ZONE_DOORS,
    entrance: { x: -28.2, z: 10 },
    spawnOutside: { x: -32.5, z: 10 },
    insideWaypoint: { x: -26.5, z: 11 },
    nurseSpawn: { x: -17.5, z: -2.8 },
    doctorSpawn: { x: -14, z: -2.8 },
    porterSpawn: { x: -14.8, z: -0.2 },
    roomDoor: (i) => ({ x: ROOM_X[i], z: -6 }),
  };
}
