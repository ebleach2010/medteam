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
    this.game = game;
  }

  toast(msg, cls) { this.hud.toast(msg, cls); }

  update(dt, t) {
    this.bubbles.update(dt);
    this.buttons.update();
    this.monitors.update(t);
    this.hud.update();
    this._itemLabels();
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
