// Per-day (per-shift) config. The campaign runs to DAY 100 — day 1 is a gentle
// shakedown where almost nobody crashes on you, day 100 is a meat grinder.
// The actual deterioration pacing lives in sim/generator.js (it scales each
// patient's timeline by the day), so this file only sets volume and pressure.

export const MAX_DAY = 100;

export function dayConfig(day) {
  const d = Math.max(1, Math.min(MAX_DAY, day));
  const f = (d - 1) / (MAX_DAY - 1);          // 0 on day 1 → 1 on day 100

  return {
    // volume ramps from a busy-but-manageable start to a flood (early days used
    // to trickle in too slowly — the floor is higher now, and _topUp keeps the
    // department from ever going quiet)
    patients: Math.round(9 + f * 19),          // 9 → 28
    quota: Math.round(4 + f * 15),             // 4 → 19
    // acuity mix: mostly walk-ins early, mostly resuscitations late. These are
    // ESI weights [1..5] — the generator samples presentations by frequency and
    // this biases which end of the acuity scale it draws from.
    esiWeights: [
      0.02 + f * 0.9,   // ESI 1 resuscitation
      0.08 + f * 0.9,   // ESI 2 emergent
      0.35 + f * 0.5,   // ESI 3 urgent
      1.0 - f * 0.45,   // ESI 4 less urgent
      0.8 - f * 0.6,    // ESI 5 nonurgent
    ],
    // clock speed: day 1 crawls so you can learn the building
    timeScale: 1.1 + f * 1.6,                  // 1.1× → 2.7×
    edCapacity: 6,
    // the lookalike stroke pair starts showing up once you can handle it
    forceCases: d >= 12 ? ['stroke_isch', 'sah'] : d >= 6 ? ['stroke_isch'] : [],
  };
}
