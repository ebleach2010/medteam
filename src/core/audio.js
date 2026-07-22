// Tiny WebAudio blips — no assets, initialized on first user gesture.
export class Audio {
  constructor() { this.ctx = null; }
  _ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* muted world */ } }
    return this.ctx;
  }
  _beep(freq, dur, type = 'sine', gain = 0.06) {
    const ctx = this._ensure();
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  }
  tap() { this._beep(600, 0.06, 'square', 0.03); }
  good() { this._beep(880, 0.12); this._beep(1320, 0.18); }
  bad() { this._beep(180, 0.3, 'sawtooth'); }
  alarm() { this._beep(1100, 0.15, 'square'); setTimeout(() => this._beep(1100, 0.15, 'square'), 220); }
}
