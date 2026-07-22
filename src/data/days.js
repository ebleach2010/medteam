// Per-day (per-level) difficulty config. tierWeights = relative chance a
// spawned case comes from each tier [t1,t2,t3,t4].
export function dayConfig(day) {
  const d = Math.max(1, day);
  return {
    patients: Math.min(3 + Math.round(d * 1.6), 14),
    tierWeights:
      d === 1 ? [1, 0, 0, 0] :
      d === 2 ? [2, 1, 0, 0] :
      d === 3 ? [2, 2, 1, 0] :
      d === 4 ? [1, 2, 2, 0.5] :
      d === 5 ? [1, 2, 2, 1] :
                [0.5, 1.5, 2, 1.5],
    // game-minutes per real second (day 1-2 shorter real days)
    timeScale: d <= 2 ? 2.4 : 2.0,
    edCapacity: 6,
    // stroke pair guaranteed from day 5: punishes CT skippers
    forceCases: d >= 5 ? ['stroke_ischemic', 'stroke_sah'] : d === 4 ? ['stroke_ischemic'] : [],
  };
}
