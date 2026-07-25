import { settings } from './settings.js';

// Everything is synthesised — no audio files, nothing to download. A handful of
// primitives (blip, noise burst, thump, sweep) get recombined into the whole
// soundscape: footsteps that track your gait, doors, monitors, alarms, paper,
// wet slaps, the lot. Master volume and mute live in settings.
export class Audio {
  constructor() {
    this.ctx = null;
    this.bus = null;
    this._stepPhase = 0;
    this._lastStep = 0;
  }

  _ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.bus = this.ctx.createGain();
        this.bus.gain.value = 0.9;
        // a touch of compression so a busy department doesn't clip
        if (this.ctx.createDynamicsCompressor) {
          const comp = this.ctx.createDynamicsCompressor();
          this.bus.connect(comp).connect(this.ctx.destination);
        } else {
          this.bus.connect(this.ctx.destination);
        }
      } catch { /* muted world */ }
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume?.();
    return this.ctx;
  }

  get _on() { return !settings.muted && settings.vol > 0; }
  get _vol() { return settings.vol; }

  // ---------- primitives ----------
  _tone(freq, dur, { type = 'sine', gain = 0.06, at = 0, glide = 0, curve = 'exp' } = {}) {
    if (!this._on) return;
    const ctx = this._ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    this._lastSfx = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t0 + dur);
    const peak = Math.max(0.0001, gain * this._vol);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, dur * 0.2));
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    else g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.bus);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  // filtered noise — the basis of footsteps, paper, doors, splashes
  _noise(dur, { gain = 0.05, at = 0, type = 'bandpass', freq = 900, q = 1, sweepTo = 0 } = {}) {
    if (!this._on) return;
    const ctx = this._ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    this._lastSfx = ctx.currentTime;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t0);
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, gain * this._vol), t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(this.bus);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // ---------- UI ----------
  tap() { this._tone(620, 0.05, { type: 'square', gain: 0.028 }); }
  click() { this._tone(880, 0.035, { type: 'square', gain: 0.022 }); }
  back() { this._tone(420, 0.07, { type: 'square', gain: 0.022, glide: 300 }); }
  type() { this._noise(0.022, { gain: 0.03, freq: 2200, q: 3 }); }  // key press
  open() { this._tone(400, 0.12, { gain: 0.04, glide: 720 }); }     // modal rises
  close() { this._tone(560, 0.1, { gain: 0.035, glide: 300 }); }
  wheel() { this._tone(700, 0.06, { type: 'triangle', gain: 0.03, glide: 980 }); }
  // the "you can't do that" buzz. Fired from every bad toast, so it defers to
  // whatever richer sound the same event already played (a crash alarm, a
  // death whine) instead of honking over the top of it.
  deny() {
    const t = this.ctx?.currentTime ?? 0;
    if (this.ctx && t - (this._lastSfx ?? -9) < 0.2) return;
    this._tone(200, 0.16, { type: 'sawtooth', gain: 0.05, glide: 140 });
  }

  // ---------- outcomes ----------
  good() { this._tone(660, 0.1, { gain: 0.05 }); this._tone(990, 0.16, { gain: 0.045, at: 0.07 }); }
  bad() { this._tone(190, 0.28, { type: 'sawtooth', gain: 0.055, glide: 120 }); }
  score() { this._tone(880, 0.07, { gain: 0.035 }); this._tone(1320, 0.09, { gain: 0.03, at: 0.06 }); }
  cash() { // discharge / quota
    [784, 988, 1319].forEach((f, i) => this._tone(f, 0.12, { gain: 0.04, at: i * 0.07 }));
  }
  death() {
    this._tone(300, 0.5, { type: 'sine', gain: 0.06, glide: 90, curve: 'lin' });
    this._tone(1000, 1.6, { type: 'sine', gain: 0.035, at: 0.15 }); // the flatline whine
  }

  // ---------- world ----------
  // footsteps: called every frame with the character's speed; paces itself
  footstep(speed01, dtNow) {
    if (!this._on || speed01 < 0.12) return;
    const interval = 0.62 - speed01 * 0.34;      // faster gait = quicker steps
    if (dtNow - this._lastStep < interval) return;
    this._lastStep = dtNow;
    this._stepPhase ^= 1;
    // heel then a shorter scuff; alternating pitch so it reads as two feet
    this._noise(0.055, { gain: 0.035, freq: this._stepPhase ? 780 : 640, q: 1.6, sweepTo: 260 });
    this._tone(this._stepPhase ? 96 : 84, 0.05, { type: 'sine', gain: 0.025 });
  }

  grab() { this._noise(0.06, { gain: 0.04, freq: 500, q: 1.2 }); this._tone(240, 0.05, { gain: 0.03 }); }
  drop() { this._tone(150, 0.09, { gain: 0.04, glide: 90 }); this._noise(0.05, { gain: 0.03, freq: 300 }); }
  bed() { this._noise(0.14, { gain: 0.04, freq: 420, q: 0.9, sweepTo: 180 }); this._tone(180, 0.1, { gain: 0.03 }); }
  door() { // the ether double-door
    this._noise(0.34, { gain: 0.035, freq: 1400, q: 0.8, sweepTo: 380 });
    this._tone(150, 0.16, { gain: 0.025, at: 0.22 });
  }
  paper() { this._noise(0.14, { gain: 0.035, freq: 3200, q: 0.7, sweepTo: 1600 }); }
  pill() { this._tone(1180, 0.04, { type: 'triangle', gain: 0.03 }); this._noise(0.04, { gain: 0.02, freq: 2600 }); }
  inject() { this._noise(0.18, { gain: 0.03, freq: 1800, q: 2, sweepTo: 700 }); }
  slip() { // wet skid then the landing
    this._noise(0.3, { gain: 0.06, freq: 1100, q: 0.7, sweepTo: 220 });
    this._tone(90, 0.16, { gain: 0.06, at: 0.2, glide: 55 });
  }
  tackle() { this._tone(120, 0.2, { type: 'sawtooth', gain: 0.06, glide: 60 }); this._noise(0.12, { gain: 0.05, freq: 500 }); }
  scanner() { // the imaging gantry spinning up
    this._tone(180, 0.7, { type: 'sine', gain: 0.03, glide: 420 });
    this._noise(0.7, { gain: 0.018, freq: 600, q: 0.6, sweepTo: 1500 });
  }
  page() { [1200, 1200].forEach((f, i) => this._tone(f, 0.09, { type: 'square', gain: 0.035, at: i * 0.14 })); }
  radio() { this._noise(0.07, { gain: 0.025, freq: 2000, q: 4 }); this._tone(760, 0.06, { type: 'square', gain: 0.022, at: 0.05 }); }
  blip() { this._tone(1046, 0.045, { gain: 0.028 }); }               // monitor beep
  alarm() { // the crashing-patient alarm
    [0, 0.18, 0.36].forEach((at) => this._tone(1180, 0.12, { type: 'square', gain: 0.045, at }));
  }
  arrive() { this._tone(520, 0.09, { gain: 0.03 }); this._tone(700, 0.11, { gain: 0.028, at: 0.08 }); }
  fire() { this._noise(0.5, { gain: 0.05, freq: 300, q: 0.5, sweepTo: 90 }); }
}
