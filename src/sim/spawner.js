import { CASES, casesByTier, caseById } from '../data/cases.js';
import { dayConfig } from '../data/days.js';
import { spawnPatient } from '../entities/Patient.js';

// Builds a day's arrival schedule at 12:00 AM, then releases patients into the
// waiting room as the clock hits their arrival time.
export class Spawner {
  constructor(game) { this.game = game; this.schedule = []; }

  planDay(day) {
    const g = this.game, cfg = dayConfig(day);
    const picks = [];
    const used = new Set(); // ONE of each diagnosis per day — no ankle-sprain parade
    for (const id of cfg.forceCases) { picks.push(caseById(id)); used.add(id); }
    let guard = 0;
    while (picks.length < cfg.patients && guard++ < 400) {
      const w = cfg.tierWeights;
      const total = w.reduce((a, b) => a + b, 0);
      let r = g.rng.next() * total, tier = 1;
      for (let i = 0; i < w.length; i++) { if (r < w[i]) { tier = i + 1; break; } r -= w[i]; }
      let pool = casesByTier(tier).filter((c) => !used.has(c.id));
      if (!pool.length) pool = CASES.filter((c) => !used.has(c.id)); // tier drained — pull anywhere
      if (!pool.length) break;                                      // 100 uniques exhausted (never on one day)
      const c = g.rng.pick(pool);
      used.add(c.id);
      picks.push(c);
    }
    // arrival minutes: first patient walks in almost immediately, the rest are
    // spread evenly across the day with jitter — a steady drip, not a desert
    const n = picks.length;
    const times = [];
    for (let i = 0; i < n; i++) times.push(15 + (i * 1000) / n + g.rng.range(-25, 25));
    times.sort((a, b) => a - b);
    times[0] = Math.min(times[0], 18);
    for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i], times[i - 1] + 12);
    this.schedule = picks.map((c, i) => ({ at: times[i], caseData: freshCase(c), done: false }));
  }

  tick() {
    const g = this.game;
    for (const s of this.schedule) {
      if (s.done || g.clock.minutes < s.at) continue;
      s.done = true;
      const p = spawnPatient(g, s.caseData, g.map.spawnOutside.x, g.map.spawnOutside.z);
      // route THROUGH the entrance first (straight-lining clips wall corners),
      // then to a free waiting chair
      const seat = g.map.seats.find((st) => !st.taken);
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

// deep-ish copy so per-run flags (timeline .done) don't leak between patients/days
function freshCase(c) {
  return { ...c, timeline: c.timeline.map((k) => ({ ...k })) };
}
