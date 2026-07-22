// Fullscreen states: title, day transition fade, end-of-day summary.
export class Screens {
  constructor(root, game) {
    this.game = game;
    this.fader = document.createElement('div');
    this.fader.id = 'fader';
    root.appendChild(this.fader);
    this.el = document.createElement('div');
    this.el.id = 'screen';
    root.appendChild(this.el);
  }

  title(onStart) {
    this.el.style.display = 'flex';
    this.el.innerHTML = `
      <h1>MED<span>TEAM</span></h1>
      <p>The ED is filling up. Triage them, work them up, treat them —
      and try very hard not to kill anyone. Swap between your nurse and doctor,
      drag patients to beds, spin bloods, read scans, raid the pharmacy,
      and tackle anyone who rips out their IV.</p>
      <p style="font-size:12px">🕹️ left thumb: move · ✋ grab/drop · ⚡ tap: act, hold: order wheel · 🔄 swap roles</p>
      <button class="go">START SHIFT</button>`;
    this.el.querySelector('.go').addEventListener('pointerdown', () => { this.hide(); onStart(); });
  }

  daySummary(stats, day, onNext) {
    this.el.style.display = 'flex';
    this.el.innerHTML = `
      <h2>END OF DAY ${day}</h2>
      <div class="stats">
        <span><b style="color:#7dffb0">${stats.treated}</b>treated</span>
        <span><b style="color:#ff5d5d">${stats.died}</b>died</span>
        <span><b style="color:#ffb03c">${stats.walkedOut}</b>walked out</span>
        <span><b>★ ${stats.score}</b>score</span>
      </div>
      <p>${stats.died === 0 ? 'A zero-mortality shift. Legendary.' :
          stats.died < 3 ? 'Some you can’t save. (Some you maybe could have.)' :
          'The morgue called. They want a loyalty program.'}</p>
      <button class="go">START DAY ${day + 1}</button>`;
    this.el.querySelector('.go').addEventListener('pointerdown', () => { this.hide(); onNext(); });
  }

  hide() { this.el.style.display = 'none'; }
  fade(toBlack) { this.fader.style.opacity = toBlack ? 1 : 0; }
}
