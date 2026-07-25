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
    for (const id of cfg.forceCases) picks.push(generateCase(g.rng, day, { id }));
    while (picks.length < cfg.patients) {
      picks.push(generateCase(g.rng, day, { esiWeights: cfg.esiWeights }));
    }
    // arrival minutes: first patient walks in almost immediately, the rest are
    // spread evenly across the day with jitter — a steady drip, not a desert
    const n = picks.length;
    const times = [];
    for (let i = 0; i < n; i++) times.push(15 + (i * 1000) / n + g.rng.range(-25, 25));
    times.sort((a, b) => a - b);
    times[0] = Math.min(times[0], 18);
    for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i], times[i - 1] + 12);
    this.schedule = picks.map((c, i) => ({ at: times[i], caseData: c, done: false }));
  }

  tick() {
    const g = this.game;
    for (const s of this.schedule) {
      if (s.done || g.clock.minutes < s.at) continue;
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
      g.ui.toast(`🚑 New patient: ${p.sim.displayName}`);
    }
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
