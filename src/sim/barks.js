// The attending has opinions. Events around the department make you mutter,
// swear, or occasionally sound briefly hopeful before someone ruins it.
// Procedural: lines are picked per event, never repeat back-to-back, and get
// more bitter as the shift wears on.
const LINES = {
  // a treatment you expected to work did nothing
  noResponse: [
    'Jesus, I really thought that would work.',
    'Nothing. Fantastic.',
    'Ah, fuck this.',
    'Textbook says yes. Patient says no.',
    'Cool. Cool cool cool.',
    'So we\'re doing it the hard way.',
  ],
  // you gave something actively unhelpful
  wrongMed: [
    'That was... a choice.',
    'Right. Not that, then.',
    'Well that did nothing for anybody.',
    'Let\'s pretend that didn\'t happen.',
  ],
  // patient responds
  better: [
    'Oh thank God.',
    'There we go. Finally.',
    'Would you look at that. Medicine.',
    'Good. Stay that way.',
  ],
  // someone crashes
  crash: [
    'No no no no—',
    'Don\'t you dare.',
    'Not on my shift.',
    'Oh you have GOT to be kidding.',
    'Move, move, MOVE.',
  ],
  // someone dies
  death: [
    'Ah, fuck this.',
    '...Time of death. Christ.',
    'I hate this job. I love this job. I hate this job.',
    'That one\'s going to sit with me.',
    'Somebody get the paperwork.',
  ],
  // discharged well
  discharge: [
    'One down.',
    'Off you go. Don\'t come back.',
    'That\'s how it\'s supposed to go.',
    'Next.',
  ],
  // patient walked out of the waiting room
  walkout: [
    'Great. Left before I could even see them.',
    'That\'s a complaint letter in the post.',
    'Cool, so we\'re losing them in the lobby now.',
  ],
  // waiting room is stacking up
  swamped: [
    'Where are they all COMING from?',
    'We\'re drowning out there.',
    'Does nobody have a GP any more?',
    'Nope. Nope. Not enough of me.',
  ],
  // you slipped in blood
  slip: [
    'Oh, brilliant.',
    'Who\'s cleaning that? Me. It\'s me.',
    'That\'s going in the incident report.',
  ],
  // an order made no sense
  confused: [
    'Even I don\'t know what I meant by that.',
    'Ignore me. Long shift.',
  ],
};

export class Barks {
  constructor(game) {
    this.game = game;
    this.last = {};       // per-kind last index, so a line never repeats twice
    this.cooldown = 0;    // seconds; keeps them from becoming wallpaper
  }

  tick(dt) { this.cooldown = Math.max(0, this.cooldown - dt); }

  // kind: key of LINES. `force` skips the cooldown (deaths always land).
  say(kind, force = false) {
    const g = this.game;
    if (g.mode !== 'playing') return;
    const pool = LINES[kind];
    if (!pool) return;
    if (this.cooldown > 0 && !force) return;
    let i = Math.floor(g.rng.next() * pool.length);
    if (pool.length > 1 && i === this.last[kind]) i = (i + 1) % pool.length;
    this.last[kind] = i;
    this.cooldown = force ? 2.5 : 7;
    g.ui.bubbles.say(g.active, pool[i], { hold: 3.2 });
  }
}
