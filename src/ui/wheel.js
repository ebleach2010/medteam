import { INTENT, make } from '../intents/intents.js';

// The silent-communication radial wheel. Nurse and doctor get different
// sectors; picking one emits an ORDER intent aimed at the nearest patient.
const NURSE = [
  { id: 'labs', ico: '🩸', txt: 'CALL LABS' },
  { id: 'imaging', ico: '📷', txt: 'CALL IMAGING' },
  { id: 'surgery', ico: '🔪', txt: 'CALL SURGERY' },
  { id: 'dx', ico: '✅', txt: 'DIAGNOSE' },
  { id: 'discharge', ico: '🏠', txt: 'DISCHARGE' },
];
const DOCTOR = NURSE;
export class Wheel {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'wheel';
    root.appendChild(this.el);
    this.sectors = [];
    this.hot = -1;
    this.center = { x: 0, y: 0 };
  }

  open(cx, cy) {
    const defs = this.game.active.role === 'nurse' ? NURSE : DOCTOR;
    this.el.innerHTML = '<div class="hub"></div>';
    this.sectors = defs.map((d, i) => {
      const s = document.createElement('div');
      s.className = 'sector';
      s.innerHTML = `<span class="ico">${d.ico}</span><span class="txt">${d.txt}</span>`;
      const a = -Math.PI / 2 + (i / defs.length) * Math.PI * 2;
      s.style.transform = `translate(${Math.cos(a) * 92}px, ${Math.sin(a) * 92}px)`;
      s.dataset.id = d.id;
      this.el.appendChild(s);
      return s;
    });
    // keep it on screen
    const x = Math.min(Math.max(cx, 140), window.innerWidth - 140);
    const y = Math.min(Math.max(cy, 140), window.innerHeight - 140);
    this.center = { x, y };
    this.el.style.left = x - 130 + 'px';
    this.el.style.top = y - 130 + 'px';
    this.el.style.display = 'block';
    this.hot = -1;
  }

  track(px, py) {
    const dx = px - this.center.x, dy = py - this.center.y;
    if (Math.hypot(dx, dy) < 34) { this._setHot(-1); return; }
    const n = this.sectors.length;
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    if (a < -Math.PI / n) a += Math.PI * 2;
    this._setHot(Math.round((a / (Math.PI * 2)) * n) % n);
  }

  _setHot(i) {
    if (i === this.hot) return;
    this.sectors.forEach((s, j) => s.classList.toggle('hot', j === i));
    this.hot = i;
  }

  commit() {
    const sel = this.hot >= 0 ? this.sectors[this.hot]?.dataset.id : null;
    this.close();
    if (!sel) return;
    const g = this.game;
    const target = g.nearestPatient(g.active, 6);
    g.enqueue(make(INTENT.ORDER, g.active.id, { order: sel, patientId: target?.id ?? null }));
  }

  close() { this.el.style.display = 'none'; this.hot = -1; }
}
