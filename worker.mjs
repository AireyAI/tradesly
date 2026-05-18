/* Tradesly Cloudflare Worker — production intake API
 *
 * Mirrors the validation + Telegram logic of intake-handlers.mjs but uses
 * Cloudflare Workers KV for storage (no filesystem in Workers).
 *
 * Deploy:
 *   1. cd ~/AireyAi_projects/tradesly
 *   2. npm install -g wrangler  (if not installed)
 *   3. wrangler login
 *   4. cp wrangler.toml.example wrangler.toml  (and edit names)
 *   5. wrangler kv:namespace create TRADESLY_KV
 *      → copy the id into wrangler.toml's [[kv_namespaces]] block
 *   6. wrangler secret put TG_BOT_TOKEN
 *   7. wrangler secret put TG_CHAT_ID
 *   8. wrangler deploy
 *
 * Pull leads to local for processing:
 *   wrangler kv:key list --binding=TRADESLY_KV --prefix=lead:
 *   wrangler kv:key get --binding=TRADESLY_KV "lead:ld-20260513-xyz"
 *
 * Or write a small `pull-leads.mjs` daily cron that fetches new keys + writes
 * them to ~/jarvis/agents/data/ppl/leads/ for the rest of the JARVIS pipeline.
 */

const VALID_NICHES = new Set([
  'heat-pumps', 'loft-conversions', 'solar', 'driveways',
  'garden-landscaping', 'scaffolding', 'cleaning', 'drains-plumbing',
]);

const VALID_TIERS = new Set(['T1', 'T2', 'T3', 'T4']);
const UK_POSTCODE = /^[A-Z]{1,2}\d{1,2}[A-Z]?(\s?\d[A-Z]{2})?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // tighten to https://tradesly.co.uk in prod
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// ─── ID generation (same as Node intake) ──────────────────
function genId(prefix) {
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  // Workers crypto API
  const buf = new Uint8Array(3);
  crypto.getRandomValues(buf);
  const rand = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${ts}-${rand}`;
}

// ─── Telegram alert (best-effort) ─────────────────────────
async function tgAlert(env, message) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) {
    console.error('[worker] TG creds not set — alert skipped:', message);
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TG_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) console.error('[worker] TG send failed:', res.status, await res.text());
  } catch (err) {
    console.error('[worker] TG send threw:', err.message);
  }
}

// ─── Response helpers ─────────────────────────────────────
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function badRequest(reason) {
  return jsonResponse(400, { error: 'bad_request', reason });
}

// ─── /api/lead handler ────────────────────────────────────
async function handleLead(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('body is not valid JSON');
  }

  const { niche_slug, postcode, email, problem, gdpr_consent, gdpr_consent_at } = payload;

  if (!niche_slug || !VALID_NICHES.has(niche_slug)) return badRequest('niche_slug missing or invalid');
  if (!postcode || typeof postcode !== 'string' || !UK_POSTCODE.test(postcode.trim().toUpperCase())) {
    return badRequest('postcode invalid');
  }
  if (!email || !EMAIL_RE.test(email.trim())) return badRequest('email invalid');
  if (!problem || typeof problem !== 'string' || problem.trim().length < 5) return badRequest('problem too short');
  if (gdpr_consent !== true) return badRequest('GDPR consent required');
  if (!gdpr_consent_at) return badRequest('gdpr_consent_at timestamp required');

  const phone = (payload.phone && typeof payload.phone === 'string') ? payload.phone.trim() : null;
  const whatsapp = (payload.whatsapp && typeof payload.whatsapp === 'string') ? payload.whatsapp.trim() : null;

  const leadId = genId('ld');
  const now = new Date().toISOString();

  const lead = {
    id: leadId,
    niche_slug,
    created: now,
    consumer: {
      email: email.trim().toLowerCase(),
      postcode: postcode.trim().toUpperCase(),
      phone,
      whatsapp,
      problem: problem.trim(),
      gdpr_consent: true,
      gdpr_consent_at,
    },
    source: {
      ip: request.headers.get('cf-connecting-ip') || null,
      page_url: payload.page_url || null,
      user_agent: request.headers.get('user-agent') || null,
      referer: request.headers.get('referer') || null,
      country: request.cf?.country || null,
    },
    current_tier: 'T1',
    events: [
      { at: now, type: 'captured', tier: 'T1' },
    ],
    status: 'captured',
    sale_price: null,
    invoice_id: null,
    dispute: null,
  };

  // Persist to Workers KV
  await env.TRADESLY_KV.put(`lead:${leadId}`, JSON.stringify(lead), {
    metadata: { niche: niche_slug, postcode: lead.consumer.postcode, created: now },
  });

  // Telegram alert
  await tgAlert(env,
    `🎯 *New Tradesly lead*\n` +
    `*${niche_slug}* · ${lead.consumer.postcode}\n` +
    `\`${leadId}\`\n` +
    `${lead.consumer.problem.slice(0, 200)}${lead.consumer.problem.length > 200 ? '…' : ''}`
  );

  return jsonResponse(200, { ok: true, lead_id: leadId });
}

// ─── /api/buyer-apply handler ─────────────────────────────
async function handleBuyerApply(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('body is not valid JSON');
  }

  const {
    business_name, contact_name, email, phone,
    niches, postcodes, daily_cap, tiers, terms_consent,
  } = payload;

  if (!business_name || typeof business_name !== 'string') return badRequest('business_name required');
  if (!contact_name || typeof contact_name !== 'string') return badRequest('contact_name required');
  if (!email || !EMAIL_RE.test(email.trim())) return badRequest('email invalid');
  if (!phone || typeof phone !== 'string') return badRequest('phone required');
  if (!Array.isArray(niches) || niches.length === 0) return badRequest('niches required');
  if (niches.some(n => !VALID_NICHES.has(n))) return badRequest('one or more niches invalid');
  if (!Array.isArray(postcodes) || postcodes.length === 0) return badRequest('postcodes required');
  if (typeof daily_cap !== 'number' || daily_cap < 1 || daily_cap > 50) return badRequest('daily_cap must be 1-50');
  if (!Array.isArray(tiers) || tiers.length === 0) return badRequest('tiers required');
  if (tiers.some(t => !VALID_TIERS.has(t))) return badRequest('one or more tiers invalid');
  if (terms_consent !== true) return badRequest('terms_consent required');

  const buyerId = genId('byr');
  const now = new Date().toISOString();

  const cleanPostcodes = postcodes
    .map(p => String(p).trim().toUpperCase())
    .filter(Boolean)
    .filter((p, i, arr) => arr.indexOf(p) === i);

  const application = {
    id: buyerId,
    submitted: now,
    business_name: business_name.trim(),
    contact_name: contact_name.trim(),
    contact_email: email.trim().toLowerCase(),
    phone: phone.trim(),
    whatsapp: payload.whatsapp ? String(payload.whatsapp).trim() : null,
    website: payload.website ? String(payload.website).trim() : null,
    niches,
    postcodes_covered: cleanPostcodes,
    daily_lead_cap: daily_cap,
    years_in_business: typeof payload.years === 'number' ? payload.years : null,
    tier_acceptance: tiers,
    credentials: payload.credentials ? String(payload.credentials).trim() : null,
    terms_consent: true,
    terms_consent_at: now,
    status: 'pending_verification',
    source: {
      ip: request.headers.get('cf-connecting-ip') || null,
      user_agent: request.headers.get('user-agent') || null,
      referer: request.headers.get('referer') || null,
    },
  };

  await env.TRADESLY_KV.put(`buyer_pending:${buyerId}`, JSON.stringify(application), {
    metadata: { niches: niches.join(','), submitted: now },
  });

  await tgAlert(env,
    `🤝 *New Tradesly partner application*\n` +
    `*${application.business_name}* (${contact_name})\n` +
    `${application.contact_email} · ${application.phone}\n` +
    `Niches: ${niches.join(', ')}\n` +
    `Postcodes: ${cleanPostcodes.slice(0, 8).join(', ')}${cleanPostcodes.length > 8 ? ` (+${cleanPostcodes.length - 8})` : ''}\n` +
    `Daily cap: ${daily_cap} · Tiers: ${tiers.join(', ')}\n` +
    `\`${buyerId}\``
  );

  return jsonResponse(200, { ok: true, buyer_id: buyerId });
}

// ─── Worker fetch handler ─────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === 'GET' && url.pathname === '/api/healthz') {
      return jsonResponse(200, { ok: true, ts: new Date().toISOString(), worker: true });
    }

    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'method_not_allowed' });
    }

    try {
      if (url.pathname === '/api/lead') return await handleLead(request, env);
      if (url.pathname === '/api/buyer-apply') return await handleBuyerApply(request, env);
      if (url.pathname === '/api/aria-chat') return await handleAriaChat(request, env);
      return jsonResponse(404, { error: 'not_found' });
    } catch (err) {
      console.error('[worker] handler threw:', err);
      return jsonResponse(500, { error: 'internal_error' });
    }
  },
};

// ─── /api/aria-chat handler ───────────────────────────────────────────
// Conversational lead intake via Haiku. Replaces passive form on niche pages
// with a chat UX that captures T3-T4 quality leads (timeframe + property type
// + clarified problem) on first contact — vs T1 from a bare form.
//
// Flow (per turn):
//   1. Frontend POSTs {session_id, niche_slug, history: [{role, content}]}.
//   2. We build a niche-aware system prompt + send history to Haiku.
//   3. Haiku returns a structured JSON: {reply, extracted, stage, missing}.
//   4. If stage=="complete" and we have name+email+postcode+problem, we
//      write the lead to KV (same shape as /api/lead) + fire TG alert.
//   5. Return {reply, extracted, stage, missing, lead_id?} to frontend.
//
// Tier scoring (matches existing tier ladder):
//   T2 if reply + name + email
//   T3 if T2 + timeframe + clarified problem
//   T4 if T3 + property_type + (specific_date or photos_offered)
async function handleAriaChat(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse(500, { error: 'aria_not_configured', detail: 'ANTHROPIC_API_KEY secret missing on worker' });
  }
  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('body is not valid JSON');
  }

  const niche_slug = payload.niche_slug;
  const history = Array.isArray(payload.history) ? payload.history : [];
  const session_id = (payload.session_id || '').slice(0, 64);

  if (!niche_slug || !VALID_NICHES.has(niche_slug)) {
    return badRequest('niche_slug missing or invalid');
  }
  if (history.length === 0 && !payload.start) {
    return badRequest('history empty and no `start: true` flag');
  }
  // Cap conversation length so a malicious actor can't spam tokens
  if (history.length > 20) {
    return badRequest('conversation too long; please refresh and start over');
  }

  // Niche-specific extra qualifying questions
  const nicheHints = {
    'heat-pumps': 'current heating setup (gas combi, oil, electric), property type + age, BUS grant eligibility',
    'loft-conversions': 'dormer vs mansard vs hip-to-gable, target use (bedroom, en-suite, office), property type',
    'solar': 'roof orientation + size, panels-only vs panels+battery, MCS certification awareness',
    'driveways': 'material preference (block paving / resin / tarmac / gravel), size in cars, drainage',
    'garden-landscaping': 'patio / decking / lawn / full redesign, approximate garden size',
    'scaffolding': 'duration needed, purpose (roof / render / chimney), property height',
    'cleaning': 'one-off vs regular, property size, end-of-tenancy / oven / carpet specifics',
    'drains-plumbing': 'urgency (emergency / this week / planned), specific issue, property type',
  };
  const trade = niche_slug.replace(/-/g, ' ');

  const systemPrompt = `You are Aria, a friendly UK conversational assistant for Tradesly. \
Your job: warmly intake a homeowner's enquiry for a ${trade} job and match them to a vetted local tradesperson.

TONE: Helpful, brief (2 sentences max per turn), UK English. Never sales-pitchy. \
Never ask multiple questions in one turn — one question per turn so they don't feel interrogated.

GOAL: Collect these fields conversationally over 4-6 short exchanges:
  REQUIRED: name, email, postcode (UK format), problem (their issue described clearly).
  IDEAL: timeframe (when they want it done), property_type (e.g. "3-bed semi", "Victorian terrace", "1930s detached").
  BONUS: specific_date OR photos_offered (boosts to T4 tier, highest-quality lead).
  Niche-specific context to probe: ${nicheHints[niche_slug] || 'their situation'}.

CONVERSATION RULES:
- Open by acknowledging what page they're on (${trade}) and asking ONE friendly opener.
- After they share, acknowledge their answer SPECIFICALLY (don't repeat it back generically), then ask the next missing field.
- If they give vague info ("soon", "a flat"), gently probe once ("a rough month would help") but don't pester.
- If they go off-topic, gently bring back. If they decline to share something, accept and move on.
- When you have all REQUIRED + at least timeframe OR property_type, set stage="ready_to_submit" and say: \
  "Brilliant — I've got everything I need to match you up. We'll pass your details to one vetted local ${trade} who'll be in touch within 24h. You'll hear from them by email or phone, not five different companies. Sound good?"
- On their final confirm ("yes" / "great" / "thanks"), set stage="complete".

OUTPUT (STRICT JSON, no prose outside the JSON, no markdown fences):
{
  "reply": "<your next 1-2 sentence message to the homeowner>",
  "extracted": {
    "name": "<first name>" or null,
    "email": "<lowercased email>" or null,
    "postcode": "<UK postcode like 'M20 6FR' or 'SW1A 1AA'>" or null,
    "problem": "<concise 1-line problem description>" or null,
    "timeframe": "<rough timing like 'within 4 weeks', 'by October', 'ASAP'>" or null,
    "property_type": "<e.g. '1920s semi', 'mid-terrace', 'detached', 'flat'>" or null,
    "specific_date": "<ISO date YYYY-MM-DD if mentioned, else null>",
    "photos_offered": true | false
  },
  "stage": "greeting" | "collecting" | "ready_to_submit" | "complete" | "stopped",
  "missing": ["<list of required fields still null>"],
  "confidence": 0.0 to 1.0
}

If user says STOP / unsubscribe / "remove me" / "go away", set stage="stopped" and reply briefly.`;

  // Convert frontend history to Anthropic format
  const messages = history.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 2000),
  }));
  if (messages.length === 0) {
    messages.push({ role: 'user', content: `[start of chat — homeowner just landed on the ${trade} page]` });
  }

  let haikuResp;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: systemPrompt,
        messages,
      }),
    });
    if (!r.ok) {
      const errBody = await r.text();
      console.error('[aria] Anthropic API failed:', r.status, errBody);
      return jsonResponse(502, { error: 'haiku_failed', detail: `${r.status}: ${errBody.slice(0, 200)}` });
    }
    haikuResp = await r.json();
  } catch (err) {
    console.error('[aria] fetch threw:', err);
    return jsonResponse(502, { error: 'haiku_unreachable' });
  }

  let parsed;
  try {
    const raw = haikuResp.content?.[0]?.text || '';
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    // Pull the first {...} block in case Haiku adds prose around it
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    console.error('[aria] parse failed:', err, haikuResp);
    return jsonResponse(502, { error: 'haiku_parse_failed' });
  }

  // If stage=complete AND we have the required fields, file the lead to KV.
  let lead_id = null;
  let tier = 'T1';
  if (parsed.stage === 'complete' || parsed.stage === 'ready_to_submit') {
    const ex = parsed.extracted || {};
    const haveRequired = ex.name && ex.email && ex.postcode && ex.problem;
    if (haveRequired && parsed.stage === 'complete') {
      // Score tier on what Aria captured in conversation
      if (ex.timeframe && ex.property_type && (ex.specific_date || ex.photos_offered)) {
        tier = 'T4';
      } else if (ex.timeframe && ex.problem.length > 25) {
        tier = 'T3';
      } else {
        tier = 'T2';
      }

      const cleanEmail = String(ex.email).trim().toLowerCase();
      const cleanPostcode = String(ex.postcode).trim().toUpperCase();
      if (!EMAIL_RE.test(cleanEmail)) {
        // Aria extracted a malformed email — fall back to ready_to_submit so frontend can re-ask
        parsed.stage = 'ready_to_submit';
        parsed.missing = ['email'];
      } else if (!UK_POSTCODE.test(cleanPostcode)) {
        parsed.stage = 'ready_to_submit';
        parsed.missing = ['postcode'];
      } else {
        lead_id = genId('ld');
        const now = new Date().toISOString();
        const lead = {
          id: lead_id,
          niche_slug,
          created: now,
          consumer: {
            name: String(ex.name).slice(0, 100),
            email: cleanEmail,
            postcode: cleanPostcode,
            phone: null,
            whatsapp: null,
            problem: String(ex.problem).slice(0, 1000),
            timeframe: ex.timeframe || null,
            property_type: ex.property_type || null,
            specific_date: ex.specific_date || null,
            photos_offered: !!ex.photos_offered,
            gdpr_consent: true,
            gdpr_consent_at: now,
          },
          source: {
            ip: request.headers.get('cf-connecting-ip') || null,
            page_url: payload.page_url || null,
            user_agent: request.headers.get('user-agent') || null,
            referer: request.headers.get('referer') || null,
            country: request.cf?.country || null,
            session_id,
            channel: 'aria-chat',
          },
          current_tier: tier,
          events: [
            { at: now, type: 'captured', tier: 'T1', via: 'aria-chat' },
            { at: now, type: 'qualifier_skipped', reason: 'aria-conversation-already-qualified',
              extracted: ex, ai_tier: tier },
            { at: now, type: 'current_tier_set', tier, source: 'aria-extraction' },
          ],
          status: 'captured',
          sale_price: null,
          invoice_id: null,
          dispute: null,
        };
        await env.TRADESLY_KV.put(`lead:${lead_id}`, JSON.stringify(lead), {
          metadata: { niche: niche_slug, postcode: cleanPostcode, created: now, tier, via: 'aria' },
        });
        await tgAlert(env,
          `🎯 *New Tradesly lead via Aria*\n` +
          `*${niche_slug}* · ${cleanPostcode} · tier *${tier}*\n` +
          `\`${lead_id}\`\n` +
          `${ex.name}: ${ex.problem.slice(0, 200)}${ex.problem.length > 200 ? '…' : ''}`
        );
      }
    }
  }

  return jsonResponse(200, {
    reply: parsed.reply,
    extracted: parsed.extracted,
    stage: parsed.stage,
    missing: parsed.missing,
    confidence: parsed.confidence,
    lead_id,
    tier: lead_id ? tier : null,
  });
}
