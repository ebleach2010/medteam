import { Bubbles } from './bubbles.js';
import { Joystick } from './joystick.js';
import { Buttons } from './buttons.js';
import { Wheel } from './wheel.js';
import { Monitors } from './monitor.js';
import { Modals } from './modals.js';
import { HUD } from './hud.js';
import { Screens } from './screens.js';

export class UI {
  constructor(game) {
    const root = document.getElementById('ui');
    this.root = root;
    this.bubbles = new Bubbles(root, game.renderer);
    this.joystick = new Joystick(root);
    this.wheel = new Wheel(root, game);
    this.buttons = new Buttons(root, game);
    this.monitors = new Monitors(root, game);
    this.modals = new Modals(root, game);
    this.hud = new HUD(root, game);
    this.screens = new Screens(root, game);
    this.labels = []; // nearby-item name tags
    for (let i = 0; i < 6; i++) {
      const el = document.createElement('div');
      el.className = 'item-label';
      el.style.display = 'none';
      root.appendChild(el);
      this.labels.push(el);
    }
    // persistent room names on the floor — you should always know where you are
    this.roomLabels = [
      ['ICU', -21, -11], ['MED-SURGE', -7, -11], ['BIRTHPLACE', 7, -11], ['IMAGING', 21, -11],
      ['LAB', -23, 7], ['ED BAYS', -5, 4.5], ['WAITING ROOM', -5, 12],
      ['NURSE STN', 12, 8.5], ['PHARMACY', 22, 12],
    ].map(([text, x, z]) => {
      const el = document.createElement('div');
      el.className = 'room-label';
      el.textContent = text;
      root.appendChild(el);
      return { el, x, z };
    });
    // edge-of-screen pointers to patients who need you
    this.arrows = [];
    for (let i = 0; i < 3; i++) {
      const el = document.createElement('div');
      el.className = 'edge-arrow';
      el.innerHTML = '<span class="who"></span><span class="dir">➤</span>';
      root.appendChild(el);
      this.arrows.push(el);
    }
    this.game = game;
  }

  toast(msg, cls) { this.hud.toast(msg, cls); }

  update(dt, t) {
    this.bubbles.update(dt);
    this.buttons.update();
    this.monitors.update(t);
    this.hud.update();
    this._itemLabels();
    this._roomLabels();
    this._edgeArrows();
  }

  _roomLabels() {
    const g = this.game;
    for (const r of this.roomLabels) {
      const s = g.renderer.project({ x: r.x, y: 0.05, z: r.z });
      if (!s || s.x < -60 || s.x > innerWidth + 60 || s.y < 30 || s.y > innerHeight + 40) {
        r.el.style.display = 'none';
        continue;
      }
      r.el.style.display = 'block';
      r.el.style.transform = `translate(${s.x | 0}px, ${s.y | 0}px) translate(-50%,-50%)`;
    }
  }

  // patients who need attention but are off-screen get a clamped edge pointer
  _edgeArrows() {
    const g = this.game, ap = g.active.pos;
    const ICON = { arriving: '🚶', waiting: '🚶', angry: '😡', agitated: '🏃' };
    const targets = [...g.world.byTag('patients')]
      .filter((p) => ICON[p.sim.state])
      .map((p) => { const t = p.body.translation(); return { p, t, d: Math.hypot(t.x - ap.x, t.z - ap.z) }; })
      .sort((a, b) => a.d - b.d)
      .slice(0, this.arrows.length);
    const pad = 30, cx = innerWidth / 2, cy = innerHeight / 2;
    let i = 0;
    for (const tgt of targets) {
      const s = g.renderer.project({ x: tgt.t.x, y: 1, z: tgt.t.z });
      const onScreen = s && s.x > pad && s.x < innerWidth - pad && s.y > pad && s.y < innerHeight - pad;
      if (onScreen) continue; // visible — no pointer needed
      const el = this.arrows[i++];
      // top-down camera: world x → screen x, world z → screen y
      const ang = Math.atan2(tgt.t.z - ap.z, tgt.t.x - ap.x);
      const R = Math.min(cx, cy) - 46;
      const x = Math.min(Math.max(cx + Math.cos(ang) * R * 1.5, pad + 26), innerWidth - pad - 26);
      const y = Math.min(Math.max(cy + Math.sin(ang) * R * 1.05, pad + 30), innerHeight - pad - 20);
      el.style.display = 'flex';
      el.style.transform = `translate(${x | 0}px, ${y | 0}px) translate(-50%,-50%)`;
      el.querySelector('.who').textContent = ICON[tgt.p.sim.state];
      el.querySelector('.dir').style.transform = `rotate(${ang}rad)`;
    }
    for (; i < this.arrows.length; i++) this.arrows[i].style.display = 'none';
  }

  // name tags on nearby loose items so you can tell tPA from a sedative mid-rummage
  _itemLabels() {
    const g = this.game, ap = g.active.pos;
    const near = [...g.world.byTag('items')]
      .filter((it) => !it.heldBy)
      .map((it) => { const p = it.body.translation(); return { it, d: Math.hypot(p.x - ap.x, p.z - ap.z), p }; })
      .filter((x) => x.d < 3.2)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.labels.length);
    this.labels.forEach((el, i) => {
      const n = near[i];
      if (!n) { el.style.display = 'none'; return; }
      const s = g.renderer.project({ x: n.p.x, y: n.p.y + 0.35, z: n.p.z });
      if (!s) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.textContent = n.it.label;
      el.style.transform = `translate(${(s.x - 20) | 0}px, ${s.y | 0}px)`;
    });
  }
}
