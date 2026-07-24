// Per-day (per-level) config. Five tiers: easy → near-impossible.
// The house rule: treat at least the day's quota (incinerations count ¼)
// or the shift is failed and you start over from day 1.

export function dayConfig(day) {
  const d = Math.max(1, day);
  return {
    // day 1 is a shakedown shift — a handful of walk-ins, room to learn.
    // The flood starts day 2 and grows from there.
    // compact 6-room ED: fewer beds means fewer patients + a lighter quota
    patients: d === 1 ? 6 : Math.min(8 + (d - 2) * 2, 16),
    quota: d === 1 ? 4 : Math.min(8, 5 + (d - 2)),
    tierWeights:
      d === 1 ? [1, 0.15, 0, 0, 0] :
      d === 2 ? [1, 0.7, 0.1, 0, 0] :
      d === 3 ? [0.8, 1, 0.5, 0.1, 0] :
      d === 4 ? [0.6, 1, 0.8, 0.3, 0.05] :
      d === 5 ? [0.4, 0.9, 1, 0.5, 0.15] :
      d === 6 ? [0.3, 0.7, 1, 0.7, 0.3] :
                [0.2, 0.6, 1, 0.9, 0.5],
    timeScale: d === 1 ? 1.2 : d === 2 ? 2.4 : 2.0, // day 1 runs at HALF pace — learn the building
    edCapacity: 6,
    // guaranteed lookalike pair from day 4: punishes CT skippers
    forceCases: d >= 4 ? ['stroke_isch', 'stroke_sah'] : d === 3 ? ['stroke_isch'] : [],
  };
}
