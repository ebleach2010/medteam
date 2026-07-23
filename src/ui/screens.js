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
      <button class="go">START SHIFT</button>
      <button class="ai" style="padding:9px 24px;font-size:13px;font-weight:800;color:#fff;border:none;border-radius:999px;background:linear-gradient(#3a4a6b,#26355a)">🔑 LIVE CLAUDE (API key)</button>`;
    this.el.querySelector('.go').addEventListener('pointerdown', () => { this.hide(); onStart(); });
    this.el.querySelector('.ai').addEventListener('pointerdown', () => this.game.ui.modals.apiSettings());
  }

  daySummary(stats, day, quota, onNext) {
    const tr = Math.round(stats.treated * 100) / 100;
    this.el.style.display = 'flex';
    this.el.innerHTML = `
      <h2>END OF DAY ${day} — QUOTA MET</h2>
      <div class="stats">
        <span><b style="color:#7dffb0">${tr}/${quota}</b>treated</span>
        <span><b style="color:#ff5d5d">${stats.died}</b>died</span>
        <span><b style="color:#ffb03c">${stats.walkedOut}</b>walked out</span>
        <span><b>★ ${stats.score}</b>score</span>
      </div>
      <p>${stats.died === 0 ? 'A zero-mortality shift. Legendary.' :
          stats.died < 3 ? 'Some you can’t save. (Some you maybe could have.)' :
          'The incinerator sends its regards.'}</p>
      <button class="go">START DAY ${day + 1}</button>`;
    this.el.querySelector('.go').addEventListener('pointerdown', () => { this.hide(); onNext(); });
  }

  gameOver(stats, day, quota, onRestart) {
    const tr = Math.round(stats.treated * 100) / 100;
    this.el.style.display = 'flex';
    this.el.innerHTML = `
      <h2 style="color:#ff5d5d">SHIFT FAILED</h2>
      <div class="stats">
        <span><b style="color:#ff5d5d">${tr}/${quota}</b>treated</span>
        <span><b>${stats.died}</b>died</span>
        <span><b>${stats.walkedOut}</b>walked out</span>
      </div>
      <p>The board needed ${quota} treated. You delivered ${tr}. Day ${day} was your last —
      hand in your badge and start again from Day 1.</p>
      <button class="go">BACK TO DAY 1</button>`;
    this.el.querySelector('.go').addEventListener('pointerdown', () => { this.hide(); onRestart(); });
  }

  hide() { this.el.style.display = 'none'; }
  fade(toBlack) { this.fader.style.opacity = toBlack ? 1 : 0; }
}
