/* llm-cascade.mjs — multi-provider LLM fallback cascade for the Aria chat
 * endpoint (handleAriaChat in worker.mjs).
 *
 * All 6 providers speak the OpenAI-compatible /chat/completions shape
 * (system + messages in, choices[0].message.content out), so one request
 * builder + response parser covers all of them.
 *
 * Order matters — tries each in turn, returns the first successful text
 * response. A provider is skipped (not failed) if its secret isn't set,
 * so this degrades gracefully as Kyle adds `wrangler secret put` keys
 * one at a time.
 *
 * Model IDs verified live against each provider's API on 2026-07-17 —
 * see verification notes below, don't trust these blindly on a future edit.
 *
 *  - NVIDIA NIM: model id is `nvidia/nemotron-3-ultra-550b-a55b` (single
 *    `nvidia/` prefix — NOT double-prefixed).
 *  - OpenRouter: `tencent/hy3` (paid, ~$0.0000002/prompt-tok — negligible).
 *  - Mistral: `mistral-small-latest` (tracks their current small model).
 *  - Groq: `llama-3.3-70b-versatile`.
 *  - Cerebras: `zai-glm-4.7` — this is a REASONING model. It burns a
 *    variable, sometimes large (300-700+) chunk of max_tokens on hidden
 *    reasoning before emitting the JSON reply, and if max_tokens is too
 *    small the JSON gets truncated (finish_reason: "length") or comes
 *    back completely empty. max_tokens must stay generous (2000) for
 *    this provider to reliably finish.
 *  - Gemini: `gemini-2.0-flash` via the OpenAI-compat shim at
 *    `/v1beta/openai/chat/completions`. Confirmed live 2026-07-17 that
 *    this model id is real and reachable with a Bearer key (HTTP 429
 *    quota-exceeded, not 404 model-not-found — a nonsense model id
 *    correctly 404s, so this distinguishes "valid model, no quota" from
 *    "wrong model id"). Google's current docs lead with newer
 *    `gemini-3.5-flash` / `gemini-2.5-flash`, but those two 403'd with
 *    "project has been denied access" on the same key — 2.0-flash is
 *    the generation this key/project can actually reach. Standard
 *    system-role-in-messages shape works the same as every other rung
 *    here (no separate systemInstruction field needed).
 */

const PROVIDERS = [
  {
    name: 'nvidia',
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    keyEnv: 'NVIDIA_API_KEY',
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
  },
  {
    name: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    keyEnv: 'OPENROUTER_API_KEY',
    model: 'tencent/hy3',
  },
  {
    name: 'mistral',
    url: 'https://api.mistral.ai/v1/chat/completions',
    keyEnv: 'MISTRAL_API_KEY',
    model: 'mistral-small-latest',
  },
  {
    name: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyEnv: 'GROQ_API_KEY',
    model: 'llama-3.3-70b-versatile',
  },
  {
    name: 'cerebras',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    keyEnv: 'CEREBRAS_API_KEY',
    model: 'zai-glm-4.7',
  },
  {
    name: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyEnv: 'GEMINI_API_KEY',
    model: 'gemini-2.0-flash',
  },
];

// Per-provider timeout so one hung provider doesn't stall the whole cascade
// and blow past Workers' CPU/wall-clock limits.
const PROVIDER_TIMEOUT_MS = 15000;

// Same fence-strip + brace-extract approach as worker.mjs's own parse block
// (kept independent/duplicated on purpose — this is only a cascade-internal
// quality gate for picking a provider, not the authoritative parse, which
// stays in worker.mjs untouched).
function looksLikeAriaJson(raw) {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return false;
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null
      && 'reply' in parsed && 'extracted' in parsed && 'stage' in parsed;
  } catch {
    return false;
  }
}

/**
 * Try each provider in order; return the first successful text response.
 * @param {object} env - Worker env (holds the *_API_KEY secrets)
 * @param {object} opts
 * @param {string} opts.system - system prompt
 * @param {Array<{role:string, content:string}>} opts.messages - conversation turns
 * @param {number} [opts.max_tokens=2000]
 * @param {number} [opts.temperature=0.4]
 * @returns {Promise<{text: string, provider: string}>}
 * @throws if every provider is unavailable, errored, or returned empty content
 */
export async function cascadeChat(env, { system, messages, max_tokens = 2000, temperature = 0.4 }) {
  const errors = [];

  for (const p of PROVIDERS) {
    const key = env[p.keyEnv];
    if (!key) {
      errors.push(`${p.name}: no key configured`);
      continue;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

    try {
      const r = await fetch(p.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: p.model,
          max_tokens,
          temperature,
          messages: [{ role: 'system', content: system }, ...messages],
        }),
        signal: controller.signal,
      });

      if (!r.ok) {
        const bodyText = await r.text();
        errors.push(`${p.name}: HTTP ${r.status} ${bodyText.slice(0, 200)}`);
        continue;
      }

      const data = await r.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text || !text.trim()) {
        errors.push(`${p.name}: empty content (finish_reason=${data.choices?.[0]?.finish_reason})`);
        continue;
      }

      // Quality gate — verified live (2026-07-17) that weaker open models
      // (nemotron, tencent/hy3) reliably return valid JSON on turn 1 but
      // silently degrade to plain prose once real conversation history
      // builds up, even though they returned HTTP 200 with non-empty text.
      // Aria's caller has no LLM fallback for malformed JSON, so accepting
      // prose here would surface as a dead-end 502 to a real homeowner
      // mid-conversation. Reject it here instead and fall through to the
      // next provider — this check does NOT replace worker.mjs's own parse
      // logic downstream, it only decides which provider's answer to trust.
      if (!looksLikeAriaJson(text)) {
        errors.push(`${p.name}: response was not valid Aria JSON (rejected by quality gate)`);
        continue;
      }

      return { text, provider: p.name };
    } catch (err) {
      errors.push(`${p.name}: threw ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`All LLM providers failed: ${errors.join(' | ')}`);
}
