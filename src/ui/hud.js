// Top bar: day, clock, score, ED capacity pips, active role.
export class HUD {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = `
      <span class="day"></span><span class="clock"></span><span class="score"></span>
      <span class="cap"></span><span class="role"></span>`;
    root.appendChild(this.el);
    this.day = this.el.querySelector('.day');
    this.clock = this.el.querySelector('.clock');
    this.score = this.el.querySelector('.score');
    this.cap = this.el.querySelector('.cap');
    this.role = this.el.querySelector('.role');
    this.toastEl = document.createElement('div');
    this.toastEl.id = 'toast';
    root.appendChild(this.toastEl);
    this._toastT = null;
  }

  toast(msg, cls = '') {
    this.toastEl.textContent = msg;
    this.toastEl.className = cls ? `show ${cls}` : 'show';
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (this.toastEl.className = ''), 2600);
  }

  update() {
    const g = this.game;
    this.day.textContent = `DAY ${g.clock.day}`;
    this.clock.textContent = g.clock.format();
    this.score.textContent = `★ ${g.score}`;
    this.role.textContent = g.active.role === 'nurse' ? '🩺 NURSE' : '🥼 DOCTOR';
    const edBeds = g.map.beds.filter((b) => b.room === 'ed');
    const used = edBeds.filter((b) => b.occupant).length;
    const waiting = [...g.world.byTag('patients')]
      .filter((p) => ['waiting', 'angry', 'arriving'].includes(p.sim.state)).length;
    let pips = '';
    edBeds.forEach((b, i) => { pips += `<i class="${b.occupant ? 'used' : ''}"></i>`; });
    this.cap.innerHTML = pips + (waiting ? `<span style="color:#ffb03c;font-size:12px;margin-left:5px">+${waiting} waiting</span>` : '');
  }
}
