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
    for (const id of cfg.forceCases) picks.push(caseById(id));
    while (picks.length < cfg.patients) {
      const w = cfg.tierWeights;
      const total = w[0] + w[1] + w[2] + w[3];
      let r = g.rng.next() * total, tier = 1;
      for (let i = 0; i < 4; i++) { if (r < w[i]) { tier = i + 1; break; } r -= w[i]; }
      const pool = casesByTier(tier);
      picks.push(g.rng.pick(pool.length ? pool : CASES));
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
      if (seat) { seat.taken = p; p.sim.seat = seat; route.push({ x: seat.x, z: seat.z - 0.8 }); }
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
