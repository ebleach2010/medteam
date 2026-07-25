// The Adam computer's key-proxy — a Cloudflare Worker.
//
// The MedTeam web build is a PUBLIC static site, so it can never hold the
// OpenAI key (anyone could read it from the bundle and OpenAI would auto-revoke
// it). This tiny relay is the "computer in the middle": the browser posts a
// chat here, THIS worker adds the secret key and forwards it to ChatGPT, and
// only the reply comes back. The key lives solely in `env.OPENAI_API_KEY`
// (a Wrangler secret) — never in the game, never in the browser.
//
// Deploy: see worker/README.md.  Two commands:
//   wrangler secret put OPENAI_API_KEY      # paste a FRESH, rotated key
//   wrangler deploy

const ALLOWED_ORIGINS = [
  'https://ebleach2010.github.io',
  'http://localhost:5199',            // vite dev
  'http://localhost:5188',            // vite preview
];
const MODEL = 'gpt-4o';
const MAX_TOKENS = 400;               // server-capped — the client can't ask for more
const MAX_MESSAGES = 40;              // trim runaway histories
const MAX_BODY = 24 * 1024;           // 24 KB request cap
const RATE_LIMIT = 40;                // requests per IP per window
const RATE_WINDOW = 60;               // seconds

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin);

    // only the game's own origins may call this (raises the bar; not bulletproof
    // against non-browser clients — the rate limit below is the real backstop)
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'forbidden origin' }, 403, origin);
    if (!env.OPENAI_API_KEY) return json({ error: 'proxy missing OPENAI_API_KEY secret' }, 500, origin);

    // per-IP rate limit. Prefer the native binding if bound; else a KV counter.
    const ip = request.headers.get('cf-connecting-ip') || 'anon';
    if (env.ADAM_RL?.limit) {
      const { success } = await env.ADAM_RL.limit({ key: ip });
      if (!success) return json({ error: 'rate limited — slow down' }, 429, origin);
    } else if (env.ADAM_KV) {
      const k = `rl:${ip}:${Math.floor(Date.now() / 1000 / RATE_WINDOW)}`;
      const n = parseInt((await env.ADAM_KV.get(k)) || '0', 10) + 1;
      if (n > RATE_LIMIT) return json({ error: 'rate limited — slow down' }, 429, origin);
      await env.ADAM_KV.put(k, String(n), { expirationTtl: RATE_WINDOW * 2 });
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: 'request too large' }, 413, origin);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'bad JSON' }, 400, origin); }

    let messages = Array.isArray(body?.messages) ? body.messages : null;
    if (!messages || !messages.length) return json({ error: 'messages[] required' }, 400, origin);
    // sanitise: only role/content strings, bounded count
    messages = messages.slice(-MAX_MESSAGES)
      .filter((m) => m && typeof m.content === 'string' && ['system', 'user', 'assistant'].includes(m.role))
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, temperature: 0.8, messages }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return json({ error: `openai ${res.status}`, detail: detail.slice(0, 200) }, 502, origin);
      }
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content?.trim() || '…';
      return json({ reply }, 200, origin);
    } catch (e) {
      return json({ error: 'upstream failure', detail: String(e).slice(0, 200) }, 502, origin);
    }
  },
};
