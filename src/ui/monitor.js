// In-world vitals: every room's wall monitor is a REAL 3D screen (canvas
// texture on the wall mount). No floating DOM cards — the numbers live in
// the room, scale with the camera, and never clutter the screen. Tap a
// screen for the fullscreen readout.
import * as THREE from 'three';

const REFRESH = 0.5;

export class Monitors {
  constructor(root, game) {
    this.game = game;
    this.next = 0;
    // tap-to-fullscreen: a quick tap (not a joystick drag) raycast at screens
    const down = { x: 0, y: 0, t: 0 };
    window.addEventListener('pointerdown', (e) => {
      down.x = e.clientX; down.y = e.clientY; down.t = performance.now();
    });
    window.addEventListener('pointerup', (e) => {
      if (!(e.target instanceof HTMLCanvasElement)) return; // buttons/modals win
      if (performance.now() - down.t > 350) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 14) return;
      const g = this.game;
      const mons = g.map.roomMonitors ?? [];
      if (!mons.length || g.ui.modals.open) return;
      _ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      _ray.setFromCamera(_ndc, g.renderer.camera);
      const hits = _ray.intersectObjects(mons.map((m) => m.screen), false);
      if (!hits.length) return;
      const rm = mons.find((m) => m.screen === hits[0].object);
      const pt = rm && this._occupant(rm);
      if (pt) g.ui.modals.vitalsFull(pt);
    });
  }

  _occupant(rm) {
    for (const p of this.game.world.byTag('patients')) {
      if (p.sim.hooked && p.sim.bed?.index === rm.index) return p;
    }
    return null;
  }

  update(t) {
    if (t < this.next) return;
    this.next = t + REFRESH;
    for (const rm of this.game.map.roomMonitors ?? []) {
      const pt = this._occupant(rm);
      if (!pt && rm.standby) continue; // idle screens don't need repainting
      rm.standby = !pt;
      drawScreen(rm, pt, t);
      rm.tex.needsUpdate = true;
    }
  }
}
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();

function drawScreen(rm, pt, t) {
  const g = rm.canvas.getContext('2d');
  const W = rm.canvas.width, H = rm.canvas.height;
  g.fillStyle = '#0b1119';
  g.fillRect(0, 0, W, H);
  if (!pt) {
    g.strokeStyle = '#1d2a38'; g.lineWidth = 3; g.strokeRect(3, 3, W - 6, H - 6);
    g.fillStyle = '#28527a';
    g.font = 'bold 26px system-ui';
    g.textAlign = 'center';
    g.fillText(`ROOM ${rm.roomNo}`, W / 2, H / 2 - 8);
    g.fillStyle = '#1c3a56';
    g.font = '15px system-ui';
    g.fillText('· standby ·', W / 2, H / 2 + 20);
    g.textAlign = 'left';
    return;
  }
  const sim = pt.sim;
  const v = sim.vitals();
  const dead = sim.state === 'dead';
  const alarm = !dead && sim.alarming();
  if (alarm && (t % 1) < 0.5) { g.fillStyle = '#3a0f14'; g.fillRect(0, 0, W, H); }
  g.strokeStyle = alarm ? '#e6483d' : '#1d2a38';
  g.lineWidth = alarm ? 5 : 3;
  g.strokeRect(3, 3, W - 6, H - 6);
  g.fillStyle = '#cfe3f5';
  g.font = 'bold 17px system-ui';
  g.fillText(dead ? `${sim.displayName} ☠` : sim.displayName, 12, 26);
  // big numbers, monitor-style color coding
  g.font = 'bold 34px system-ui';
  g.fillStyle = '#38e08f'; g.fillText(String(v.hr), 12, 66);
  g.fillStyle = '#5ad7ff'; g.fillText(`${v.spo2}`, 96, 66);
  g.fillStyle = '#ffd23c'; g.fillText(`${v.sbp}/${v.dbp}`, 158, 66);
  g.font = '12px system-ui';
  g.fillStyle = '#2f9d68'; g.fillText('HR', 12, 80);
  g.fillStyle = '#3f93ad'; g.fillText('SpO₂', 96, 80);
  g.fillStyle = '#ad9440'; g.fillText('BP', 158, 80);
  g.font = 'bold 18px system-ui';
  g.fillStyle = '#c9d6e4';
  g.fillText(`RR ${v.rr}   T ${v.temp}°`, 12, 104);
  if (sim.case.ekg) {
    g.fillStyle = '#ffd23c'; g.font = 'italic 13px system-ui';
    g.fillText(sim.case.ekg.slice(0, 30), 130, 104);
  }
  // EKG trace along the bottom
  g.strokeStyle = dead ? '#5a6570' : '#38e08f';
  g.lineWidth = 2.5;
  g.beginPath();
  const y0 = 134, amp = 16;
  const hr = dead ? 0 : v.hr;
  if (hr <= 0) { g.moveTo(10, y0); g.lineTo(W - 10, y0); }
  else {
    const beats = Math.max(1, Math.round(hr / 30));
    const bw = (W - 20) / beats;
    let x = 10;
    g.moveTo(x, y0);
    for (let i = 0; i < beats; i++) {
      g.lineTo(x + bw * 0.3, y0);
      g.lineTo(x + bw * 0.4, y0 - amp);
      g.lineTo(x + bw * 0.5, y0 + amp * 0.8);
      g.lineTo(x + bw * 0.6, y0);
      g.lineTo(x + bw, y0);
      x += bw;
    }
  }
  g.stroke();
}

export function ekgPath(hr) {
  if (hr <= 0) return 'M0 10 L100 10';
  const beats = Math.max(1, Math.round(hr / 30));
  let d = 'M0 10', x = 0;
  const w = 100 / beats;
  for (let i = 0; i < beats; i++) {
    d += ` L${x + w * 0.3} 10 L${x + w * 0.4} 4 L${x + w * 0.5} 16 L${x + w * 0.6} 10 L${x + w} 10`;
    x += w;
  }
  return d;
}
