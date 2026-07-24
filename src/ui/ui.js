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
    // sign plates over each area, like the reference cutaway (navy; ER red)
    this.roomLabels = [
      ['TRIAGE', -24.5, 8.8, 1.6, '#3a4a5e'],
      ['WAITING', -21, 11.2, 1.4, '#3a4a5e'],
      ['PHARMACY', -9.5, 18.2, 1.6, '#7d5ba6'],
      ['STAFF STN', -16, -1.2, 1.5, '#3a4a5e'],
      ['LAB', -2.4, 0.4, 1.6, '#2f7f78'],
      ['DIAGNOSTICS', 8.5, 0.6, 1.7, '#4a5ba6'],
      ['DISCHARGE', 5, -20.5, 1.6, '#2e7d4f'],
      ['INCINERATOR', 11.3, -16.4, 1.5, '#a04a2c'],
      ...[-28, -24, -20, -16, -12, -8, -3.5, 1.5, 6.5, 11.5].map((x, i) =>
        [`ROOM ${i + 1}`, x, -7.2, 1.55, '#c0392b']),
    ].map(([text, x, z, y, bg]) => {
      const el = document.createElement('div');
      el.className = 'room-label';
      el.textContent = text;
      el.style.background = bg;
      root.appendChild(el);
      return { el, x, z, y };
    });
    // triage urgency dots hovering over patients (green → amber → red)
    this.urgency = [];
    for (let i = 0; i < 10; i++) {
      const el = document.createElement('div');
      el.className = 'urgency';
      el.style.display = 'none';
      root.appendChild(el);
      this.urgency.push(el);
    }
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

  toast(msg, cls, ms) { this.hud.toast(msg, cls, ms); }
  announce(msg, cls) { this.hud.announce(msg, cls); }

  update(dt, t) {
    this.bubbles.update(dt);
    this.buttons.update();
    this.monitors.update(t);
    this.hud.update();
    this._itemLabels();
    this._roomLabels();
    this._edgeArrows();
    this._urgencyDots();
  }

  // triage-at-a-glance: a dot over every unresolved patient, colored by how
  // close they are to disaster (deterioration timeline / patience / critical)
  _urgencyDots() {
    const g = this.game;
    let i = 0;
    for (const p of g.world.byTag('patients')) {
      if (i >= this.urgency.length) break;
      const s = p.sim;
      if (s.resolved || s.state === 'dead' || s.treated) continue;
      const t = p.body.translation();
      const sc = g.renderer.project({ x: t.x, y: t.y + 1.35, z: t.z });
      if (!sc || sc.x < 0 || sc.x > innerWidth || sc.y < 0) continue;
      const el = this.urgency[i++];
      // urgency: fraction of the way to the case's first crisis (or patience)
      const death = s.case.timeline.find((k) => k.event === 'death');
      let f;
      if (s.critical) f = 1;
      else if (death) f = Math.min(1, s.elapsed / death.t);
      else f = Math.min(1, (g.clock.minutes - s.tArrive) / (s.case.patienceMin * 1.4));
      const hue = (1 - f) * 120; // green → red
      el.style.display = 'block';
      el.style.background = `hsl(${hue | 0} 80% 52%)`;
      el.classList.toggle('crit', s.critical);
      el.style.transform = `translate(${sc.x | 0}px, ${sc.y | 0}px) translate(-50%,-50%)`;
    }
    for (; i < this.urgency.length; i++) this.urgency[i].style.display = 'none';
  }

  _roomLabels() {
    const g = this.game;
    for (const r of this.roomLabels) {
      const s = g.renderer.project({ x: r.x, y: r.y, z: r.z });
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
    const iconFor = (s) => (s.critical && s.state !== 'dead' ? '‼️' : ICON[s.state]);
    const targets = [...g.world.byTag('patients')]
      .filter((p) => iconFor(p.sim))
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
      el.querySelector('.who').textContent = iconFor(tgt.p.sim);
      el.querySelector('.dir').style.transform = `rotate(${ang}rad)`;
    }
    for (; i < this.arrows.length; i++) this.arrows[i].style.display = 'none';
  }

  // name tags on nearby loose items so you can tell tPA from a sedative mid-rummage
  _itemLabels() {
    const g = this.game, ap = g.active.pos;
    const near = [...g.world.byTag('items')]
      .filter((it) => !it.heldBy && it.itemKind !== 'prop')
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
