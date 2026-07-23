import { INTENT, make } from '../intents/intents.js';

// Controls: HOLD grab (sticky hands) · big contextual PROMPT pill (the
// tether/rec-room "Play —" pattern) · ORDERS button opens the radial wheel
// (press, drag, release) · TACKLE near a rampage · SWAP roles.
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
    this.grab = mk('btn-grab', '✋', 'HOLD TO GRAB');
    this.orders = mk('btn-action', '📋', 'ORDERS');
    this.tackle = mk('btn-tackle', '💥', 'TACKLE');
    this.swap = mk('btn-swap', '🔄', 'SWAP');

    // the big contextual prompt — appears when the world has something to say
    this.prompt = document.createElement('button');
    this.prompt.id = 'prompt';
    root.appendChild(this.prompt);
    this.prompt.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.enqueue(make(INTENT.ACTION, game.active.id));
      game.audio.tap();
    });

    // HFF grab: HOLD to keep hands sticky, release to let go.
    // Enqueue FIRST — setPointerCapture can throw on synthetic events.
    this.grab.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.enqueue(make(INTENT.GRAB, game.active.id));
      try { this.grab.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    });
    const grabUp = (e) => { e.preventDefault(); game.enqueue(make(INTENT.RELEASE, game.active.id)); };
    this.grab.addEventListener('pointerup', grabUp);
    this.grab.addEventListener('pointercancel', grabUp);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) game.enqueue(make(INTENT.GRAB, game.active.id));
      if (e.code === 'KeyE') game.enqueue(make(INTENT.ACTION, game.active.id));
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') game.enqueue(make(INTENT.RELEASE, game.active.id));
    });

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
    const g = this.game;
    const ctx = g.actionContext(g.active);
    if (ctx) {
      this.prompt.style.display = 'flex';
      this.prompt.innerHTML = `<span>${ctx.ico}</span> ${ctx.label}`;
      this.prompt.style.borderColor = ctx.color ?? '#2f80ff';
      this.prompt.style.boxShadow = `0 6px 20px rgba(0,0,0,.45), 0 0 22px ${ctx.color ?? '#2f80ff'}66`;
    } else {
      this.prompt.style.display = 'none';
    }
    const gl = this.grab.querySelector('.lbl');
    gl.textContent = (g.active.carrying || g.active.dragging) ? 'HOLDING'
      : g.active.grabHeld ? 'STICKY…' : 'HOLD TO GRAB';
    const near = g.nearestPatient(g.active, 3.2, (s) => s.state === 'agitated');
    this.tackle.style.display = near ? 'flex' : 'none';
  }
}
