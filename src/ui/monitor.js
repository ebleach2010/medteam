// Vitals cards. Bedded patients get their card PINNED to the wall monitor at
// the far side of their room (stable, out of the way); unbedded hooked
// patients keep a floating card. Tap any card for the fullscreen readout.
const MAX = 4;

export class Monitors {
  constructor(root, game) {
    this.game = game;
    this.cards = [];
    for (let i = 0; i < MAX; i++) {
      const el = document.createElement('div');
      el.className = 'mon';
      el.style.display = 'none';
      root.appendChild(el);
      const card = { el, pt: null, nextRefresh: 0 };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (card.pt) game.ui.modals.vitalsFull(card.pt);
      });
      this.cards.push(card);
    }
  }

  update(t) {
    const g = this.game;
    const hooked = [...g.world.byTag('patients')].filter((p) => p.sim.hooked);
    const ap = g.active.pos;
    hooked.sort((a, b) => dist(a, ap) - dist(b, ap));
    for (let i = 0; i < MAX; i++) {
      const card = this.cards[i], pt = hooked[i] ?? null;
      if (!pt) { card.el.style.display = 'none'; card.pt = null; continue; }
      // bedded → anchor on the room's wall monitor; loose → follow the body
      const bed = pt.sim.bed;
      const anchor = bed
        ? { x: bed.x, y: 1.7, z: -11.8 }
        : (() => { const p = pt.body.translation(); return { x: p.x, y: p.y + 0.6, z: p.z }; })();
      const s = g.renderer.project(anchor);
      if (!s) { card.el.style.display = 'none'; continue; }
      card.el.style.display = 'block';
      if (bed) {
        // mounted on the far wall: hang DOWN from the mount point, clamped on-screen
        const x = Math.min(Math.max(s.x, 90), window.innerWidth - 90);
        const y = Math.max(s.y, 44);
        card.el.style.transform = `translate(${x | 0}px, ${y | 0}px) translate(-50%, 0)`;
      } else {
        card.el.style.transform = `translate(${(s.x + 30) | 0}px, ${(s.y - 40) | 0}px)`;
      }
      card.el.classList.toggle('alarm', pt.sim.alarming());
      if (t > card.nextRefresh || card.pt !== pt) {
        card.nextRefresh = t + 0.5;
        card.pt = pt;
        const v = pt.sim.vitals();
        const ekg = pt.sim.case.ekg ? `<i style="color:#ffd23c">${pt.sim.case.ekg}</i><br>` : '';
        card.el.innerHTML =
          `<div class="nm">${pt.sim.displayName} — ${pt.sim.state === 'dead' ? '☠' : pt.sim.case.name}</div>` +
          `HR ${v.hr}  SpO₂ ${v.spo2}%<br>BP ${v.sbp}/${v.dbp}  RR ${v.rr}<br>T ${v.temp}°C<br>${ekg}` +
          `<svg class="ekg" viewBox="0 0 100 20" preserveAspectRatio="none"><path d="${ekgPath(v.hr)}" fill="none" stroke="#38e08f" stroke-width="1.4"/></svg>` +
          '<div class="tapme">▲ tap for full screen</div>';
      }
    }
  }
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
function dist(p, a) { const t = p.body.translation(); return Math.hypot(t.x - a.x, t.z - a.z); }
