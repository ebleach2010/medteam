import { llmEnabled, getKey, setKey } from '../sim/llm.js';

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
    const on = llmEnabled();
    this.el.innerHTML = `
      <h1>MED<span>TEAM</span></h1>
      <p>The ED is filling up. Triage them, work them up, treat them —
      and try very hard not to kill anyone. Swap between your nurse and doctor,
      drag patients to beds, spin bloods, read scans, raid the pharmacy,
      and tackle anyone who rips out their IV.</p>
      <p style="font-size:12px">🕹️ left thumb / WASD: move · ✋ grab &amp; drop · 📋 orders · 🔄 swap roles</p>
      <div id="keybox">
        <div class="klabel">🔑 Live Claude
          <span class="kpill ${on ? 'on' : 'off'}">${on ? '● CONNECTED' : '○ OFFLINE'}</span>
        </div>
        <div class="krow">
          <input id="titlekey" type="password" autocomplete="off" placeholder="Paste sk-ant-… for live patient AI" value="">
          <button id="titlekeygo">SAVE</button>
        </div>
        <div class="khint">Optional. On phone, paste your key here so patients, MED-DOC &amp; consults use real Claude. Stored in this browser only.</div>
      </div>
      <button class="go">START SHIFT</button>`;
    const input = this.el.querySelector('#titlekey');
    const pill = this.el.querySelector('.kpill');
    const refresh = () => {
      const now = llmEnabled();
      pill.className = `kpill ${now ? 'on' : 'off'}`;
      pill.textContent = now ? '● CONNECTED' : '○ OFFLINE';
    };
    const save = () => {
      const k = input.value.trim();
      if (!k) return;
      setKey(k);
      input.value = '';
      input.blur();
      refresh();
      this.game.ui.toast(llmEnabled() ? '🔑 Claude connected' : 'Key cleared', 'good');
    };
    this.el.querySelector('#titlekeygo').addEventListener('click', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    this.el.querySelector('.go').addEventListener('pointerdown', () => { this.hide(); onStart(); });
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
