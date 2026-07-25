// Gold cross coins: the arcade payoff for getting a patient right.
//
// A coin spawns over the patient you just sent home, arcs up to the counter in
// the top-left, and lands with a "+1" that fades where it stood. Pure DOM —
// the coin is a CSS disc with a medical cross drawn on it, so it costs nothing
// in draw calls and stays crisp at any DPR.
const POOL = 8;

export class Coins {
  constructor(root, game) {
    this.game = game;
    this.root = root;
    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'coinfly';
      el.innerHTML = '<span class="cross">✚</span>';
      el.style.display = 'none';
      root.appendChild(el);
      this.pool.push({ el, busy: false });
    }
    this.plus = [];
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'coinplus';
      el.style.display = 'none';
      root.appendChild(el);
      this.plus.push({ el, busy: false });
    }
  }

  // where the counter sits, in screen pixels — the coin flies here
  _target() {
    const el = this.game.ui.hud?.coinEl;
    if (!el) return { x: 60, y: 24 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /**
   * @param at3 world position to launch from ({x,y,z}), or null for the
   *            counter itself (used when there's nothing on screen to point at)
   */
  fly(at3, n = 1) {
    const slot = this.pool.find((s) => !s.busy);
    const tgt = this._target();
    let from = { x: tgt.x, y: tgt.y + 90 };
    if (at3) {
      const p = this.game.renderer.project(at3);
      if (p) from = { x: p.x, y: p.y };
    }
    // the "+1", left behind at the launch point
    const ps = this.plus.find((s) => !s.busy);
    if (ps) {
      ps.busy = true;
      ps.el.textContent = `+${n}`;
      ps.el.style.display = 'block';
      ps.el.style.left = `${from.x}px`;
      ps.el.style.top = `${from.y}px`;
      ps.el.classList.remove('go');
      void ps.el.offsetWidth;      // restart the animation
      ps.el.classList.add('go');
      setTimeout(() => { ps.el.style.display = 'none'; ps.busy = false; }, 1200);
    }
    if (!slot) return;
    slot.busy = true;
    const el = slot.el;
    el.style.display = 'block';
    el.style.transition = 'none';
    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    el.style.transform = 'translate(-50%,-50%) scale(0.4) rotateY(0deg)';
    el.style.opacity = '0';
    // two hops: pop up out of the patient, then sail to the counter
    requestAnimationFrame(() => {
      el.style.transition = 'transform .22s ease-out, opacity .18s ease-out';
      el.style.transform = 'translate(-50%,-50%) scale(1.25) rotateY(180deg)';
      el.style.opacity = '1';
      el.style.top = `${from.y - 46}px`;
      setTimeout(() => {
        el.style.transition = 'left .62s cubic-bezier(.55,-0.2,.5,1), top .62s cubic-bezier(.3,.1,.5,1), transform .62s ease-in, opacity .18s ease-in .5s';
        el.style.left = `${tgt.x}px`;
        el.style.top = `${tgt.y}px`;
        el.style.transform = 'translate(-50%,-50%) scale(0.45) rotateY(1080deg)';
        el.style.opacity = '0';
        setTimeout(() => {
          el.style.display = 'none';
          slot.busy = false;
          this.game.ui.hud?.coinPop?.();
        }, 640);
      }, 240);
    });
  }
}
