import { INTENT, make } from '../intents/intents.js';
import { settings, keyLabel } from '../core/settings.js';

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
    // hold mode bookkeeping: remember WHO grabbed at press time, so the
    // release always reaches that character — even after a swap, a pause, a
    // drag off the button, or a cancelled touch
    this.grab.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (settings.grabMode === 'hold') {
        this._btnGrabber = game.active;
        try { this.grab.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
        game.enqueue(make(INTENT.GRAB, game.active.id));
      } else toggleGrab();
    });
    const btnRelease = () => {
      if (!this._btnGrabber) return;
      game.enqueue(make(INTENT.RELEASE, this._btnGrabber.id));
      this._btnGrabber = null;
    };
    this.grab.addEventListener('pointerup', btnRelease);
    this.grab.addEventListener('pointercancel', btnRelease);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { // works even while typing
        if (game.ui.modals.open) game.ui.modals.close();
        else if (game.ui.wheel.isOpen) game.ui.wheel.close();
        else if (game.mode === 'playing') game.ui.modals.pauseMenu();
        return;
      }
      if (typing()) return; // typing in a text box must never fire game keys
      if (game.paused || e.repeat) return;
      const k = settings.keys;
      if (e.code === k.grab) {
        if (settings.grabMode === 'hold') {
          this._keyGrabber = game.active;
          game.enqueue(make(INTENT.GRAB, game.active.id));
        } else toggleGrab();
      }
      if (e.code === k.action || e.code === 'Space') game.enqueue(make(INTENT.ACTION, game.active.id));
      if (e.code === k.wheel) {
        if (settings.wheelMode === 'hold') {
          const w = game.ui.wheel;
          if (!w.isOpen && game.mode === 'playing' && !game.ui.modals.open) {
            w.open(window.innerWidth / 2, window.innerHeight / 2);
            w.stay(); // mouse highlights sectors while the key is down
          }
        } else game.ui.wheel.toggle();
      }
      if (e.code === k.swap) game.enqueue(make(INTENT.SWAP_ROLE, 0));
      if (e.code === k.tackle) game.enqueue(make(INTENT.TACKLE, game.active.id));
      if (e.code === k.pager) game.ui.modals.pager();
    });
    window.addEventListener('keyup', (e) => {
      const k = settings.keys;
      // a held grab must ALWAYS let go on keyup — even if a pause menu or a
      // text box swallowed the moment, and aimed at whoever pressed the key
      if (e.code === k.grab && this._keyGrabber) {
        game.enqueue(make(INTENT.RELEASE, this._keyGrabber.id));
        this._keyGrabber = null;
      }
      if (typing() || game.paused) return;
      if (e.code === k.wheel && settings.wheelMode === 'hold' && game.ui.wheel.isOpen) game.ui.wheel.commit();
    });
    window.addEventListener('blur', () => { // cmd-tab mid-hold: let go
      if (this._keyGrabber) { game.enqueue(make(INTENT.RELEASE, this._keyGrabber.id)); this._keyGrabber = null; }
    });
    // MacBook players get the (rebindable) key map on the buttons themselves
    this._hints = matchMedia('(hover: hover) and (pointer: fine)').matches;
    this.refreshHints();

    this.swap.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.enqueue(make(INTENT.SWAP_ROLE, 0));
    });
    this.tackle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.enqueue(make(INTENT.TACKLE, game.active.id));
    });

    // ORDERS wheel: quick click TOGGLES it (mouse then highlights, next click
    // commits); a long press-drag-release still works like the old hold wheel
    this.orders.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (game.ui.wheel.isOpen) { game.ui.wheel.commit(); return; }
      this._wheelT = performance.now();
      game.ui.wheel.open(e.clientX, e.clientY);
      try { this.orders.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    });
    this.orders.addEventListener('pointermove', (e) => game.ui.wheel.track(e.clientX, e.clientY));
    this.orders.addEventListener('pointerup', () => {
      const held = performance.now() - (this._wheelT ?? 0);
      if (held > 350 || game.ui.wheel.hot >= 0) game.ui.wheel.commit(); // classic hold-drag
      else game.ui.wheel.stay(); // quick tap → toggle mode, wheel stays up
    });
    this.orders.addEventListener('pointercancel', () => game.ui.wheel.close());
  }

  // repaint key hints (called again after a rebind in settings)
  refreshHints() {
    if (!this._hints) return;
    const k = settings.keys;
    const set = (btn, base, code) => {
      const l = btn.querySelector('.lbl');
      if (l) l.textContent = `${base} (${keyLabel(code)})`;
    };
    set(this.orders, 'ORDERS', k.wheel);
    set(this.swap, 'SWAP', k.swap);
    set(this.tackle, 'TACKLE', k.tackle);
    set(this.pager, 'PAGE RN', k.pager);
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
    const base = (g.active.carrying || g.active.dragging) ? 'LET GO'
      : g.active.grabHeld ? 'STICKY…' : 'GRAB';
    gl.textContent = this._hints ? `${base} (${keyLabel(settings.keys.grab)})` : base;
    const near = g.nearestPatient(g.active, 3.2, (s) => s.state === 'agitated');
    this.tackle.style.display = near ? 'flex' : 'none';
  }
}
