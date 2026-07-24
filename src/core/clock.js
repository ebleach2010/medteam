// In-game clock. Days start at 12:00 AM. timeScale = game minutes per real second.
export class GameClock {
  constructor() { this.day = 1; this.minutes = 0; this.timeScale = 2; this.running = false; }
  update(dtReal) { if (this.running) this.minutes += dtReal * this.timeScale; }
  get dayDone() { return this.minutes >= 24 * 60; }
  format() {
    const m = Math.floor(this.minutes) % (24 * 60);
    let h = Math.floor(m / 60); const mm = String(m % 60).padStart(2, '0');
    const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 === 0 ? 12 : h % 12;
    return `${h}:${mm} ${ap}`;
  }
}
