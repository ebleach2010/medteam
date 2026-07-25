// Top bar: day, clock, score, ED capacity pips, active role.
export class HUD {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = `
      <span class="day"></span><span class="clock"></span><span class="score"></span>
      <span class="coins"><b class="coin-disc">✚</b><i class="n">0</i><u class="today"></u></span>
      <span class="cap"></span><span class="role"></span><span class="quota"></span>`;
    root.appendChild(this.el);
    this.coinEl = this.el.querySelector('.coins');
    this.coinN = this.el.querySelector('.coins .n');
    this.coinToday = this.el.querySelector('.coins .today');
    this.day = this.el.querySelector('.day');
    this.clock = this.el.querySelector('.clock');
    this.score = this.el.querySelector('.score');
    this.cap = this.el.querySelector('.cap');
    this.role = this.el.querySelector('.role');
    this.quota = this.el.querySelector('.quota');
    this.toastEl = document.createElement('div');
    this.toastEl.id = 'toast';
    root.appendChild(this.toastEl);
    this._toastT = null;
    this.announceEl = document.createElement('div');
    this.announceEl.id = 'announce';
    root.appendChild(this.announceEl);
  }

  // center-screen mission text: typed letter by letter, gone 7s after the
  // last character. THE channel for treatment results and staff reports.
  announce(msg, cls = '') {
    clearInterval(this._annT);
    clearTimeout(this._annHide);
    const el = this.announceEl;
    this.game.audio?.radio?.();   // squelch break — this is the radio channel
    el.className = cls ? `show ${cls}` : 'show';
    el.textContent = '';
    let i = 0;
    this._annT = setInterval(() => {
      i += 2; // two chars a tick — brisk teletype
      el.textContent = msg.slice(0, i);
      if (i >= msg.length) {
        clearInterval(this._annT);
        this._annHide = setTimeout(() => (el.className = ''), 7000);
      }
    }, 33);
  }

  toast(msg, cls = '', ms = 2600) {
    if (cls === 'bad') this.game.audio?.deny?.();
    this.toastEl.textContent = msg;
    this.toastEl.className = cls ? `show ${cls}` : 'show';
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (this.toastEl.className = ''), ms);
  }

  // the counter jolts when a coin lands in it
  coinPop() {
    this.coinEl.classList.remove('pop');
    void this.coinEl.offsetWidth;
    this.coinEl.classList.add('pop');
  }

  update() {
    const g = this.game;
    this.coinN.textContent = g.coins ?? 0;
    const today = g.dayStats.coins ?? 0;
    this.coinToday.textContent = today ? `+${today} today` : '';
    this.day.textContent = `DAY ${g.clock.day}`;
    this.clock.textContent = g.clock.format();
    this.score.textContent = `★ ${g.score}`;
    this.role.textContent = g.active.role === 'nurse' ? '🩺 NURSE' : '🥼 DOCTOR';
    const tr = Math.round(g.dayStats.treated * 100) / 100;
    this.quota.textContent = `✅ ${tr}/${g.quota}`;
    this.quota.style.color = tr >= g.quota ? '#7dffb0' : '#ffb03c';
    const edBeds = g.map.beds;
    const used = edBeds.filter((b) => b.occupant).length;
    const waiting = [...g.world.byTag('patients')]
      .filter((p) => ['waiting', 'angry', 'arriving'].includes(p.sim.state)).length;
    let pips = '';
    edBeds.forEach((b, i) => { pips += `<i class="${b.occupant ? 'used' : ''}"></i>`; });
    this.cap.innerHTML = pips + (waiting ? `<span style="color:#ffb03c;font-size:12px;margin-left:5px">+${waiting} waiting</span>` : '');
  }
}
