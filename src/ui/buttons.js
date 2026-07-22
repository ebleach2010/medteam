import { INTENT, make } from '../intents/intents.js';

// Right-thumb cluster: GRAB, context ACTION (hold ≥300ms → radial wheel),
// TACKLE (only near an agitated patient), SWAP (role toggle).
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
    this.action = mk('btn-action', '⚡', '—');
    this.tackle = mk('btn-tackle', '💥', 'TACKLE');
    this.swap = mk('btn-swap', '🔄', 'SWAP');

    this.grab.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.enqueue(make(INTENT.GRAB, game.active.id));
    });
    this.swap.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.enqueue(make(INTENT.SWAP_ROLE, 0));
    });
    this.tackle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.enqueue(make(INTENT.TACKLE, game.active.id));
    });

    // ACTION: tap = context action, hold = radial wheel
    let holdT = null, wheelOpened = false;
    this.action.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.action.setPointerCapture(e.pointerId);
      wheelOpened = false;
      holdT = setTimeout(() => {
        wheelOpened = true;
        game.ui.wheel.open(e.clientX, e.clientY);
      }, 300);
    });
    this.action.addEventListener('pointermove', (e) => {
      if (wheelOpened) game.ui.wheel.track(e.clientX, e.clientY);
    });
    const up = (e) => {
      clearTimeout(holdT);
      if (wheelOpened) { game.ui.wheel.commit(); wheelOpened = false; }
      else if (e.type === 'pointerup') game.enqueue(make(INTENT.ACTION, game.active.id));
    };
    this.action.addEventListener('pointerup', up);
    this.action.addEventListener('pointercancel', (e) => { clearTimeout(holdT); game.ui.wheel.close(); });
  }

  update() {
    const g = this.game;
    const ctx = g.actionContext(g.active);
    this.action.querySelector('.ico').textContent = ctx?.ico ?? '⚡';
    this.action.querySelector('.lbl').textContent = ctx?.label ?? '…';
    this.action.classList.toggle('disabled', !ctx);
    const gl = this.grab.querySelector('.lbl');
    gl.textContent = (g.active.carrying || g.active.dragging) ? 'DROP' : 'GRAB';
    // tackle only surfaces when someone's rampaging nearby
    const near = g.nearestPatient(g.active, 3.2, (s) => s.state === 'agitated');
    this.tackle.style.display = near ? 'flex' : 'none';
  }
}
