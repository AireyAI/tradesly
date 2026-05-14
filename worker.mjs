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
      return jsonResponse(404, { error: 'not_found' });
    } catch (err) {
      console.error('[worker] handler threw:', err);
      return jsonResponse(500, { error: 'internal_error' });
    }
  },
};
