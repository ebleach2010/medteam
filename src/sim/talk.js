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
  [/pain|hurt|where|feel/, (c) => `${c.complaint[0]} It gets worse when you poke at it, if that helps.`],
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
const factSentences = (c) => [
  ...c.complaint.map((t) => ({ t, lay: true })),
  c.history ? { t: c.history, lay: true } : null,
  c.physical ? { t: c.physical, lay: false } : null,
  c.neuro ? { t: c.neuro, lay: false } : null,
  c.ekg ? { t: `EKG shows ${c.ekg}`, lay: false } : null,
].filter(Boolean).flatMap((f) => String(f.t).split(/(?<=[.!?])\s+/).map((t) => ({ t, lay: f.lay })));

export function answerQuestion(sim, text) {
  const q = norm(text);
  if (!q) return '...';
  const c = sim.case;
  // laterality: each patient's problem lives on one consistent (seeded) side
  const side = ['left', 'right'][(sim.scanSeed ?? 0) % 2];
  if (/(which|what) (side|one|ankle|leg|arm|knee|wrist|hand|foot|elbow|shoulder|hip|eye|ear)\b/.test(q)
    || /left or right/.test(q)) {
    return `The ${side}. ${c.complaint[0]}`;
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
      const sentsN = sents.map((f) => norm(f.t));
      const hits = [], misses = [];
      for (const w of words) {
        const alts = expandStems(stem(w));
        const idx = sentsN.findIndex((sn) => alts.some((a) => sn.includes(a)));
        if (idx >= 0) hits.push(sents[idx]);
        else if (/pain|hurt|sore|tender|ache/.test(w)) hits.push({ t: c.complaint[0], lay: true }); // "does it hurt" — obviously
        else misses.push(w);
      }
      // patients confirm what they FEEL — they never recite the chart
      const sayYes = (h) => h.lay
        ? `Yeah. ${h.t}`
        : sim.game.rng.pick([
          'Yeah... now that you mention it, yeah.',
          'Yeah, I think so? It\'s hard to describe, but yeah.',
          'Yeah, it\'s been doing that since this whole thing started.',
        ]);
      if (hits.length && !misses.length) return sayYes(hits[hits.length - 1]);
      if (hits.length) {
        return sim.game.rng.pick([
          `${misses[0][0].toUpperCase()}${misses[0].slice(1)}? No, nothing like that. But mostly ${c.complaint[0].toLowerCase()}`,
          `No ${misses[0]} that I've noticed. Mainly it's just that ${c.complaint[0].toLowerCase()}`,
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
      return `${c.complaint[0]} That's really all I can tell you — I'm not the doctor here.`;
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
// Typed orders shouldn't demand the exact trade name. Drug CLASSES, common
// brand names and plain-English phrasings all resolve to the pharmacy id, so
// "give a beta blocker" / "start some LR" / "tylenol" all land correctly.
const ALIASES = {
  // analgesia / antipyretics
  wrap: 'nsaid', splint: 'nsaid', bandage: 'nsaid', ice: 'nsaid', advil: 'nsaid', ibuprofen: 'nsaid',
  motrin: 'nsaid', naproxen: 'nsaid', aleve: 'nsaid', nsaids: 'nsaid', toradol: 'nsaid', ketorolac: 'nsaid',
  tylenol: 'nsaid', acetaminophen: 'nsaid', paracetamol: 'nsaid', antipyretic: 'nsaid', antipyretics: 'nsaid',
  pain: 'nsaid', analgesic: 'nsaid', // bare "something for the pain" → first-line analgesia
  'pain meds': 'morphine', 'pain medicine': 'morphine', 'pain control': 'morphine', analgesia: 'morphine',
  opioid: 'morphine', opiate: 'morphine', narcotic: 'morphine', fentanyl: 'morphine', dilaudid: 'morphine',
  hydromorphone: 'morphine', 'iv opioid': 'morphine',
  // oxygen
  o2: 'oxygen', oxygen: 'oxygen', 'nasal cannula': 'oxygen', 'non rebreather': 'oxygen',
  nrb: 'oxygen', 'supplemental oxygen': 'oxygen',
  // volume
  saline: 'fluids', 'normal saline': 'fluids', ns: 'fluids', lr: 'fluids', 'lactated ringers': 'fluids',
  ringers: 'fluids', crystalloid: 'fluids', crystalloids: 'fluids', bolus: 'fluids', 'fluid bolus': 'fluids',
  'iv fluids': 'fluids', 'iv fluid': 'fluids', hydrate: 'fluids', hydration: 'fluids',
  rehydrate: 'fluids', rehydration: 'fluids', fluid: 'fluids', fluids: 'fluids', ivf: 'fluids',
  'banana bag': 'fluids', resuscitate: 'fluids',
  // sedation
  sedate: 'sedative', sedation: 'sedative', 'calm them': 'sedative', versed: 'sedative',
  midazolam: 'sedative', propofol: 'sedative', 'chemical restraint': 'sedative',
  benzodiazepine: 'benzo', benzodiazepines: 'benzo', benzos: 'benzo', benzo: 'benzo',
  ativan: 'benzo', lorazepam: 'benzo',
  diazepam: 'benzo', valium: 'benzo', antipsychotic: 'haloperidol', haldol: 'haloperidol',
  // blood
  blood: 'prbc', transfuse: 'prbc', transfusion: 'prbc', 'packed cells': 'prbc', prbcs: 'prbc',
  // glycemic
  sugar: 'd50', glucose: 'd50', dextrose: 'd50', 'd 50': 'd50', amp: 'd50',
  // thrombolysis / cardiac
  'clot buster': 'tpa', thrombolytic: 'tpa', thrombolysis: 'tpa', alteplase: 'tpa', lytics: 'tpa',
  'beta blocker': 'metoprolol', 'beta blockers': 'metoprolol', bblocker: 'metoprolol',
  lopressor: 'metoprolol', 'rate control': 'metoprolol',
  epinephrine: 'epi', epipen: 'epi', adrenaline: 'epi', epi: 'epi', pressor: 'epi', pressors: 'epi',
  vasopressor: 'epi', vasopressors: 'epi',
  asa: 'aspirin', 'baby aspirin': 'aspirin',
  nitro: 'nitroglycerin', ntg: 'nitroglycerin',
  'calcium channel blocker': 'nicardipine', diltiazem: 'nicardipine', cardizem: 'nicardipine',
  diuretic: 'furosemide', lasix: 'furosemide', 'water pill': 'furosemide',
  anticoagulant: 'heparin', 'blood thinner': 'heparin', lovenox: 'heparin', enoxaparin: 'heparin',
  // antimicrobials
  antibiotic: 'ceftriaxone', antibiotics: 'ceftriaxone', abx: 'ceftriaxone', rocephin: 'ceftriaxone',
  'broad spectrum': 'ceftriaxone', cephalosporin: 'ceftriaxone', 'iv antibiotics': 'ceftriaxone',
  penicillin: 'amoxicillin', amox: 'amoxicillin', augmentin: 'amoxicillin', ampicillin: 'amoxicillin',
  zpak: 'azithromycin', 'z pak': 'azithromycin', macrolide: 'azithromycin', zithromax: 'azithromycin',
  tetracycline: 'doxycycline', doxy: 'doxycycline',
  vanc: 'vancomycin', vanco: 'vancomycin',
  flagyl: 'metronidazole',
  antifungal: 'antifungal', 'antifungal cream': 'antifungal', cream: 'antifungal',
  antiviral: 'acyclovir',
  // resp / allergy
  neb: 'albuterol', nebulizer: 'albuterol', inhaler: 'albuterol', bronchodilator: 'albuterol',
  salbutamol: 'albuterol', duoneb: 'albuterol',
  steroid: 'steroids', corticosteroid: 'steroids', solumedrol: 'steroids', prednisone: 'steroids',
  methylprednisolone: 'steroids', dexamethasone: 'steroids',
  antihistamine: 'antihistamine', benadryl: 'antihistamine', diphenhydramine: 'antihistamine',
  // gi
  zofran: 'ondansetron', antiemetic: 'ondansetron', 'anti emetic': 'ondansetron',
  // reversal (specific — kept exact on the treatment side)
  narcan: 'naloxone',
  // neuro
  anticonvulsant: 'levetiracetam', keppra: 'levetiracetam', antiepileptic: 'levetiracetam',
  mag: 'magnesium',
};

// longest alias first, so a specific phrase beats a substring of it
// ("blood thinner" → heparin, not "blood" → PRBC)
const ALIAS_ORDER = Object.entries(ALIASES).sort((a, b) => b[0].length - a[0].length);

export function matchTreatment(text) {
  const q = norm(text);
  if (!q) return null;
  for (const [alias, id] of ALIAS_ORDER) {
    if (new RegExp(`\\b${alias}\\b`).test(q)) return id; // word-bounded: "juice" must not match "ice"
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
