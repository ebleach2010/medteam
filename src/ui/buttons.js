import { INTENT, make } from '../intents/intents.js';

const typing = () => /INPUT|TEXTAREA/.test(document.activeElement?.tagName ?? '');

// Controls: TOGGLE grab (tap to latch sticky hands, tap again to let go) ·
// contextual CLIPBOARD peeking from the bottom edge (tap → it rises full
// screen) · ORDERS button opens the radial wheel · TACKLE · SWAP roles.
export class Buttons {
  constructor(root, game) {
    this.game = game;
    const mk = (id, ico, lbl) => {
      const b = document.createElement('button');
      b.className = 'btn'; b.id = id;
      b.innerHTML = `<span class="ico">${ico}</span><span class="lbl">${lbl}</span>`;
      root.appendChild(b);
      return b;
    };
    this.grab = mk('btn-grab', '✋', 'GRAB');
    this.orders = mk('btn-action', '📋', 'ORDERS');
    this.tackle = mk('btn-tackle', '💥', 'TACKLE');
    this.swap = mk('btn-swap', '🔄', 'SWAP');
    this.pager = mk('btn-pager', '📟', 'PAGE RN');
    this.pager.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.ui.modals.pager();
      game.audio.tap();
    });

    // the contextual clipboard, peeking up from the bottom edge — tap it and
    // the full board rises onto the screen with whatever it's offering
    this.prompt = document.createElement('button');
    this.prompt.id = 'prompt';
    this.prompt.innerHTML = '<span class="pclip"></span><span class="ptxt"></span>';
    root.appendChild(this.prompt);
    this.promptTxt = this.prompt.querySelector('.ptxt');
    this.prompt.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.enqueue(make(INTENT.ACTION, game.active.id));
      game.audio.tap();
    });

    // TOGGLE grab: tap latches the sticky hands, tap again lets go
    const toggleGrab = () => {
      const a = game.active;
      const holding = a.carrying || a.dragging || a.grabHeld;
      game.enqueue(make(holding ? INTENT.RELEASE : INTENT.GRAB, a.id));
    };
    this.grab.addEventListener('pointerdown', (e) => { e.preventDefault(); toggleGrab(); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { game.ui.modals.close(); return; } // works even while typing
      if (typing()) return; // typing in a text box must never fire game keys
      if (e.code === 'Space' && !e.repeat) toggleGrab();
      if (e.code === 'KeyE') game.enqueue(make(INTENT.ACTION, game.active.id));
      if (e.code === 'KeyQ' && !e.repeat) game.enqueue(make(INTENT.SWAP_ROLE, 0));
      if (e.code === 'KeyT' && !e.repeat) game.enqueue(make(INTENT.TACKLE, game.active.id));
      if (e.code === 'KeyP' && !e.repeat) game.ui.modals.pager();
    });
    // MacBook players get the key map on the buttons themselves
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      const hint = (btn, k) => { const l = btn.querySelector('.lbl'); if (l) l.textContent += ` (${k})`; };
      hint(this.grab, 'SPACE');
      hint(this.swap, 'Q');
      hint(this.tackle, 'T');
      hint(this.pager, 'P');
    }

    this.swap.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.enqueue(make(INTENT.SWAP_ROLE, 0));
    });
    this.tackle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.enqueue(make(INTENT.TACKLE, game.active.id));
    });

    // ORDERS wheel: opens on press, pick by dragging, commits on release
    this.orders.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.ui.wheel.open(e.clientX, e.clientY);
      try { this.orders.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    });
    this.orders.addEventListener('pointermove', (e) => game.ui.wheel.track(e.clientX, e.clientY));
    this.orders.addEventListener('pointerup', () => game.ui.wheel.commit());
    this.orders.addEventListener('pointercancel', () => game.ui.wheel.close());
  }

  update() {
    this.pager.classList.toggle('disabled', this.game.activeIdx === 0);
    const g = this.game;
    const ctx = g.actionContext(g.active);
    if (ctx) {
      this.prompt.style.display = 'flex';
      this.promptTxt.textContent = `${ctx.ico} ${ctx.label}`;
    } else {
      this.prompt.style.display = 'none';
    }
    const gl = this.grab.querySelector('.lbl');
    gl.textContent = (g.active.carrying || g.active.dragging) ? 'LET GO'
      : g.active.grabHeld ? 'STICKY…' : 'GRAB';
    const near = g.nearestPatient(g.active, 3.2, (s) => s.state === 'agitated');
    this.tackle.style.display = near ? 'flex' : 'none';
  }
}
