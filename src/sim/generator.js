import { pickPresentation, presentationById } from '../data/presentations.js';
import { MEDS, medsInClass } from '../data/meds.js';

// Procedural health-problem engine.
//
// A presentation is a template; this turns it into ONE patient's illness —
// randomised severity, vitals, timeline, and (the important bit) that
// individual's drug response. Two people with the same panic attack won't
// necessarily settle on the same agent, and that's patient variability rather
// than the game hiding a single correct answer.

const NORM = { hr: 80, sbp: 120, dbp: 78, rr: 15, spo2: 98, temp: 37.0 };

const BUB = {
  stable: ['Still here... still patient. Mostly.', 'Any update, doc?', '*waits*'],
  worse: ['I feel... worse. Distinctly worse.', 'This is going the wrong way.', 'Doc? DOC?'],
  better: ['Oh wow. I feel human again.', 'That is starting to work.', 'MUCH better.'],
  critical: ['*fading fast*', '*can barely respond*', 'help... please...'],
};

// ESI 1 is a resuscitation, ESI 5 is a nosebleed — that drives score, how long
// they'll tolerate the waiting room, and how hard they crash.
const BY_ESI = {
  1: { score: 700, patience: 90, rescue: 0.35, decline: 1.0 },
  2: { score: 500, patience: 120, rescue: 0.45, decline: 0.8 },
  3: { score: 330, patience: 190, rescue: 0.6, decline: 0.55 },
  4: { score: 190, patience: 330, rescue: 0.9, decline: 0.25 },
  5: { score: 120, patience: 480, rescue: 1.0, decline: 0.12 },
};

const FAIL_DELTA = {
  shock: { sbp: -32, hr: 28 },
  resp: { spo2: -9, rr: 9 },
  cardiac: { hr: 42, sbp: -22 },
  neuro: { rr: -4, hr: 12 },
  bleed: { sbp: -36, hr: 34 },
};
const FAIL_CAUSE = {
  shock: 'circulatory collapse', resp: 'respiratory failure', cardiac: 'cardiac arrest',
  neuro: 'neurological collapse', bleed: 'exsanguination',
};

const FIRST = ['Sam', 'Alex', 'Jo', 'Ray', 'Kim', 'Max', 'Lee', 'Ash', 'Nic', 'Dev', 'Robin', 'Frankie',
  'Marta', 'Ivan', 'Priya', 'Omar', 'Elena', 'Tomas', 'Grace', 'Hugo', 'Nadia', 'Bill', 'Rosa', 'Kwame'];
const LAST = ['H.', 'W.', 'K.', 'M.', 'P.', 'D.', 'R.', 'S.', 'T.', 'B.', 'N.', 'L.', 'V.', 'A.'];

// one example med per class, so offline hints and the "expected" list still read
const exampleFor = (cls) => medsInClass(cls)[0]?.id ?? null;

/**
 * Build a randomised illness.
 * @param rng   seeded rng
 * @param day   which day of the shift (drives how fast they decline)
 * @param opts  { id } to force a specific presentation
 */
export function generateCase(rng, day = 1, opts = {}) {
  const bias = opts.esiWeights ? (p) => opts.esiWeights[p.esi - 1] ?? 1 : undefined;
  const P = opts.id ? (presentationById(opts.id) ?? pickPresentation(rng, bias)) : pickPresentation(rng, bias);
  const E = BY_ESI[P.esi] ?? BY_ESI[3];

  // --- severity roll: the same complaint can be a nuisance or a disaster ---
  const sev = 0.55 + rng.next() * 0.9;              // 0.55 … 1.45
  const vitals = { ...NORM };
  for (const [k, v] of Object.entries(P.v)) {
    const base = NORM[k] ?? v;
    vitals[k] = Math.round((base + (v - base) * sev) * 10) / 10;
  }
  // a little individual noise so no two charts look identical
  vitals.hr = Math.max(38, Math.round(vitals.hr + rng.range(-6, 6)));
  vitals.sbp = Math.max(60, Math.round(vitals.sbp + rng.range(-8, 8)));
  vitals.rr = Math.max(6, Math.round(vitals.rr + rng.range(-2, 2)));
  vitals.spo2 = Math.min(100, Math.round(vitals.spo2 + rng.range(-2, 2)));
  vitals.temp = Math.round((vitals.temp + rng.range(-0.3, 0.3)) * 10) / 10;

  // --- deterioration: gentle on day 1, savage by day 100 ---
  // pace multiplies the clock available before each step, so BIGGER = slower.
  const dayFrac = Math.min(1, (Math.max(1, day) - 1) / 99);
  const dayPace = 3.2 - 2.75 * dayFrac;             // day 1 ≈ 3.2× the old timing, day 100 ≈ 0.45×
  const pace = (dayPace / (E.decline || 0.5)) / sev;
  const timeline = P.fail ? [
    { t: Math.round(70 * pace), vitals: FAIL_DELTA[P.fail], bubble: 'worse' },
    { t: Math.round(160 * pace), event: 'critical' },
    { t: Math.round(250 * pace), event: 'death', cause: FAIL_CAUSE[P.fail] },
  ] : [];

  // --- this patient's individual drug response ---
  // 1 in 4 has a class that simply does not work for them: the classic "I gave
  // the textbook agent and nothing happened, but the second-line fixed it".
  const routes = [...P.rx.first, ...P.rx.alt];
  // Resistance is per-AGENT, never per-class. "This one didn't respond to
  // lorazepam" is real medicine; "responds to no sedative whatsoever" is just
  // the guess-the-drug puzzle wearing a lab coat — and classes overlap so
  // heavily that resisting one would silently veto half the formulary.
  const working = MEDS.filter((m) => routes.some((c) => m.cls.includes(c))).map((m) => m.id);
  const resist = [];
  if (working.length > 2 && rng.chance(0.25)) {
    resist.push(rng.pick(working));
    if (working.length > 4 && rng.chance(0.3)) {          // occasionally two duds
      const second = rng.pick(working.filter((id) => id !== resist[0]));
      if (second) resist.push(second);
    }
  }
  // there must always be at least two agents left that work
  if (working.filter((id) => !resist.includes(id)).length < 2) resist.length = 0;
  // and occasionally someone is unusually sensitive — responds to an adjunct alone
  const easy = P.rx.adj.length > 0 && rng.chance(0.12);

  const dxOptions = [...P.dx];
  const name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;

  const meds = [...new Set([...P.rx.first, ...P.rx.alt].map(exampleFor).filter(Boolean))].slice(0, 2);

  return {
    id: `${P.id}_${Math.floor(rng.next() * 1e6)}`,
    presentationId: P.id,
    name: P.name,
    tier: 6 - P.esi,                 // legacy: higher = harder
    esi: P.esi,
    fail: P.fail ?? 'shock',
    ambulatory: P.esi >= 3,
    complaint: [rng.pick(P.complaint)],
    history: P.history,
    bubbles: BUB,
    vitals,
    timeline,
    labs: P.labs === null ? null : { CBC: 'normal', BMP: 'normal', ...(P.labs ?? {}) },
    imaging: P.img ? { ...P.img, correct: 0, required: true } : null,
    ekg: null, neuro: null, physical: null,
    dxOptions, correctDx: 0,
    treatment: { meds, dispo: P.dispo },
    // the class-based prescription — what treatment.js actually judges against
    rx: { first: [...P.rx.first], alt: [...P.rx.alt], adj: [...P.rx.adj] },
    resist,                           // specific AGENTS that do nothing for THIS patient
    easyAdjunct: easy,
    contra: P.contra ?? [],
    surgery: P.surgery,
    agitationRisk: P.agit ?? 0,
    patienceMin: Math.round(E.patience * (0.8 + rng.next() * 0.5)),
    score: Math.round(E.score * (0.85 + sev * 0.3)),
    rescueChance: E.rescue,
    psych: !!P.psych,
    tags: P.tags ?? [],
    displayNameSeed: name,
    severity: sev,
  };
}
