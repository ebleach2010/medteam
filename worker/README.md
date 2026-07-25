# The Adam computer key-proxy

The MedTeam web build is a **public** static site, so it can't hold the OpenAI
key — anyone could read it from the JS bundle and OpenAI would auto-revoke it.
This little worker is the "computer in the middle": the game posts a chat to it,
the worker adds the **secret** key and forwards to ChatGPT, and only the reply
comes back. The key lives **only** here, as a server secret.

## Deploy (Cloudflare Workers — free tier is plenty)

1. Install Wrangler and log in (one time):
   ```
   npm install -g wrangler
   wrangler login
   ```
2. From this `worker/` folder, store your key as a secret (use a **fresh,
   rotated** key — not one you've pasted anywhere):
   ```
   wrangler secret put OPENAI_API_KEY
   ```
   Paste the key when prompted. It is encrypted and never shown again.
3. (Recommended) Turn on rate limiting so nobody can run up your bill:
   - Native binding: uncomment the `[[unsafe.bindings]]` block in
     `wrangler.toml`, or
   - KV fallback: `wrangler kv namespace create ADAM_KV`, then uncomment the
     `[[kv_namespaces]]` block and paste the returned `id`.
   The worker uses whichever is bound; with neither, it still runs (no limit).
4. Deploy:
   ```
   wrangler deploy
   ```
   Wrangler prints a URL like `https://adam-proxy.<you>.workers.dev`.

## Wire it into the game

Put that URL in `src/sim/llm.js`:
```js
const ADAM_PROXY_URL = 'https://adam-proxy.<you>.workers.dev';
```
Once set, the Adam computer is keyless — players never enter anything, and the
key stays hidden on the worker. (Left empty, the game falls back to the
enter-your-own-key path, so nothing breaks before you deploy.)

## Notes & limits

- Only the game's origins may call the proxy (CORS allowlist in
  `adam-proxy.js` — edit `ALLOWED_ORIGINS` if you host elsewhere). This stops
  casual browser abuse; it does **not** stop a determined `curl`, which is why
  the per-IP rate limit is the real backstop. Keep rate limiting on.
- The worker caps `max_tokens`, message count, and body size server-side.
- Every call is billed to **your** OpenAI account. If usage ever looks wrong,
  rotate the key (`wrangler secret put OPENAI_API_KEY` again) and redeploy.

## Vercel alternative

Prefer Vercel? Create `api/adam.js` with the same logic (read
`process.env.OPENAI_API_KEY`, forward `{messages}` to OpenAI, return `{reply}`,
set the CORS headers), add `OPENAI_API_KEY` under Project → Settings →
Environment Variables, `vercel deploy`, and use the resulting
`/api/adam` URL as `ADAM_PROXY_URL`.
