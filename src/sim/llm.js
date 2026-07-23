// Live Claude for the typed bars. When an API key is connected (🔑 on the
// title screen), ASK / TREAT / TALK-DOWN / DIAGNOSE run through the real
// Claude API straight from the browser; without a key — or when the network
// is blocked (the claude.ai artifact sandbox blocks ALL requests) — every
// call falls back to the local matcher in talk.js, so the game always works.
import Anthropic from '@anthropic-ai/sdk';
import { answerQuestion, deescalate as localDeescalate, matchTreatment, judgeDiagnosis } from './talk.js';
import { MEDS } from '../data/meds.js';

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
    c.physical ? `WHAT AN EXAM WOULD FIND: ${c.physical}` : null,
    `HOW YOU FEEL NOW: ${sim.state === 'dead' ? 'you are dead (answer with silence or a single ominous ellipsis)'
      : sim.critical ? 'crashing, scared, struggling' : sim.treated ? 'noticeably better' : 'uncomfortable and a bit impatient'}`,
    `TEMPERAMENT: ${(sim.temperament ?? 0.5) > 0.66 ? 'irritable' : (sim.temperament ?? 0.5) < 0.33 ? 'easy-going' : 'ordinary'}`,
    'Answer the staff member\'s question in 1–3 short sentences, layperson language, a little funny. Be consistent with the data above; if asked something the data doesn\'t cover, improvise something mundane that doesn\'t contradict it.',
  ].filter(Boolean).join('\n');
}

async function textCall(system, user) {
  const res = await client().messages.create({
    model: getModel(),
    max_tokens: 250, // deliberately short — game dialogue
    system,
    messages: [{ role: 'user', content: user }],
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
  if (!llmEnabled()) return answerQuestion(sim, question);
  try {
    return await textCall(persona(sim), question);
  } catch (e) {
    console.warn('Claude ask failed — local fallback:', e?.message);
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

export async function orderTreatment(sim, text) {
  if (!llmEnabled()) return { medId: matchTreatment(text) };
  try {
    const list = MEDS.map((m) => `${m.id} (${m.name})`).join(', ');
    const out = await jsonCall(
      ['You are the pharmacy computer in a hospital game. Map the clinician\'s typed order (user message) to exactly ONE med id from the list, or null if nothing reasonably fits.',
        'Orders can be colloquial: "wrap the ankle" → nsaid, "give O2" → oxygen, "push some fluids" → fluids.',
        `MED LIST: ${list}`].join('\n'),
      text,
      {
        type: 'object',
        properties: { medId: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
        required: ['medId'],
        additionalProperties: false,
      },
    );
    const id = out.medId && MEDS.some((m) => m.id === out.medId) ? out.medId : null;
    return { medId: id ?? matchTreatment(text) };
  } catch (e) {
    console.warn('Claude treat failed — local fallback:', e?.message);
    return { medId: matchTreatment(text) };
  }
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
