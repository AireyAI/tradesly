/* Tradesly intake handlers — pure functions, no HTTP coupling.
 * Used by serve.mjs (dev) and a Cloudflare Worker (prod).
 * Storage: filesystem in dev, Workers KV in prod (swap writeJSON only).
 *
 * Per JARVIS PPL spec (~/jarvis/docs/specs/2026-05-12-ppl-multi-niche-manchester-design.md):
 *   - All event logs are append-only
 *   - GDPR consent must be present and timestamped
 *   - Telegram alert on every successful capture (so Kyle sees them in real time)
 *   - Fail loud — never silently swallow errors
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// ─── Storage paths (dev) ──────────────────────────────────
const DATA_ROOT = process.env.TRADESLY_DATA_ROOT
  || path.join(os.homedir(), 'jarvis/agents/data/ppl');

const PATHS = {
  leads: path.join(DATA_ROOT, 'leads'),
  buyersPending: path.join(DATA_ROOT, 'buyers_pending'),
  deliveries: path.join(DATA_ROOT, 'deliveries.jsonl'),
};

// ─── Allowed niches (must match niche_slug values in HTML forms) ──
const VALID_NICHES = new Set([
  'heat-pumps', 'loft-conversions', 'solar', 'driveways',
  'garden-landscaping', 'scaffolding', 'cleaning', 'drains-plumbing',
]);

// ─── Allowed tier values for buyer applications ──
const VALID_TIERS = new Set(['T1', 'T2', 'T3', 'T4']);

// ─── ID generation (sortable, prefix per record type) ──
function genId(prefix) {
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex');
  return `${prefix}-${ts}-${rand}`;
}

// ─── UK postcode validator (outward only or full) ──
const UK_POSTCODE = /^[A-Z]{1,2}\d{1,2}[A-Z]?(\s?\d[A-Z]{2})?$/;

// ─── Email validator (lightweight, real validation happens at qualifier stage) ──
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Telegram alert (best effort — never blocks the response) ──
async function sendTelegramAlert(message) {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  if (!token || !chatId) {
    // Spec: fail loud. Log to stderr so launchd captures it.
    console.error('[tradesly] TG_BOT_TOKEN or TG_CHAT_ID not set — alert skipped:', message);
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.error('[tradesly] Telegram send failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[tradesly] Telegram send threw:', err.message);
  }
}

// ─── Append-only line writer (one JSON per line) ──
async function appendJsonLine(filePath, obj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, JSON.stringify(obj) + '\n', 'utf8');
}

// ─── Atomic write of a single JSON file ──
async function writeJSON(filePath, obj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

// ─── Validation helpers ──────────────────────────────────
function badRequest(reason) {
  return { ok: false, status: 400, body: { error: 'bad_request', reason } };
}

function ok(body) {
  return { ok: true, status: 200, body };
}

// ─── /api/lead handler ───────────────────────────────────
export async function handleLead(payload, meta = {}) {
  // Required fields
  if (!payload || typeof payload !== 'object') return badRequest('invalid payload');
  const { niche_slug, postcode, email, problem, gdpr_consent, gdpr_consent_at } = payload;

  if (!niche_slug || !VALID_NICHES.has(niche_slug)) return badRequest('niche_slug missing or invalid');
  if (!postcode || typeof postcode !== 'string') return badRequest('postcode missing');
  if (!UK_POSTCODE.test(postcode.trim().toUpperCase())) return badRequest('postcode not a valid UK format');
  if (!email || !EMAIL_RE.test(email.trim())) return badRequest('email invalid');
  if (!problem || typeof problem !== 'string' || problem.trim().length < 5) return badRequest('problem too short');
  if (gdpr_consent !== true) return badRequest('GDPR consent required');
  if (!gdpr_consent_at) return badRequest('gdpr_consent_at timestamp required');

  // Optional fields (nullable)
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
      ip: meta.ip || null,
      page_url: payload.page_url || null,
      user_agent: meta.userAgent || null,
      referer: meta.referer || null,
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

  // Persist
  await writeJSON(path.join(PATHS.leads, `${leadId}.json`), lead);

  // Telegram alert (best effort)
  await sendTelegramAlert(
    `🎯 *New Tradesly lead*\n` +
    `*${niche_slug}* · ${lead.consumer.postcode}\n` +
    `\`${leadId}\`\n` +
    `${lead.consumer.problem.slice(0, 200)}${lead.consumer.problem.length > 200 ? '…' : ''}`
  );

  return ok({ ok: true, lead_id: leadId });
}

// ─── /api/buyer-apply handler ────────────────────────────
export async function handleBuyerApply(payload, meta = {}) {
  if (!payload || typeof payload !== 'object') return badRequest('invalid payload');
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

  // Optional
  const whatsapp = (payload.whatsapp && typeof payload.whatsapp === 'string') ? payload.whatsapp.trim() : null;
  const website = (payload.website && typeof payload.website === 'string') ? payload.website.trim() : null;
  const credentials = (payload.credentials && typeof payload.credentials === 'string') ? payload.credentials.trim() : null;
  const years = (typeof payload.years === 'number') ? payload.years : null;

  const buyerId = genId('byr');
  const now = new Date().toISOString();

  // Normalise postcodes (uppercase, strip whitespace)
  const cleanPostcodes = postcodes
    .map(p => String(p).trim().toUpperCase())
    .filter(Boolean)
    .filter((p, i, arr) => arr.indexOf(p) === i); // dedupe

  const application = {
    id: buyerId,
    submitted: now,
    business_name: business_name.trim(),
    contact_name: contact_name.trim(),
    contact_email: email.trim().toLowerCase(),
    phone: phone.trim(),
    whatsapp,
    website,
    niches,
    postcodes_covered: cleanPostcodes,
    daily_lead_cap: daily_cap,
    years_in_business: years,
    tier_acceptance: tiers,
    credentials,
    terms_consent: true,
    terms_consent_at: now,
    status: 'pending_verification',
    source: {
      ip: meta.ip || null,
      user_agent: meta.userAgent || null,
      referer: meta.referer || null,
    },
  };

  await writeJSON(path.join(PATHS.buyersPending, `${buyerId}.json`), application);

  await sendTelegramAlert(
    `🤝 *New Tradesly partner application*\n` +
    `*${application.business_name}* (${contact_name})\n` +
    `${application.contact_email} · ${application.phone}\n` +
    `Niches: ${niches.join(', ')}\n` +
    `Postcodes: ${cleanPostcodes.slice(0, 8).join(', ')}${cleanPostcodes.length > 8 ? ` (+${cleanPostcodes.length - 8})` : ''}\n` +
    `Daily cap: ${daily_cap} · Tiers: ${tiers.join(', ')}\n` +
    `\`${buyerId}\``
  );

  return ok({ ok: true, buyer_id: buyerId });
}

// ─── HTTP request → handler bridge ────────────────────────
// Used by serve.mjs (Node http) and adapted easily for Cloudflare Worker.
export async function routeIntake(req, body) {
  const url = req.url.split('?')[0];
  const method = req.method;

  if (method === 'GET' && url === '/api/healthz') {
    return ok({ ok: true, ts: new Date().toISOString() });
  }

  if (method !== 'POST') {
    return { ok: false, status: 405, body: { error: 'method_not_allowed' } };
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return badRequest('body is not valid JSON');
  }

  const meta = {
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || null,
    userAgent: req.headers['user-agent'] || null,
    referer: req.headers['referer'] || req.headers['referrer'] || null,
  };

  if (url === '/api/lead') return handleLead(payload, meta);
  if (url === '/api/buyer-apply') return handleBuyerApply(payload, meta);

  return { ok: false, status: 404, body: { error: 'not_found' } };
}
