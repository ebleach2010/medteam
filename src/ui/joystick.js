// Floating virtual joystick: appears wherever the left half is touched.
export class Joystick {
  constructor(root) {
    this.vec = { x: 0, z: 0 };
    this.el = document.createElement('div');
    this.el.id = 'joy';
    this.el.innerHTML = '<div class="knob"></div>';
    root.appendChild(this.el);
    this.knob = this.el.querySelector('.knob');
    this.touchId = null;
    this.origin = { x: 0, y: 0 };

    const zone = document.createElement('div');
    // touch-action:none is critical: it isn't inherited, and without it the
    // browser (or an embedding page) treats the thumb drag as a scroll gesture
    zone.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:46%;pointer-events:auto;touch-action:none;';
    root.appendChild(zone);

    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.touchId !== null) return;
      this.touchId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.origin = { x: e.clientX, y: e.clientY };
      this.el.style.display = 'block';
      this.el.style.left = e.clientX - 55 + 'px';
      this.el.style.top = e.clientY - 55 + 'px';
      this._setKnob(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.touchId) return;
      let dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y;
      const d = Math.hypot(dx, dy), max = 46;
      if (d > max) { dx *= max / d; dy *= max / d; }
      this._setKnob(dx, dy);
      this.vec.x = dx / max;
      this.vec.z = dy / max; // screen-down = world +z (camera looks north)
    });
    const end = (e) => {
      if (e.pointerId !== this.touchId) return;
      this.touchId = null;
      this.vec.x = 0; this.vec.z = 0;
      this.el.style.display = 'none';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    // keyboard fallback for desktop dev/testing
    this.keys = new Set();
    window.addEventListener('keydown', (e) => { this.keys.add(e.key); this._keyVec(); });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.key); this._keyVec(); });
  }

  _keyVec() {
    const k = this.keys;
    const x = (k.has('d') || k.has('ArrowRight') ? 1 : 0) - (k.has('a') || k.has('ArrowLeft') ? 1 : 0);
    const z = (k.has('s') || k.has('ArrowDown') ? 1 : 0) - (k.has('w') || k.has('ArrowUp') ? 1 : 0);
    if (x || z || this.touchId === null) { this.vec.x = x; this.vec.z = z; }
  }

  _setKnob(dx, dy) {
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}
