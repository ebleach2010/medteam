// Speech bubbles: pooled DOM divs projected over entity heads, fading in/out.
const POOL = 12;

export class Bubbles {
  constructor(root, renderer) {
    this.renderer = renderer;
    this.live = [];
    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'bubble';
      root.appendChild(el);
      this.pool.push(el);
    }
  }

  say(ent, text, { cls, hold = 3.5 } = {}) {
    // one bubble per entity: replace
    const existing = this.live.find((b) => b.ent === ent);
    if (existing) this._kill(existing);
    const el = this.pool.pop();
    if (!el) return;
    el.textContent = text;
    el.className = `bubble${cls ? ' ' + cls : ''}`;
    // force reflow so the .show transition replays
    void el.offsetWidth;
    el.classList.add('show');
    this.live.push({ ent, el, t: hold });
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i];
      b.t -= dt;
      if (b.t <= 0 || !b.ent.mesh.parent) { this._kill(b); continue; }
      const p = b.ent.body.translation();
      _v.x = p.x; _v.y = p.y + 1.4; _v.z = p.z;
      const s = this.renderer.project(_v, _out);
      if (!s) { b.el.style.opacity = 0; continue; }
      b.el.style.transform = `translate(${(s.x - b.el.offsetWidth / 2) | 0}px, ${(s.y - b.el.offsetHeight - 14) | 0}px)`;
      if (b.t < 0.45) b.el.classList.add('hide');
    }
  }

  _kill(b) {
    const i = this.live.indexOf(b);
    if (i >= 0) this.live.splice(i, 1);
    b.el.className = 'bubble';
    b.el.style.opacity = '';
    this.pool.push(b.el);
  }
}
const _v = { x: 0, y: 0, z: 0 };
const _out = { x: 0, y: 0 };
