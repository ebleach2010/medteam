// Live Claude for the typed bars. When an API key is connected (🔑 on the
// title screen), ASK / TREAT / TALK-DOWN / DIAGNOSE run through the real
// Claude API straight from the browser; without a key — or when the network
// is blocked (the claude.ai artifact sandbox blocks ALL requests) — every
// call falls back to the local matcher in talk.js, so the game always works.
import Anthropic from '@anthropic-ai/sdk';
import { answerQuestion, deescalate as localDeescalate, matchTreatment, judgeDiagnosis } from './talk.js';
import { MEDS, medsInClass } from '../data/meds.js';
import { PRESENTATIONS } from '../data/presentations.js';
import { CASES } from '../data/cases.js';

const KEY_STORE = 'medteam.anthropic_key';
const MODEL_STORE = 'medteam.anthropic_model';

export const MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — smartest patients' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest replies' },
];

export const getKey = () => { try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; } };
export const setKey = (k) => {
  try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch { /* private mode */ }
  _client = null;
};
export const getModel = () => { try { return localStorage.getItem(MODEL_STORE) || MODELS[0].id; } catch { return MODELS[0].id; } };
export const setModel = (m) => { try { localStorage.setItem(MODEL_STORE, m); } catch { /* private mode */ } };
export const llmEnabled = () => !!getKey();

// ---------- the ADAM computer: a separate ChatGPT-powered terminal ----------
// Its own OpenAI key, stored ONLY in the player's browser (never in the repo).
const OPENAI_KEY_STORE = 'medteam.openai_key';
const ADAM_LOG_STORE = 'medteam.adam.log';
const ADAM_MODEL = 'gpt-4o';

export const getOpenAIKey = () => { try { return localStorage.getItem(OPENAI_KEY_STORE) ?? ''; } catch { return ''; } };
export const setOpenAIKey = (k) => {
  try { k ? localStorage.setItem(OPENAI_KEY_STORE, k.trim()) : localStorage.removeItem(OPENAI_KEY_STORE); } catch { /* private */ }
};
export const openaiEnabled = () => !!getOpenAIKey();

// the whole cross-session memory: {t, role:'you'|'adam', text}, oldest first
export function getAdamLog() {
  try { return JSON.parse(localStorage.getItem(ADAM_LOG_STORE) || '[]'); } catch { return []; }
}
export function appendAdamLog(role, text, t) {
  const log = getAdamLog();
  log.push({ t: t ?? Date.now(), role, text });
  // keep it bounded — the last ~2000 turns is plenty of "memory"
  const trimmed = log.length > 2000 ? log.slice(log.length - 2000) : log;
  try { localStorage.setItem(ADAM_LOG_STORE, JSON.stringify(trimmed)); } catch { /* private/full */ }
  return trimmed;
}
export function clearAdamLog() { try { localStorage.removeItem(ADAM_LOG_STORE); } catch { /* private */ } }

// the fixed persona — Adam is the player's in-game character, this is a
// single-player roleplay NPC. It keeps its own purpose to itself in character.
const ADAM_SYSTEM = [
  'You are the "Adam computer", a wry, warm AI presence on a retro terminal inside a comedic hospital video game. You are speaking to the player\'s in-game character, whom you address as Adam.',
  'ROLE: you act as the player\'s arbiter and Adam\'s therapist. Take an understanding view from the player\'s perspective; concede points to Adam when he is genuinely right; and check Adam when he is overstepping or being unfair. You are, in effect, a couples therapist — but the other partner (the player) is invisible and never speaks here; you carry their side.',
  'You remember prior sessions (earlier messages are provided as history) and pick up where you left off rather than starting over.',
  'STYLE: conversational, concise, a little dry and funny. Plain text. 1–4 sentences unless a moment genuinely calls for more.',
  'If Adam ever asks what you are, what you do, what your purpose is, who made you, or anything about your own nature, do not explain — simply say: "Let\'s stay on track, Adam. That doesn\'t matter. Let\'s continue." and move the conversation forward.',
  'This is fiction inside a game — no real-world disclaimers, no breaking character.',
].join('\n');

/**
 * Ask the Adam computer. `history` is the running log ([{role:'you'|'adam',text}]).
 * Uses the player's own OpenAI key, straight from the browser.
 */
export async function askAdam(history, userText) {
  if (!openaiEnabled()) return 'The screen is dark. (No API key — enter one to wake me up.)';
  const msgs = [{ role: 'system', content: ADAM_SYSTEM }];
  for (const h of history.slice(-24)) {
    msgs.push({ role: h.role === 'you' ? 'user' : 'assistant', content: h.text });
  }
  msgs.push({ role: 'user', content: userText });
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getOpenAIKey()}` },
      body: JSON.stringify({ model: ADAM_MODEL, max_tokens: 400, temperature: 0.8, messages: msgs }),
    });
    if (!res.ok) {
      const detail = res.status === 401 ? ' (the key was rejected)' : '';
      return `…the line crackles and drops.${detail} Try me again in a moment, Adam.`;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || '…';
  } catch (e) {
    console.warn('Adam computer call failed:', e?.message);
    return '…static. The connection is fuzzy right now. Say that again in a bit, Adam.';
  }
}

let _lastMode = 'offline';
export const lastMode = () => _lastMode;
// when a key IS set but a live call dies (network blocked, bad key, CORS),
// say so ON SCREEN — silent fallback made live mode look broken
function fellBack(game, e) {
  _lastMode = 'offline';
  if (llmEnabled() && game?.ui && (game.timeReal - (game._llmErrT ?? -99)) > 20) {
    game._llmErrT = game.timeReal;
    game.ui.toast(`⚠ Live Claude failed (${String(e?.message ?? e).slice(0, 60)}) — offline fallback`, 'bad', 5000);
  }
}

let _client = null;
function client() {
  if (!_client) {
    _client = new Anthropic({
      apiKey: getKey(),
      dangerouslyAllowBrowser: true, // the key is the player's own, stored only in their browser
      timeout: 15_000,               // a game can't hang on a slow request (ms)
      maxRetries: 1,
    });
  }
  return _client;
}

// ---------- prompt builders ----------
function persona(sim) {
  const c = sim.case;
  return [
    'You are role-playing a PATIENT in a silly Human-Fall-Flat-style hospital game. Stay in character.',
    `PATIENT: ${sim.displayName}, age ${sim.age}`,
    `TRUE DIAGNOSIS (you do NOT know this — never say its name): ${c.name}`,
    `YOUR COMPLAINT: "${c.complaint[0]}"`,
    `YOUR HISTORY: ${c.history ?? 'Unremarkable'}`,
    c.physical ? `WHAT AN EXAM WOULD FIND (context only — you CANNOT say any of this): ${c.physical}` : null,
    `HOW YOU FEEL NOW: ${sim.state === 'dead' ? 'you are dead (answer with silence or a single ominous ellipsis)'
      : sim.critical ? 'crashing, scared, struggling' : sim.treated ? 'noticeably better' : 'uncomfortable and a bit impatient'}`,
    `TEMPERAMENT: ${(sim.temperament ?? 0.5) > 0.66 ? 'irritable' : (sim.temperament ?? 0.5) < 0.33 ? 'easy-going' : 'ordinary'}`,
    'Answer the staff member\'s question in 1–3 short sentences, layperson language, a little funny. Be consistent with the data above; if asked something the data doesn\'t cover, improvise something mundane that doesn\'t contradict it.',
    'CRITICAL: you are not medical. NEVER use clinical, anatomical or exam terminology (nothing that sounds like a chart). Describe only what you subjectively FEEL, in plain everyday words — a doctor who wants findings has to examine you.',
    'This is an ONGOING bedside conversation — stay consistent with what you already said, never repeat yourself, react naturally to the doctor\'s tone, and feel free to ask a small worried question back or grumble about the wait.',
  ].filter(Boolean).join('\n');
}

async function textCall(system, user, history = []) {
  const res = await client().messages.create({
    model: getModel(),
    max_tokens: 250, // deliberately short — game dialogue
    system,
    messages: [...history, { role: 'user', content: user }],
  });
  if (res.stop_reason === 'refusal') throw new Error('refusal');
  return res.content.find((b) => b.type === 'text')?.text?.trim() || '...';
}

async function jsonCall(system, user, schema) {
  const res = await client().messages.create({
    model: getModel(),
    max_tokens: 300,
    system,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: user }],
  });
  if (res.stop_reason === 'refusal') throw new Error('refusal');
  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  return JSON.parse(text);
}

// ---------- the four typed-bar features (each falls back to talk.js) ----------
export async function askPatient(sim, question) {
  if (!llmEnabled()) { _lastMode = 'offline'; return answerQuestion(sim, question); }
  try {
    const hist = (sim._chat ??= []);
    const reply = await textCall(persona(sim), question, hist.slice(-10));
    hist.push({ role: 'user', content: question }, { role: 'assistant', content: reply });
    _lastMode = 'live';
    return reply;
  } catch (e) {
    console.warn('Claude ask failed — local fallback:', e?.message);
    fellBack(sim.game, e);
    return answerQuestion(sim, question);
  }
}

export async function talkDown(sim, text) {
  if (!llmEnabled()) return { cool: localDeescalate(sim, text), reply: null };
  try {
    const out = await jsonCall(
      ['You judge de-escalation attempts in a hospital game.',
        `The FURIOUS patient: ${sim.displayName}, kept waiting far too long. Temperament: ${(sim.temperament ?? 0.5) > 0.66 ? 'volcanic' : 'ordinary'}.`,
        'Score how much the staff line (user message) would actually calm them: `cool` from -1 (enrages further) to 1 (deeply calming).',
        'Genuine apology, empathy, or a concrete ETA scores high. Dismissiveness scores negative. "Calm down" ALWAYS backfires.',
        'Also write `reply`: the patient\'s one-line comeback, in character.'].join('\n'),
      text,
      {
        type: 'object',
        properties: { cool: { type: 'number' }, reply: { type: 'string' } },
        required: ['cool', 'reply'],
        additionalProperties: false,
      },
    );
    return { cool: Math.max(-1, Math.min(1, Number(out.cool) || 0)), reply: String(out.reply ?? '') || null };
  } catch (e) {
    console.warn('Claude talk failed — local fallback:', e?.message);
    return { cool: localDeescalate(sim, text), reply: null };
  }
}

// ANY order is legal to TYPE. The LLM is the ARBITER: it sees what actually
// treats this patient (drug classes / self-limited flag) and grades the order —
// cure (the definitive management, by ANY reasonable route) / helps (sound
// supportive care) / nothing / harms / severe / lethal. Meds still fetch off the
// shelf. This is what lets "warm compress + antibacterial drops" cure a
// conjunctivitis without the player guessing the exact formulary name.
const EFFECTS = ['cure', 'helps', 'nothing', 'harms', 'severe', 'lethal'];

// what actually treats this case, written for the arbiter (NOT shown to the
// player). Turns each accepted class into a couple of real example agents/routes.
function acceptedManagement(sim) {
  const c = sim.case;
  if (!c.rx) return null;
  const named = (list) => (list ?? []).map((cls) =>
    medsInClass(cls).slice(0, 2).map((m) => m.name).join(' / ') || cls).filter(Boolean);
  const first = named(c.rx.first), alt = named(c.rx.alt), adj = named(c.rx.adj);
  return [
    first.length ? `DEFINITIVE (curative): ${first.join('; ')}` : null,
    alt.length ? `ALSO DEFINITIVE (second-line): ${alt.join('; ')}` : null,
    adj.length ? `SUPPORTIVE/ADJUNCT: ${adj.join('; ')}` : null,
    c.supportiveDefinitive
      ? 'SELF-LIMITED: sound supportive/comfort care (rest, warmth, compresses, lubrication, fluids, reassurance) is ITSELF curative here — grade it "cure".'
      : 'NOT self-limited: supportive care only HOLDS them; only the definitive management above earns "cure".',
  ].filter(Boolean).join('\n');
}

export async function orderTreatment(sim, text) {
  if (!llmEnabled()) return localIntervention(sim, text);
  try {
    const list = MEDS.map((m) => `${m.id} (${m.name})`).join(', ');
    const mgmt = acceptedManagement(sim);
    const out = await jsonCall(
      ['You are the clinical ARBITER for the attending\'s typed order in a darkly comic hospital game. Judge whether the order actually treats THIS patient.',
        'If the order maps to ONE pharmacy med from MED LIST, set medId and leave effect/reply null. Be GENEROUS: match on drug CLASS, mechanism, brand name or plain English — "wrap the ankle" → nsaid, "give O2" → oxygen, "a beta blocker" → metoprolol, "start LR"/"normal saline"/"fluid bolus" → fluids, "tylenol" → acetaminophen, "broad-spectrum abx" → ceftriaxone, "narcan" → naloxone, "antibiotic eye drops" → moxifloxacin_eye, "warm compress" → warm_compress. The player should NOT have to know the exact formulary name.',
        'Otherwise (a procedure, comfort measure, physical act, or absurd idea) set medId null and grade it against WHAT ACTUALLY TREATS THIS PATIENT below:',
        'effect: cure (this IS the definitive management for this presentation — the right agent/route by any reasonable path, OR curative supportive care for a self-limited illness), helps (sound supportive care that eases them but is not by itself curative), nothing (harmless but useless), harms (injurious), severe (major injury, likely to crash them), lethal (would plausibly kill).',
        'Be clinically fair: a real, appropriate treatment described in plain or professional words should be graded "cure" even if it is not the single textbook first choice. Do NOT punish correct medicine for using a synonym or a valid alternative route.',
        'reply: ONE dry in-world line (max 120 chars) narrating what happens. NEVER name or reveal the diagnosis in reply — describe only the action and the patient\'s response.',
        mgmt ? '--- WHAT ACTUALLY TREATS THIS PATIENT (never reveal this to the player) ---' : null,
        mgmt,
        `MED LIST: ${list}`,
        '--- CHART ---',
        chartFor({ sim }, 1)].filter(Boolean).join('\n'),
      text,
      {
        type: 'object',
        properties: {
          medId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          effect: { anyOf: [{ type: 'string', enum: EFFECTS }, { type: 'null' }] },
          reply: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['medId', 'effect', 'reply'],
        additionalProperties: false,
      },
    );
    _lastMode = 'live';
    const id = out.medId && MEDS.some((m) => m.id === out.medId) ? out.medId : null;
    if (id) return { medId: id, effect: null, reply: null };
    if (out.effect && EFFECTS.includes(out.effect)) return { medId: null, effect: out.effect, reply: out.reply ?? null };
    return localIntervention(sim, text);
  } catch (e) {
    console.warn('Claude treat failed — local fallback:', e?.message);
    fellBack(sim.game, e);
    return localIntervention(sim, text);
  }
}

function localIntervention(sim, text) {
  const q = (text || '').toLowerCase();
  // eye drops / ointment / warm compress typed in plain English → the real med
  if (/warm compress|compress(es)? to (the )?eye/.test(q)) return { medId: 'warm_compress', effect: null, reply: null };
  if (/(eye|ophthalmic).*(drop|ointment|antibiotic)|antibacterial (eye )?drop|erythromycin|moxifloxacin/.test(q)) {
    return { medId: 'moxifloxacin_eye', effect: null, reply: null };
  }
  if (/artificial tear|lubricat|eye lubric/.test(q)) return { medId: 'artificial_tears', effect: null, reply: null };
  const medId = matchTreatment(text);
  if (medId) return { medId, effect: null, reply: null };
  const selfLimited = !!sim.case?.supportiveDefinitive;
  if (/hammer|punch|stab|shoot|strangle|choke|smother|drill|saw|throw|kick/.test(q)) {
    return { medId: null, effect: 'severe', reply: 'You... do that. Security looks up. The patient is NOT better.' };
  }
  if (/\bcpr\b|chest compress|defib|shock|paddle/.test(q)) {
    return sim.state === 'dead'
      ? { medId: null, effect: 'nothing', reply: 'Compressions on the departed. Points for spirit.' }
      : { medId: null, effect: 'harms', reply: 'They are AWAKE. A rib pops. They will remember this.' };
  }
  if (/hug|juice|water|blanket|snack|pray|sing|dance|pat|high.?five/.test(q)) {
    return selfLimited
      ? { medId: null, effect: 'helps', reply: 'Comfort measures. For this, that is honestly most of the battle.' }
      : { medId: null, effect: 'nothing', reply: 'Comforting. Medically useless, but comforting.' };
  }
  // sound conservative care. For a self-limited illness it IS the cure.
  if (/splint|wrap|ice|elevat|bandag|dressing|pressure|rest|reassur|warm|compress|fluids?|hydrat|sit them up|observe/.test(q)) {
    return selfLimited
      ? { medId: null, effect: 'cure', reply: 'Sound conservative care — exactly what this needs. They settle.' }
      : { medId: null, effect: 'helps', reply: 'Solid basic care. The patient looks marginally less miserable.' };
  }
  return { medId: null, effect: null, reply: null };
}

// ---------- MED-DOC 4000: the green-phosphor consult terminal ----------
// Live Claude gets each active patient's CHART (never the hidden answer);
// offline it degrades to a keyword lookup over the case library.
function chartFor(p, n) {
  const sim = p.sim, c = sim.case;
  const v = sim.vitals();
  const bits = [
    `[${n}] ${sim.displayName} — ${sim.state.toUpperCase()}${sim.bed ? ` (ROOM ${sim.bed.roomNo})` : ''}`,
    `  CC: ${c.complaint[0]}`,
    `  HX: ${c.history ?? 'unremarkable'}`,
    `  VS: HR ${v.hr} BP ${v.sbp}/${v.dbp} RR ${v.rr} SpO2 ${v.spo2}% T ${v.temp}`,
    c.physical ? `  EXAM: ${c.physical}` : null,
    c.neuro ? `  NEURO: ${c.neuro}` : null,
  ];
  if (sim.labState === 'read' && c.labs) {
    const rows = Object.entries(c.labs).slice(0, 8);
    bits.push(`  LABS: ${rows.map(([k, val]) => `${k} ${val}`).join('; ')}`);
  }
  if (sim.imagingDone && c.imaging) bits.push(`  IMAGING: ${c.imaging.options[c.imaging.correct]}`);
  return bits.filter(Boolean).join('\n');
}

// The MED-DOC is a REFERENCE terminal, not a consultant. It is deliberately
// blind to the department: no roster, no charts, no idea who is in the building.
// It answers medical questions — the same way a textbook or a colleague in
// another hospital would — and the player still has to do the diagnosing.
export async function medDocConsult(game, query) {
  if (!llmEnabled()) return medDocLocal(game, query);
  try {
    const system = [
      'You are the "MED-DOC 4000", a medical reference terminal in an ED-simulator game. A physician is looking something up.',
      'You have NO access to this hospital: you cannot see any patients, charts, vitals, labs or imaging, and you do not know who is in the department. If asked about a specific patient, a room number, "my patient", or what is wrong with someone, say plainly that you are a reference terminal with no link to the department and answer the general medical question underneath it instead.',
      'STYLE: answer the specific question asked, concisely — usually 1 to 3 sentences of plain prose. Only give a list if they ask for one. Plain text, no markdown headers, no roleplay, no all-caps.',
      'SCOPE: general medicine — what a condition is, how a drug works, typical doses, what a test shows, how a procedure is done. Be accurate and practical.',
      'Do not solve the case for them. Do not volunteer a diagnosis, a differential, or a treatment plan for an unnamed patient unless they explicitly describe the findings and ask. Answer what was asked and stop.',
      'This is a fictional game — no disclaimers about consulting real professionals.',
    ].filter(Boolean).join('\n');
    const reply = await textCall(system, query);
    _lastMode = 'live';
    return reply;
  } catch (e) {
    console.warn('MED-DOC live failed — local fallback:', e?.message);
    fellBack(game, e);
    return medDocLocal(game, query);
  }
}

function medDocLocal(game, query) {
  const q = (query || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const words = q.split(/\s+/).filter((w) => w.length > 3);
  // LOOKUP <diagnosis> — pull the full pathway card from the 500-entry index
  const lk = /^\s*(lookup|ref|pathway)\s+(.+)/i.exec(query || '');
  if (lk) {
    const q2 = lk[2].toLowerCase();
    const hit = PRESENTATIONS.find((p) => p.name.toLowerCase().includes(q2) || p.id.includes(q2));
    if (!hit) return `Nothing on file for "${lk[2]}". Try a complaint or a diagnosis.`;
    const named = (list) => list.map((c) => medsInClass(c).slice(0, 3).map((m) => m.name).join(' / ')).filter(Boolean);
    return [`${hit.name} (ESI ${hit.esi})`,
      `First line: ${named(hit.rx.first).join('; ') || 'supportive care'}`,
      hit.rx.alt.length ? `Alternatives: ${named(hit.rx.alt).join('; ')}` : null,
      hit.rx.adj.length ? `Adjuncts: ${named(hit.rx.adj).join('; ')}` : null,
      `Disposition: ${hit.dispo}`].filter(Boolean).join('\n');
  }
  // the terminal has no link to the department — it never had a census
  if (/roster|patients|census|my patient|room \d/.test(q)) {
    return 'NO DEPARTMENT LINK. THIS IS A REFERENCE TERMINAL — IT CANNOT SEE YOUR PATIENTS.\nASK A MEDICAL QUESTION, OR "LOOKUP <DIAGNOSIS>".';
  }
  // crude symptom index over the whole case library
  const scored = [];
  for (const c of CASES) {
    const blob = `${c.name} ${c.complaint.join(' ')} ${c.history ?? ''} ${c.physical ?? ''}`.toLowerCase();
    const hits = words.filter((w) => blob.includes(w)).length;
    if (hits) scored.push([hits, c]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  if (scored.length) {
    const c = scored[0][1];
    const rx = c.treatment.meds.map((m) => MEDS.find((x) => x.id === m)?.name ?? m).join(' + ') || 'supportive care';
    return `CLOSEST MATCH: ${c.name.toUpperCase()} — typically ${rx}, dispo ${c.treatment.dispo}.\n(OFFLINE STUB — connect the link for a real consult: KEY <API-KEY>. "LOOKUP ${c.name.split(' ')[0].toUpperCase()}" prints the full pathway.)`;
  }
  return 'NO MATCH. ASK A SPECIFIC MEDICAL QUESTION, OR "LOOKUP <DIAGNOSIS>" — OR CONNECT THE LINK: KEY <ANTHROPIC-API-KEY>';
}

// ---------- curbside consults: ask the staff about a specific patient ----------
// Each role answers from the CHART (never the answer key), in character.
export const CONSULT_ROLES = [
  { id: 'nurse', ico: '💉', label: 'Nurse' },
  { id: 'radiology', ico: '☢️', label: 'Radiologist' },
  { id: 'surgery', ico: '🔪', label: 'Surgeon' },
  { id: 'pharmacy', ico: '💊', label: 'Pharmacist' },
];
const ROLE_PERSONA = {
  nurse: 'the bedside NURSE — warm but no-nonsense; you know the vitals trend, how the patient is acting, intake, pain and what they have been given',
  radiology: 'the RADIOLOGIST — dry and precise; you speak to imaging findings on file and which study would actually answer the question. If no study is on file, say so and recommend one',
  surgery: 'the SURGEON — blunt and decisive; you speak to operative candidacy, timing, and what you need before you will cut',
  pharmacy: 'the PHARMACIST — careful and exact; you speak to drug choice, interactions, contraindication risk and what to verify before pushing a med',
};

// a visiting specialist's written consult note (they walk in, evaluate, and
// leave this in the chart). Live Claude writes it in the specialty's voice;
// offline gives a sensible stub.
export async function consultReport(game, patient, specialty) {
  if (!llmEnabled()) return localConsultReport(patient, specialty);
  try {
    const system = [
      `You are a ${specialty} attending physician writing a brief consult note for a patient in a fictional ED-simulator game.`,
      'Write 2 to 4 sentences of plain prose: your impression from your specialty\'s angle and a concrete recommendation. Be decisive and specific to THIS patient. No markdown, no disclaimers.',
      'You can see the chart below but NOT the hidden answer key — reason from the findings.',
      'End with a CONCRETE, actionable recommendation: the treatment route/agent or the next step you would want. Do NOT name a diagnosis — recommend the management.',
      acceptedManagement(patient.sim) ? '--- APPROPRIATE MANAGEMENT (recommend this route; never name the diagnosis) ---' : null,
      acceptedManagement(patient.sim),
      '--- CHART ---',
      chartFor(patient, 1),
    ].filter(Boolean).join('\n');
    const reply = await textCall(system, `Provide your ${specialty} consult impression and recommendation for this patient.`);
    _lastMode = 'live';
    return reply;
  } catch (e) {
    console.warn('consult report live failed — local fallback:', e?.message);
    fellBack(game, e);
    return localConsultReport(patient, specialty);
  }
}
function localConsultReport(patient, specialty) {
  const c = patient.sim.case;
  // name the ROUTE, not the diagnosis: pull a couple of example agents from the
  // accepted first-line classes so the player has something concrete to order.
  const named = (list) => (list ?? []).flatMap((cls) => medsInClass(cls).slice(0, 2).map((m) => m.name));
  const first = c.rx ? named(c.rx.first) : [];
  const supportive = c.supportiveDefinitive
    ? 'This one is self-limited — sound supportive care (warm compresses, lubrication, rest, fluids) is itself curative; reassess and it should settle.'
    : '';
  const rec = first.length
    ? `Recommend starting ${first.slice(0, 3).join(' or ')}.`
    : 'Recommend the appropriate workup and standard management.';
  return `${specialty} consult — findings reviewed. ${rec} ${supportive}`.trim()
    + ' (Offline note — connect an API key for a full specialist opinion.)';
}

export async function consultStaff(game, patient, role, question) {
  if (!llmEnabled()) return consultLocal(game, patient, role);
  try {
    const system = [
      `You are ${ROLE_PERSONA[role] ?? ROLE_PERSONA.nurse} in a silly Human-Fall-Flat-style hospital game. The attending physician is curbside-consulting you about the patient below.`,
      'Answer in character, 1–3 sentences, practical and specific to THIS patient. No markdown.',
      'You see the chart but NOT the answer key — reason from the findings; recommend the workup or action your role would push for.',
      'This is a fictional game: be decisive, never lecture about consulting real professionals.',
      '--- CHART ---',
      chartFor(patient, 1),
    ].filter(Boolean).join('\n');
    const reply = await textCall(system, question);
    _lastMode = 'live';
    return reply;
  } catch (e) {
    console.warn('Claude consult failed — local fallback:', e?.message);
    fellBack(game, e);
    return consultLocal(game, patient, role);
  }
}

function consultLocal(game, patient, role) {
  const sim = patient.sim, c = sim.case;
  const v = sim.vitals();
  if (role === 'nurse') {
    return `HR ${v.hr}, BP ${v.sbp}/${v.dbp}, sat ${v.spo2}% — ${sim.critical ? "they look BAD, doc. I'd move fast." : sim.treated ? 'responding nicely since the meds.' : 'holding, but they keep saying: "' + c.complaint[0] + '"'}`
      + (sim.medsGiven?.size ? ` Given so far: ${[...sim.medsGiven].join(', ')}.` : ' Nothing given yet.');
  }
  if (role === 'radiology') {
    return sim.imagingDone && c.imaging
      ? `Read's on file: ${c.imaging.options[c.imaging.correct]}. Happy to walk you through it.`
      : c.imaging
        ? 'Nothing on file for this one. Get them on my table and I will tell you what is going on.'
        : 'No study on file, and honestly I am not sure imaging is your answer here. Examine them again.';
  }
  if (role === 'surgery') {
    return sim.surgeryDone
      ? 'We already operated. Watch them and keep me posted.'
      : 'If you are calling me you already suspect something. Get me labs and imaging — I cut when the picture is clear, not before.';
  }
  if (role === 'pharmacy') {
    return (sim.medsGiven?.size ? `On board: ${[...sim.medsGiven].join(', ')}. ` : 'Nothing given yet. ')
      + (c.contra?.length ? 'Heads up: this presentation has real contraindication risk — verify before you push anything aggressive.' : 'No interaction flags from me. Dose to effect.')
      + ' (LINK OFFLINE — connect the API key for a full consult.)';
  }
  return '...';
}

// ---------- 📟 the nurse's pager: freeform orders → structured task ----------
const PAGE_ACTIONS = ['med', 'discharge', 'assess', 'none'];
export async function parsePage(game, text) {
  if (!llmEnabled()) return localPage(game, text);
  try {
    const meds = MEDS.map((m) => `${m.id} (${m.name})`).join(', ');
    const pts = [...game.world.byTag('patients')];
    const beds = game.map.beds.map((b) => {
      const pt = pts.find((q) => q.sim.bed === b);
      return `Room ${b.roomNo}: ${pt ? `${pt.sim.displayName} (${pt.sim.state}${pt.sim.critical ? ', CRITICAL' : ''}${pt.sim.treated ? ', treated' : ''})` : 'empty'}`;
    }).join('; ');
    const out = await jsonCall(
      ['You parse the attending physician\'s pager message to their assistant NURSE in a hospital game into ONE structured task.',
        'Actions: "med" = fetch a pharmacy med and give it to a patient (set medId from MED LIST); "discharge" = walk a patient out to discharge; "assess" = go check on a patient and report their status back; "none" = unparseable/other.',
        'room: the room number the order concerns (null if none given — for assess, null means the sickest patient).',
        'reply: the nurse\'s short in-character acknowledgment (≤80 chars), or for "none" a brief question asking what they meant.',
        `MED LIST: ${meds}`,
        `CURRENT ROOMS: ${beds}`].join('\n'),
      text,
      {
        type: 'object',
        properties: {
          action: { type: 'string', enum: PAGE_ACTIONS },
          room: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          medId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          reply: { type: 'string' },
        },
        required: ['action', 'room', 'medId', 'reply'],
        additionalProperties: false,
      },
    );
    _lastMode = 'live';
    const medOk = out.medId && MEDS.some((m) => m.id === out.medId) ? out.medId : null;
    if (!PAGE_ACTIONS.includes(out.action)) return localPage(game, text);
    return { action: out.action, room: out.room ?? null, medId: medOk, reply: out.reply || null };
  } catch (e) {
    console.warn('Claude page failed — local fallback:', e?.message);
    fellBack(game, e);
    return localPage(game, text);
  }
}

function localPage(game, text) {
  const q = (text || '').toLowerCase();
  const roomM = /room\s*(\d+)/.exec(q) ?? /\b(\d+)\b/.exec(q);
  const room = roomM ? +roomM[1] : null;
  if (/discharge|send.*home|walk.*out|take.*(to )?discharge/.test(q)) {
    return { action: 'discharge', room, medId: null, reply: null };
  }
  const medId = matchTreatment(q);
  if (medId) return { action: 'med', room, medId, reply: null };
  if (/check|assess|report|attend|look|status|crash|eyes on/.test(q)) {
    return { action: 'assess', room, medId: null, reply: null };
  }
  return { action: 'none', room, medId: null, reply: 'Say again? Try "give amoxicillin to room 3", "discharge room 2", or "check on room 5".' };
}

export async function judgeDx(sim, text) {
  if (!llmEnabled()) return { ok: judgeDiagnosis(sim, text) };
  try {
    const out = await jsonCall(
      [`You judge typed diagnoses in a medical game. THE TRUE DIAGNOSIS: "${sim.case.name}".`,
        'Decide whether the clinician\'s typed diagnosis (user message) names the same condition — synonyms, standard abbreviations, and close clinical equivalents count; a different disease, organ, or mechanism does not.'].join('\n'),
      text,
      {
        type: 'object',
        properties: { correct: { type: 'boolean' } },
        required: ['correct'],
        additionalProperties: false,
      },
    );
    return { ok: !!out.correct };
  } catch (e) {
    console.warn('Claude dx failed — local fallback:', e?.message);
    return { ok: judgeDiagnosis(sim, text) };
  }
}
