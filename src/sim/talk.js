// Local language engine for the typed ASK and TREAT bars.
// (The artifact sandbox has no network, so this is intent matching over the
// case data rather than a live LLM — swap in an API-backed version for a
// hosted build.)
import { MEDS } from '../data/meds.js';

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- ASK: the patient answers your typed question ----------
const INTENTS = [
  [/when|start|onset|how long|begin/, (c) => {
    const timey = /hour|day|week|month|since|ago|yesterday|last night/i.test(c.history ?? '');
    return `It started ${c.tier <= 2 ? 'recently — hours to a couple of days ago' : 'a while ago and it is getting worse fast'}.${timey ? ` ${c.history}` : ''}`;
  }],
  [/history|condition|medical|diagnos|before|prior/, (c) => c.history || 'Nothing much before this, honestly.'],
  [/med(s|ication)|pill|taking|prescri/, (c) => /on |stopped|missed|started .*(med|pill|insulin|dialysis|prednisone|ssri|levothyroxine|digoxin|carbamazepine)/i.test(c.history) ? c.history : 'No regular medications that I remember.'],
  [/allerg/, () => 'No allergies that I know of. Well... one way to find out?'],
  [/drink|alcohol|drugs|smok|substance/, (c) => /drink|alcohol|drug|iv drug|smok|moonshine|pack-year/i.test(c.history) ? c.history : 'Nothing like that. Mostly.'],
  [/travel|trip|abroad|country|vacation/, (c) => /tropic|safari|flight|tokyo|travel/i.test(c.history) ? c.history : 'Haven’t been anywhere lately.'],
  [/family|mother|father|relative/, (c) => /fhx|family|dad|cousin|died/i.test(c.history) ? c.history : 'Family’s healthy as far as I know.'],
  [/pain|hurt|where|feel/, (c) => `${c.complaint[0]} ${c.physical ? `(It's tender — ${c.physical.toLowerCase()})` : ''}`],
  [/worse|better|chang/, (c) => (c.timeline?.length ? 'Definitely getting worse the longer I sit here.' : 'About the same since it started.')],
  [/why|here|wrong|problem|matter/, (c) => c.complaint[0]],
];

// yes/no engine helpers: every factual sentence the patient "knows" about
// themselves, so "is the toe oozing?" gets checked against the actual case
const STOP = new Set(['the', 'and', 'your', 'you', 'have', 'has', 'had', 'does', 'did', 'are',
  'is', 'was', 'were', 'any', 'with', 'there', 'this', 'that', 'they', 'them', 'been', 'ever',
  'still', 'like', 'get', 'got', 'getting', 'feel', 'feeling', 'notice', 'noticed', 'right', 'left', 'side']);
const stem = (w) => { const s = w.replace(/(ing|ed|es|s)$/, ''); return s.length >= 3 ? s : w; };
// patients don't say "erythema" — map street symptoms onto chart language
const SYN = [
  ['ooz', 'weep', 'drain', 'discharg', 'pus', 'crust', 'wet'],
  ['itch', 'scratch', 'prurit'],
  ['fever', 'hot', 'chill', 'temperature', 'febrile', 'sweat'],
  ['swoll', 'swell', 'puffy', 'edema'],
  ['red', 'erythem', 'inflam'],
  ['throw', 'vomit', 'puk', 'nause', 'sick to'],
  ['dizz', 'lightheaded', 'spin', 'vertigo', 'faint', 'syncope', 'pass out', 'passed out'],
  ['breath', 'winded', 'air', 'dyspnea', 'wheez'],
  ['numb', 'tingl', 'pins', 'paresthes'],
  ['tired', 'fatigue', 'exhaust', 'weak', 'letharg'],
  ['bleed', 'blood', 'hemorrhag'],
  ['cough', 'hack'],
  ['headach', 'migrain', 'head pound'],
];
const expandStems = (st) => { for (const g of SYN) if (g.some((s) => st.startsWith(s) || s.startsWith(st))) return g; return [st]; };
const factSentences = (c) => [...c.complaint, c.history, c.physical, c.neuro, c.ekg ? `EKG shows ${c.ekg}` : null]
  .filter(Boolean).flatMap((s) => String(s).split(/(?<=[.!?])\s+/));

export function answerQuestion(sim, text) {
  const q = norm(text);
  if (!q) return '...';
  const c = sim.case;
  // laterality: each patient's problem lives on one consistent (seeded) side
  const side = ['left', 'right'][(sim.scanSeed ?? 0) % 2];
  if (/(which|what) (side|one|ankle|leg|arm|knee|wrist|hand|foot|elbow|shoulder|hip|eye|ear)\b/.test(q)
    || /left or right/.test(q)) {
    return `The ${side}. ${c.physical ?? c.complaint[0]}`;
  }
  // pain scale
  if (/scale|out of (10|ten)|1 to 10|how bad|rate (the|your)? ?pain/.test(q)) {
    const n = Math.min(10, Math.round(2 + c.tier * 1.5 + ((sim.scanSeed ?? 0) % 3)));
    return `Ehh... a ${n} out of 10. ${n >= 8 ? 'Okay fine, an 11.' : `Maybe a ${n + 1} when I move.`}`;
  }
  // yes/no symptom probe: "is the toe oozing?", "any fever?", "does it itch?"
  if (/^(is|are|does|do|did|has|have|any|was|were|got)\b/.test(q)) {
    const words = q.split(' ').filter((w) => w.length >= 3 && !STOP.has(w) && !/^(it|its|there)$/.test(w));
    if (words.length) {
      const sents = factSentences(c);
      const sentsN = sents.map(norm);
      const hits = [], misses = [];
      for (const w of words) {
        const alts = expandStems(stem(w));
        const idx = sentsN.findIndex((s) => alts.some((a) => s.includes(a)));
        if (idx >= 0) hits.push(sents[idx]);
        else if (/pain|hurt|sore|tender|ache/.test(w)) hits.push(c.physical ?? c.complaint[0]); // "does it hurt" — obviously
        else misses.push(w);
      }
      if (hits.length && !misses.length) return `Yeah. ${hits[hits.length - 1]}`;
      if (hits.length) {
        return sim.game.rng.pick([
          `${misses[0][0].toUpperCase()}${misses[0].slice(1)}? No, nothing like that. But ${(c.physical ?? c.complaint[0]).toLowerCase()}`,
          `No ${misses[0]} that I've noticed. It's more that ${(c.physical ?? c.complaint[0]).toLowerCase()}`,
        ]);
      }
      const echo = misses[misses.length - 1] ?? '';
      return sim.game.rng.pick([
        `${echo ? `${echo[0].toUpperCase()}${echo.slice(1)}? ` : ''}No, nothing like that.`,
        'No... I don\'t think so?',
        `Hm, no. Mostly it's just that ${c.complaint[0].toLowerCase()}`,
      ]);
    }
  }
  for (const [re, fn] of INTENTS) if (re.test(q)) return fn(c);
  // topic probe: a question word that appears in their story — answer about
  // THAT topic (complaint words get the complaint, never a history dump)
  for (const word of q.split(' ')) {
    if (word.length <= 3) continue;
    if (norm(c.complaint[0]).includes(word)) {
      return `${c.complaint[0]}${c.physical ? ` And look — ${c.physical.toLowerCase()}.` : ''}`;
    }
    if (norm(c.history).includes(word)) return c.history;
  }
  return sim.game.rng.pick([
    `Uh... I just know that ${c.complaint[0].toLowerCase()}`,
    'You’re the doctor, doc.',
    `Hmm. All I can tell you is: ${c.complaint[0].toLowerCase()}`,
  ]);
}

// ---------- ASK (angry): typed de-escalation ----------
export function deescalate(sim, text) {
  const q = norm(text);
  const temper = sim.temperament ?? 0.5; // 0 chill … 1 volcanic
  let cool = 0;
  if (/sorry|apolog/.test(q)) cool += 0.5;
  if (/soon|next|minute|almost|shortly|right away/.test(q)) cool += 0.45;
  if (/understand|hear you|know|frustrat|thank/.test(q)) cool += 0.4;
  if (/calm down|relax|chill/.test(q)) cool -= 0.5; // never works. ever.
  if (/shut|stupid|leave|security/.test(q)) cool -= 0.8;
  cool *= (1.15 - temper);
  return cool;
}

// ---------- TREAT: typed order → a med the aide can fetch ----------
const ALIASES = {
  wrap: 'nsaid', splint: 'nsaid', bandage: 'nsaid', ice: 'nsaid', advil: 'nsaid', ibuprofen: 'nsaid',
  o2: 'oxygen', oxygen: 'oxygen', 'nasal cannula': 'oxygen',
  saline: 'fluids', bolus: 'fluids', 'iv fluids': 'fluids', hydrate: 'fluids', fluids: 'fluids',
  sedate: 'sedative', 'calm them': 'sedative', versed: 'sedative',
  blood: 'prbc', transfuse: 'prbc', transfusion: 'prbc',
  sugar: 'd50', glucose: 'd50', dextrose: 'd50',
  'clot buster': 'tpa', thrombolytic: 'tpa', alteplase: 'tpa',
  'beta blocker': 'metoprolol', epinephrine: 'epi', epipen: 'epi', adrenaline: 'epi',
  antibiotic: 'ceftriaxone', abx: 'ceftriaxone', pressor: 'epi',
  'pain meds': 'morphine', analgesia: 'morphine', opioid: 'morphine',
  benzodiazepine: 'benzo', ativan: 'benzo', lorazepam: 'benzo',
  neb: 'albuterol', nebulizer: 'albuterol', inhaler: 'albuterol',
  cream: 'antifungal',
};

export function matchTreatment(text) {
  const q = norm(text);
  if (!q) return null;
  for (const [alias, id] of Object.entries(ALIASES)) {
    if (q.includes(alias)) return id;
  }
  let best = null, bestScore = 0;
  for (const m of MEDS) {
    const name = norm(m.name);
    if (q.includes(name) || name.includes(q)) return m.id;
    // token overlap fallback
    const toks = name.split(' ');
    const hit = toks.filter((t) => t.length > 3 && q.includes(t)).length;
    if (hit > bestScore) { bestScore = hit; best = m.id; }
  }
  return bestScore > 0 ? best : null;
}

// ---------- typed diagnosis judging ----------
export function judgeDiagnosis(sim, text) {
  const q = norm(text);
  if (!q) return false;
  const targets = [sim.case.name, sim.case.dxOptions[0]].map(norm);
  for (const t of targets) {
    if (q === t || q.includes(t) || t.includes(q)) return true;
    // token match: ≥60% of the target's significant words appear
    const toks = t.split(' ').filter((w) => w.length > 3);
    if (toks.length && toks.filter((w) => q.includes(w)).length / toks.length >= 0.6) return true;
  }
  return false;
}
