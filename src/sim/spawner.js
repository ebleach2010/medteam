import { dayConfig } from '../data/days.js';
import { spawnPatient } from '../entities/Patient.js';
import { generateCase } from './generator.js';

// Builds a day's arrival schedule at 12:00 AM, then releases patients into the
// waiting room as the clock hits their arrival time.
export class Spawner {
  constructor(game) { this.game = game; this.schedule = []; }

  planDay(day) {
    const g = this.game, cfg = dayConfig(day);
    const picks = [];
    // Procedural: every patient is generated fresh from the presentation
    // engine, weighted by how often that complaint really turns up. Same
    // presentation twice in a day is fine — it'll be a different illness.
    // track the last few presentations so the stream doesn't repeat itself
    this._recent = [];
    const remember = (c) => { this._recent.push(c.presentationId); if (this._recent.length > 3) this._recent.shift(); return c; };
    for (const id of cfg.forceCases) picks.push(remember(generateCase(g.rng, day, { id })));
    while (picks.length < cfg.patients) {
      picks.push(remember(generateCase(g.rng, day, { esiWeights: cfg.esiWeights, avoid: new Set(this._recent) })));
    }
    // arrival minutes: first patient walks in almost immediately, the rest come
    // in a brisk, steady stream — NOT spread thin across the whole 24h shift
    // (that left minutes of dead air between arrivals on the early days). They
    // land across the first ~55% of the day; _topUp keeps it alive after that.
    const n = picks.length;
    const times = [];
    for (let i = 0; i < n; i++) times.push(10 + (i * 800) / n + g.rng.range(-14, 14));
    times.sort((a, b) => a - b);
    times[0] = Math.min(times[0], 14);
    for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i], times[i - 1] + 6);
    this.schedule = picks.map((c, i) => ({ at: times[i], caseData: c, done: false }));
  }

  tick() {
    const g = this.game;
    for (const s of this.schedule) {
      if (s.done || g.clock.minutes < s.at) continue;
      this._release(s);
    }
    this._topUp();
  }

  _release(s) {
    const g = this.game;
    s.done = true;
    const p = spawnPatient(g, s.caseData, g.map.spawnOutside.x, g.map.spawnOutside.z);
    // route THROUGH the entrance first (straight-lining clips wall corners),
    // then to a free waiting chair
    // TRIAGE: the nurse eyeballs them at the desk and seats the waiting room
    // by acuity — ESI 1 nearest the doors, the nonurgent down the far end.
    const seat = triageSeat(g, p);
    const route = [{ ...g.map.entrance }, { ...g.map.insideWaypoint }];
    // approach the chair from the NORTH (the side patients enter from) —
    // the south side is blocked by the reception desk, which stranded them
    if (seat) { seat.taken = p; p.sim.seat = seat; route.push({ x: seat.x, z: seat.z + 0.7 }); }
    else route.push({ x: g.map.insideWaypoint.x + g.rng.range(-1, 3), z: g.map.insideWaypoint.z + g.rng.range(1, 3) });
    p.sim.route = route;
    p.sim.walkTarget = p.sim.route.shift();
    g.audio?.arrive?.();       // the automatic doors announce another one
    g.ui.toast(`🚑 New patient: ${p.sim.displayName}`);
  }

  // how many patients are physically in the department needing (or getting) care
  activeCount() {
    let n = 0;
    for (const p of this.game.world.byTag('patients')) {
      const s = p.sim;
      if (s.resolved || ['dead', 'leaving', 'walkout'].includes(s.state)) continue;
      n++;
    }
    return n;
  }

  // Keep the ED alive. If you clear the board fast, don't sit in an empty
  // department for hours — as soon as nobody's here and nothing's due shortly,
  // pull the next patient in. When the planned load is spent but there's still
  // shift left, invent fresh ones so a steady flow keeps coming.
  _topUp() {
    const g = this.game;
    if (g.mode !== 'playing') return;
    const now = g.clock.minutes;
    if (now > 24 * 60 - 60) return;             // last hour: let the shift wind down
    // keep the department at a lively minimum — refill when it's QUIET (a couple
    // of patients), not only when it's bone empty, so there's always something
    // to do without waiting out dead air
    const cfg = dayConfig(g.clock.day);
    const floor = Math.min(3, Math.max(1, Math.round((cfg.edCapacity ?? 6) / 2)));
    if (this.activeCount() >= floor) return;
    if (this.schedule.some((s) => !s.done && s.at <= now + 25)) return; // one's already due soon
    if (now - (this._lastFlowAt ?? -999) < 12) return; // a short beat, not a flood
    this._lastFlowAt = now;
    const next = this.schedule.find((s) => !s.done);
    if (next) { next.at = now; return; }        // bring the next planned arrival in now
    // planned load spent — generate a fresh walk-in so the ED never goes dead
    const c = generateCase(g.rng, g.clock.day, { esiWeights: cfg.esiWeights, avoid: new Set(this._recent ?? []) });
    (this._recent ??= []).push(c.presentationId); if (this._recent.length > 3) this._recent.shift();
    this.schedule.push({ at: now, done: false, caseData: c });
  }
}


// Real triage: the waiting row is ordered by acuity, not arrival. A new
// patient takes the best free seat for their ESI, and if someone sicker turns
// up they bump a less urgent patient further down the row. Psych presentations
// and overdoses carry their own ESI, so an OD outranks a sprained ankle.
function triageSeat(g, p) {
  const seats = g.map.seats;
  const esi = p.sim.case?.esi ?? 3;
  const free = seats.filter((s) => !s.taken);
  if (!free.length) return null;
  // seats are laid out in reading order; the first ones are closest to triage
  const idx = (s) => seats.indexOf(s);
  free.sort((a, b) => idx(a) - idx(b));

  // where SHOULD they sit? count everyone already waiting who is sicker.
  const waiting = seats.filter((s) => s.taken).map((s) => ({ s, esi: s.taken.sim.case?.esi ?? 3 }));
  const sicker = waiting.filter((w) => w.esi < esi).length;
  const target = free[Math.min(sicker, free.length - 1)] ?? free[0];

  // if they out-rank someone sitting closer, swap: the sicker patient moves up
  const outranked = waiting.filter((w) => w.esi > esi && idx(w.s) < idx(target))
    .sort((a, b) => idx(a.s) - idx(b.s))[0];
  if (outranked) {
    const bumped = outranked.s.taken;
    const from = outranked.s;
    from.taken = p;
    target.taken = bumped;
    bumped.sim.seat = target;
    // walk the bumped patient over to their new, less-flattering seat
    bumped.sim.route = [{ x: target.x, z: target.z + 0.7 }];
    bumped.sim.walkTarget = bumped.sim.route.shift();
    if (bumped.sim.state === 'waiting') bumped.sim.state = 'arriving';
    from.taken = null; // triageSeat's caller claims it
    return from;
  }
  return target;
}
