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

// ─── Lead source attribution ─────────────────────────────
// Classifies a lead into a single canonical channel bucket so CPL-by-channel
// queries don't have to re-derive the bucket on every read.
//
// Ladder order matters: we check the most unambiguous signals first
// (paid click IDs), then utm_source, then ref= shorthand (postcards),
// then fall through to referrer-based detection (organic search / social
// referral). Default is 'direct' (typed URL / brand search / unknown).
//
// TODO(Kyle): adjust the bucket taxonomy if you want finer granularity
// (e.g. split 'paid_social' into 'meta_ads' vs 'tiktok_ads'). For v1 the
// 6 buckets below cover everything we'll be running for the next 90 days.
function classifySource(attribution, referer) {
  const a = attribution || {};
  // 1. Unambiguous paid-click IDs (Google/Meta append these even without UTMs)
  if (a.gclid) return 'paid_search';
  if (a.fbclid) return 'paid_social';
  // 2. Explicit UTM-driven attribution
  const src = (a.utm_source || '').toLowerCase();
  const med = (a.utm_medium || '').toLowerCase();
  if (med === 'cpc' || med === 'ppc' || med === 'paidsearch') return 'paid_search';
  if (med === 'paidsocial' || med === 'social-paid') return 'paid_social';
  if (med === 'email') return 'email';
  if (med === 'referral' || med === 'partner') return 'partner';
  if (src === 'googleads' || src === 'google-ads') return 'paid_search';
  if (src === 'meta' || src === 'facebook' || src === 'instagram') return 'paid_social';
  if (src === 'reddit') return 'reddit';
  // 3. Postcard QR codes use ?ref=postcard-<batch>
  if (a.ref && a.ref.startsWith('postcard')) return 'postcard';
  if (a.ref && a.ref.startsWith('partner-')) return 'partner';
  // 4. Referrer-based fallback (organic search / social organic)
  const ref = (referer || a.referrer || '').toLowerCase();
  if (/google\.|bing\.|duckduckgo\.|yahoo\./.test(ref)) return 'organic_search';
  if (/reddit\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com/.test(ref)) {
    return 'organic_social';
  }
  // 5. Same-domain referrer or none → direct
  return 'direct';
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
      channel: 'static-form',
      attribution: payload.attribution || null,
      source_class: classifySource(payload.attribution,
        request.headers.get('referer')),
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

    // GET /pitch — personalised buyer-pitch landing page rendered from URL
    // query params. Linked from every cold email (see buyer_outreach.py).
    // Per Reply Rate Playbook §2 "preview-first outreach" — gives the prospect
    // something concrete to look at BEFORE we ask anything.
    if (request.method === 'GET' && url.pathname === '/pitch') {
      return handlePitchPage(request, env);
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
            // First-touch attribution from the client (see aria-chat.js
            // captureAttribution). source_class buckets it for analytics
            // dashboards so we can answer "CPL by channel last 30 days?".
            attribution: payload.attribution || null,
            source_class: classifySource(payload.attribution,
              request.headers.get('referer')),
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

// ─── /pitch handler — personalised buyer-pitch landing page ──────────────
//
// Linked from every cold email. URL shape:
//   /pitch?biz=capital-scaffolding&niche=scaffolding&pc=S12&name=james
//
// Design rules (per session 2026-05-21):
// - Mobile-first (tradespeople open on phone at jobsite)
// - Server-rendered HTML (no JS framework — fast on 4G)
// - All content escaped (XSS-safe — biz/name come from untrusted query)
// - Brand: dark navy + cyan accent matching tradesly.co.uk
// - 4 sections only: hero, sample lead, pricing, why-we-built-it
// - 2 CTAs: reply-to-email (primary), WhatsApp/text (secondary)
//
// Honest framing ("just-shipped angle"): we acknowledge we launched recently
// and our pricing is open to feedback. No "first 3 free" / "100s of leads"
// overclaiming that the cold email already avoids.

// Pricing v2 (2026-05-23) — recalibrated against UK PPL competitor research:
// Bark.com raw lead pricing is the primary anchor (most direct competitor).
// We price at +£5-£75 premium over Bark raw, justified by:
//   - verified-only (not sold to 5 trades)
//   - refund if dead (DISPUTE within 24h)
//   - real screening (name, postcode, problem, timeframe, photos)
// Even at premium, our effective cost-per-booked-job destroys Bark's because
// they book 1-in-4-to-6 vs our target 1-in-2. Pricing will calibrate after
// first 10 buyer replies via the pricing-check question in the cold email.
const PITCH_NICHE_PRICING = {
  'heat-pumps':         { label: 'heat pump',          low: 75,  high: 150, sample_problem: 'New build 2-bed semi, looking to install air source heat pump. Currently on oil. Want quotes for system + install + grant paperwork.' },
  'loft-conversions':   { label: 'loft conversion',    low: 60,  high: 120, sample_problem: '1930s semi, looking to convert loft into a master bedroom + ensuite. Already have basic plans, want quotes for full build.' },
  'solar':              { label: 'solar PV',           low: 50,  high: 90,  sample_problem: '3-bed detached, south-facing roof, looking at 4-6kW solar PV + battery. Want quotes including MCS install + grant info.' },
  'driveways':          { label: 'driveway',           low: 25,  high: 50,  sample_problem: 'Replacing old tarmac drive with block paving. Approx 60sqm. Want quotes for removal + new install.' },
  'garden-landscaping': { label: 'landscaping',        low: 20,  high: 40,  sample_problem: 'Front + back garden re-design. Patio, turf, planted borders, small shed base. ~80sqm total.' },
  'scaffolding':        { label: 'scaffolding',        low: 30,  high: 50,  sample_problem: 'Need scaffolding for chimney repair + roof work on a 2-storey semi. Likely 2-3 weeks hire.' },
  'cleaning':           { label: 'cleaning',           low: 10,  high: 25,  sample_problem: 'End-of-tenancy deep clean on 2-bed flat. Includes carpets + appliances. Available for quote visit this week.' },
  'drains-plumbing':    { label: 'drains / plumbing',  low: 15,  high: 30,  sample_problem: 'Blocked drain at the back of the house, water pooling. Need urgent diagnosis + clear. Possibly camera survey too.' },
};

// HTML-escape — prevents XSS via biz/name query params.
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Convert "capital-scaffolding-sheffield" → "Capital Scaffolding Sheffield"
function unslug(s) {
  if (!s) return 'your business';
  return String(s)
    .replace(/[^a-z0-9-]/gi, '')
    .split('-')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function handlePitchPage(request, env) {
  const url = new URL(request.url);
  const qp = url.searchParams;
  const bizSlug   = (qp.get('biz')   || '').slice(0, 80);
  const nicheSlug = (qp.get('niche') || '').slice(0, 40).toLowerCase();
  const pc        = (qp.get('pc')    || '').slice(0, 8).toUpperCase();
  const firstName = (qp.get('name')  || '').slice(0, 40);

  const bizDisplay = unslug(bizSlug);
  const greetName  = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase() : null;
  const niche      = PITCH_NICHE_PRICING[nicheSlug] || {
    label: 'job', low: 30, high: 100,
    sample_problem: 'Homeowner project in your area, fully qualified before you see it.'
  };
  const pcDisplay = pc || 'your area';

  // Synthetic-but-plausible sample homeowner. Names rotated by postcode hash
  // so the same biz never sees two different samples on subsequent visits.
  const SAMPLE_NAMES = ['Sarah K.', 'James M.', 'Priya S.', 'Tom R.', 'Anna H.', 'Mike L.', 'Lucy B.', 'David N.'];
  const nameIdx = (pc.charCodeAt(0) || 0) % SAMPLE_NAMES.length;
  const sampleName = SAMPLE_NAMES[nameIdx];
  const sampleTimeframe = ['4-6 weeks', '2-3 weeks', '6-8 weeks', 'within a month', 'flexible'][nameIdx % 5];
  const samplePhotos = (nameIdx % 3) + 1;

  const replyMailto = 'mailto:apcapital.ai@gmail.com?subject=' +
    encodeURIComponent(`Re: tradesly pricing check, ${greetName || 'kyle'}`);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(bizDisplay)} preview · Tradesly</title>
<meta name="robots" content="noindex">
<style>
  :root {
    --bg: #0a0e1a;
    --bg2: #14142b;
    --surface: rgba(255,255,255,0.04);
    --border: rgba(255,255,255,0.08);
    --text: #e8f4ff;
    --muted: #8aa8c0;
    --accent: #00d4ff;
    --accent-2: #5a8cff;
    --green: #4ade80;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background:
      radial-gradient(circle at 15% 0%, rgba(80,180,255,0.10), transparent 40%),
      radial-gradient(circle at 85% 20%, rgba(90,140,255,0.08), transparent 50%),
      linear-gradient(180deg, var(--bg), var(--bg2));
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    line-height: 1.55;
    min-height: 100vh;
    padding: 24px 20px 48px;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 560px; margin: 0 auto; }
  .badge {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 12px; font-family: ui-monospace, monospace;
    color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em;
    padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px;
    background: var(--surface);
  }
  .badge-dot {
    width: 6px; height: 6px; border-radius: 50%; background: var(--green);
    box-shadow: 0 0 8px var(--green);
  }
  h1 {
    font-size: clamp(28px, 7vw, 40px); line-height: 1.15;
    margin: 16px 0 8px; letter-spacing: -0.02em;
    font-weight: 700;
  }
  .accent { color: var(--accent); }
  .lede {
    color: var(--muted); font-size: 16px; margin: 0 0 32px;
  }
  section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 16px;
  }
  section h2 {
    font-size: 13px; font-family: ui-monospace, monospace;
    color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em;
    margin: 0 0 14px;
    font-weight: 600;
  }
  .sample-lead {
    background: rgba(80,180,255,0.06);
    border: 1px solid rgba(80,180,255,0.18);
    border-radius: 10px;
    padding: 14px 16px;
    font-family: ui-monospace, monospace;
    font-size: 13px;
    line-height: 1.7;
    color: var(--text);
  }
  .sample-lead .label { color: var(--muted); display: inline-block; min-width: 92px; }
  .price-row {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 10px 0; border-bottom: 1px solid var(--border);
  }
  .price-row:last-child { border-bottom: 0; }
  .price-row .k { color: var(--muted); font-size: 14px; }
  .price-row .v { font-size: 18px; font-weight: 600; color: var(--text); }
  .price-row .v .small { color: var(--muted); font-size: 13px; font-weight: 400; }
  .why { font-size: 15px; color: var(--text); margin: 6px 0; }
  .why-list { margin: 0; padding: 0 0 0 18px; }
  .why-list li { margin-bottom: 10px; color: var(--text); }
  .why-list li::marker { color: var(--accent); }
  .cta-block {
    background: linear-gradient(135deg, rgba(0,212,255,0.10), rgba(90,140,255,0.06));
    border: 1px solid rgba(0,212,255,0.22);
    border-radius: 14px;
    padding: 24px 20px;
    text-align: center;
    margin-top: 24px;
  }
  .cta-block h2 { color: var(--accent); }
  .cta-primary {
    display: inline-block; background: var(--accent); color: #001824;
    padding: 14px 22px; border-radius: 10px; font-weight: 600;
    text-decoration: none; font-size: 16px;
    margin: 8px 0;
    min-height: 48px; line-height: 22px;
  }
  .cta-secondary {
    display: block; color: var(--text); text-decoration: none;
    font-size: 15px; margin-top: 14px;
    padding: 10px;
  }
  .cta-secondary .num { color: var(--accent); font-weight: 600; }
  /* WhatsApp button — green brand-green stands out from the cyan-accented
     primary, gives users a clear "this is a different channel" cue. */
  .cta-whatsapp {
    display: inline-flex; align-items: center; gap: 10px;
    background: #25D366; color: #001a08;
    padding: 14px 22px; border-radius: 10px; font-weight: 600;
    text-decoration: none; font-size: 16px;
    margin-top: 12px;
    min-height: 48px; line-height: 22px;
  }
  .cta-whatsapp:hover { background: #1ebd5a; }
  .cta-whatsapp .num { color: #001a08; font-weight: 700; }
  .cta-whatsapp svg { flex-shrink: 0; }
  footer {
    margin-top: 32px; text-align: center; font-size: 12px;
    font-family: ui-monospace, monospace; color: var(--muted);
    letter-spacing: 0.04em;
  }
  footer a { color: var(--muted); text-decoration: none; border-bottom: 1px dashed var(--border); }
</style>
</head>
<body>
<main>
  <div class="badge"><span class="badge-dot"></span>Tradesly · launched May 2026</div>

  <h1>${greetName ? esc(greetName) + ', here\'s the ' : 'The '}<span class="accent">60-second version</span>${greetName ? '' : ' for ' + esc(bizDisplay)}.</h1>
  <p class="lede">${greetName ? 'Built this for ' + esc(bizDisplay) + '. ' : ''}A quick look at what a Tradesly lead in <strong>${esc(pcDisplay)}</strong> looks like, what we'd charge, and how it works.</p>

  <section>
    <h2>What you'd see in your inbox</h2>
    <div class="sample-lead">
<span class="label">Homeowner:</span> ${esc(sampleName)}<br>
<span class="label">Postcode:</span>  ${esc(pcDisplay)}<br>
<span class="label">Need:</span>      ${esc(niche.label)}<br>
<span class="label">Problem:</span>   ${esc(niche.sample_problem)}<br>
<span class="label">Timeframe:</span> ${esc(sampleTimeframe)}<br>
<span class="label">Photos:</span>    ${samplePhotos} uploaded<br>
<span class="label">Verified:</span>  ✓ email + postcode confirmed
    </div>
    <p style="font-size:13px;color:var(--muted);margin:14px 0 0;">(Sample format. Real leads include direct contact details once you accept.)</p>
  </section>

  <section>
    <h2>Pricing for ${esc(niche.label)} in ${esc(pcDisplay)}</h2>
    <div class="price-row">
      <span class="k">Per qualified lead</span>
      <span class="v">£${niche.low}-${niche.high}</span>
    </div>
    <div class="price-row">
      <span class="k">Monthly fee</span>
      <span class="v">£0 <span class="small">none</span></span>
    </div>
    <div class="price-row">
      <span class="k">Commission on the job</span>
      <span class="v">£0 <span class="small">none</span></span>
    </div>
    <div class="price-row">
      <span class="k">Bad lead?</span>
      <span class="v">credited <span class="small">reply DISPUTE within 24h</span></span>
    </div>
  </section>

  <section>
    <h2>Why we built this</h2>
    <ul class="why-list">
      <li>Most lead services dump unverified enquiries on you, then charge whether you quote or not.</li>
      <li>We pre-screen every homeowner — name, postcode, exact problem, timeframe, photos.</li>
      <li>You only pay for leads that pass the screen. We refund the rest, no arguments.</li>
      <li>We're new (launched May 2026). Pricing per region is open — that's why I'm asking you what £${niche.low} feels like.</li>
    </ul>
  </section>

  <div class="cta-block">
    <h2>Two ways to reply</h2>
    <a class="cta-primary" href="${esc(replyMailto)}">Reply to my email</a>
    <a class="cta-whatsapp" href="https://wa.me/447497812186?text=${encodeURIComponent('hi kyle — saw your tradesly preview for ' + bizDisplay)}">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413"/>
      </svg>
      WhatsApp me · <span class="num">07497 812186</span>
    </a>
  </div>

  <footer>
    kyle airey · tradesly.co.uk · this preview is for ${esc(bizDisplay)} only · <a href="https://tradesly.co.uk">main site</a>
  </footer>
</main>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      ...CORS_HEADERS,
    },
  });
}
