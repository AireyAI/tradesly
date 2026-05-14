/* Tradesly admin handlers — read-only views of leads, buyers, signals, proposals.
 * Protected by HTTP Basic Auth using ADMIN_PASSWORD env var.
 * Returns JSON to /admin/api/* endpoints; the admin HTML page renders it.
 *
 * Local-only: reads from filesystem at ~/jarvis/agents/data/ppl/.
 * In prod (Cloudflare Worker), a separate variant would read from Workers KV.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const DATA_ROOT = process.env.TRADESLY_DATA_ROOT
  || path.join(os.homedir(), 'jarvis/agents/data/ppl');
const PROPOSALS_DIR = path.join(os.homedir(), 'jarvis/agents/proposals');

const PATHS = {
  leads: path.join(DATA_ROOT, 'leads'),
  buyersPending: path.join(DATA_ROOT, 'buyers_pending'),
  buyersActive: path.join(DATA_ROOT, 'buyers'),
  signals: path.join(DATA_ROOT, 'intent_signals'),
  deliveries: path.join(DATA_ROOT, 'deliveries.jsonl'),
  invoices: path.join(DATA_ROOT, 'invoices.jsonl'),
};

// ─── Basic Auth ───────────────────────────────────────────
export function checkBasicAuth(authHeader) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    // No password set — admin is OPEN in dev. Print loud warning.
    console.warn('[admin] ADMIN_PASSWORD not set — admin endpoints are unprotected');
    return { ok: true, reason: 'no_password_required_dev' };
  }
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return { ok: false, reason: 'missing' };
  }
  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) return { ok: false, reason: 'malformed' };
    const provided = decoded.slice(colonIdx + 1);
    if (provided === password) return { ok: true };
    return { ok: false, reason: 'wrong_password' };
  } catch {
    return { ok: false, reason: 'decode_failed' };
  }
}

// ─── Helpers ──────────────────────────────────────────────
async function readJsonDir(dirPath, limit = 100) {
  try {
    const files = await fs.readdir(dirPath);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    // Sort newest-first by filename (our IDs are date-prefixed)
    jsonFiles.sort().reverse();
    const slice = jsonFiles.slice(0, limit);
    const results = await Promise.all(slice.map(async name => {
      try {
        const raw = await fs.readFile(path.join(dirPath, name), 'utf8');
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }));
    return results.filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function readJsonlFile(filePath, limit = 200) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const records = [];
    for (const line of lines) {
      try { records.push(JSON.parse(line)); } catch { /* skip */ }
    }
    return records.slice(-limit).reverse();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function listMarkdownFiles(dirPath) {
  try {
    const files = await fs.readdir(dirPath);
    return files.filter(f => f.endsWith('.md')).sort();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// ─── /admin/api/summary ───────────────────────────────────
export async function getSummary() {
  const [leads, buyersPending, buyersActive, todaySignals, deliveries, invoices] = await Promise.all([
    readJsonDir(PATHS.leads, 1000),
    readJsonDir(PATHS.buyersPending, 1000),
    readJsonDir(PATHS.buyersActive, 1000),
    readJsonlFile(path.join(PATHS.signals, todayKey() + '.jsonl'), 1000),
    readJsonlFile(PATHS.deliveries, 1000),
    readJsonlFile(PATHS.invoices, 1000),
  ]);

  const replyProposals = await listMarkdownFiles(PROPOSALS_DIR);
  const buyerPitchProposals = replyProposals.filter(f => f.startsWith('ppl-buyer-pitch-'));
  const replyOnlyProposals = replyProposals.filter(f => f.startsWith('ppl-reply-'));
  const invoiceProposals = replyProposals.filter(f => f.startsWith('ppl-invoice-'));

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const leadsToday = leads.filter(l => Date.parse(l.created) > now - dayMs).length;
  const leadsWeek = leads.filter(l => Date.parse(l.created) > now - 7 * dayMs).length;

  // Lead status breakdown
  const leadsByStatus = {};
  for (const l of leads) {
    const s = l.status || 'unknown';
    leadsByStatus[s] = (leadsByStatus[s] || 0) + 1;
  }

  // Delivery metrics
  const deliveriesOk = deliveries.filter(d => d.sent_ok === true);
  const deliveriesToday = deliveriesOk.filter(d => Date.parse(d.at) > now - dayMs).length;
  const deliveriesWeek = deliveriesOk.filter(d => Date.parse(d.at) > now - 7 * dayMs).length;
  const deliveriesFailedToday = deliveries
    .filter(d => d.sent_ok === false && Date.parse(d.at) > now - dayMs).length;
  const revenueDeliveredWeek = deliveriesOk
    .filter(d => Date.parse(d.at) > now - 7 * dayMs)
    .reduce((sum, d) => sum + Number(d.price || 0), 0);

  // Invoice state: latest row per invoice_id wins (append-only model)
  const latestByInvoiceId = {};
  for (const inv of invoices) {
    if (!inv.invoice_id) continue;
    const prev = latestByInvoiceId[inv.invoice_id];
    if (!prev || Date.parse(inv.drafted_at || inv.at || '0') >= Date.parse(prev.drafted_at || prev.at || '0')) {
      latestByInvoiceId[inv.invoice_id] = inv;
    }
  }
  const currentInvoices = Object.values(latestByInvoiceId);
  const drafts = currentInvoices.filter(i => i.status === 'draft');
  const revenueDraftedOpen = drafts.reduce((sum, i) => sum + Number(i.total_gbp || 0), 0);

  const signalsByNiche = {};
  for (const s of todaySignals) {
    const n = s.classified?.niche_slug || 'unknown';
    signalsByNiche[n] = (signalsByNiche[n] || 0) + 1;
  }

  return {
    ts: new Date().toISOString(),
    totals: {
      leads_all_time: leads.length,
      leads_today: leadsToday,
      leads_week: leadsWeek,
      buyers_pending: buyersPending.length,
      buyers_active: buyersActive.length,
      signals_today: todaySignals.length,
      reply_proposals: replyOnlyProposals.length,
      buyer_pitch_proposals: buyerPitchProposals.length,
      invoice_proposals: invoiceProposals.length,
      deliveries_today: deliveriesToday,
      deliveries_week: deliveriesWeek,
      deliveries_failed_today: deliveriesFailedToday,
      revenue_delivered_week_gbp: revenueDeliveredWeek,
      invoice_drafts_open: drafts.length,
      revenue_drafted_open_gbp: revenueDraftedOpen,
    },
    leads_by_status: leadsByStatus,
    signals_today_by_niche: signalsByNiche,
  };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ─── /admin/api/leads ─────────────────────────────────────
export async function getLeads(limit = 50) {
  const leads = await readJsonDir(PATHS.leads, limit);
  return leads.map(l => ({
    id: l.id,
    niche_slug: l.niche_slug,
    created: l.created,
    postcode: l.consumer?.postcode,
    email: l.consumer?.email,
    phone: l.consumer?.phone,
    whatsapp: l.consumer?.whatsapp,
    problem: l.consumer?.problem,
    current_tier: l.current_tier,
    status: l.status,
    sale_price: l.sale_price,
    invoice_id: l.invoice_id,
    dispute: l.dispute,
    event_count: l.events?.length || 0,
    source_ip: l.source?.ip,
    page_url: l.source?.page_url,
  }));
}

// ─── /admin/api/buyers-pending ────────────────────────────
export async function getBuyersPending(limit = 50) {
  const buyers = await readJsonDir(PATHS.buyersPending, limit);
  return buyers.map(b => ({
    id: b.id,
    submitted: b.submitted,
    business_name: b.business_name,
    contact_name: b.contact_name,
    contact_email: b.contact_email,
    phone: b.phone,
    whatsapp: b.whatsapp,
    website: b.website,
    niches: b.niches,
    postcodes_count: b.postcodes_covered?.length || 0,
    postcodes_sample: b.postcodes_covered?.slice(0, 10) || [],
    daily_lead_cap: b.daily_lead_cap,
    years_in_business: b.years_in_business,
    tier_acceptance: b.tier_acceptance,
    credentials: b.credentials,
    status: b.status,
  }));
}

// ─── /admin/api/signals ───────────────────────────────────
export async function getSignals(date = todayKey(), limit = 100) {
  const sigs = await readJsonlFile(path.join(PATHS.signals, date + '.jsonl'), limit);
  return sigs.map(s => ({
    id: s.id,
    scraped_at: s.scraped_at,
    source: s.source,
    source_url: s.source_url,
    niche_slug: s.classified?.niche_slug,
    confidence: s.classified?.confidence,
    reply_status: s.reply_status,
    matched_keywords: s.classified?.debug?.matched_keywords || [],
    author: s.author_handle,
    age_h: s.engagement?.post_age_hours,
    text_snippet: (s.raw_text || '').slice(0, 280),
    postcodes_mentioned: s.extracted?.postcodes_mentioned || [],
  }));
}

// ─── /admin/api/buyers-active ─────────────────────────────
export async function getBuyersActive(limit = 100) {
  const buyers = await readJsonDir(PATHS.buyersActive, limit);
  return buyers.map(b => ({
    id: b.id,
    business_name: b.business_name,
    contact_name: b.contact_name,
    contact_email: b.contact_email,
    phone: b.phone,
    niches: b.niches,
    postcodes_covered: b.postcodes_covered,
    daily_lead_cap: b.daily_lead_cap,
    tier_acceptance: b.tier_acceptance,
    onboarded: b.onboarded,
    status: b.status,
  }));
}

// ─── /admin/api/deliveries ────────────────────────────────
export async function getDeliveries(limit = 50) {
  const rows = await readJsonlFile(PATHS.deliveries, limit);
  return rows.map(d => ({
    at: d.at,
    lead_id: d.lead_id,
    buyer_id: d.buyer_id,
    niche: d.niche,
    tier: d.tier,
    price: d.price,
    to: d.to,
    sent_ok: d.sent_ok,
    error: d.error,
    message_id: d.message_id,
  }));
}

// ─── /admin/api/invoices ──────────────────────────────────
// Latest row per invoice_id wins (append-only state).
export async function getInvoices(limit = 50) {
  const rows = await readJsonlFile(PATHS.invoices, 1000);
  const latest = {};
  for (const inv of rows.reverse()) {
    // rows came reversed (newest-first); iterating reversed-of-reversed = oldest-first.
    // We want LATEST per id, so overwrite as we walk forward in time.
    if (!inv.invoice_id) continue;
    latest[inv.invoice_id] = inv;
  }
  return Object.values(latest)
    .sort((a, b) => Date.parse(b.drafted_at || b.at || '') - Date.parse(a.drafted_at || a.at || ''))
    .slice(0, limit)
    .map(i => ({
      invoice_id: i.invoice_id,
      buyer_id: i.buyer_id,
      business_name: i.business_name,
      contact_email: i.contact_email,
      period_start: i.period_start,
      period_end: i.period_end,
      lines_count: (i.lines || []).length,
      subtotal_gbp: i.subtotal_gbp,
      credits_applied_in_period: i.credits_applied_in_period,
      disputes_excluded_in_period: (i.disputes_excluded_in_period || []).length,
      total_gbp: i.total_gbp,
      status: i.status,
      drafted_at: i.drafted_at,
    }));
}

// ─── /admin/api/proposals ─────────────────────────────────
export async function getProposals() {
  const files = await listMarkdownFiles(PROPOSALS_DIR);
  const replyFiles = files.filter(f => f.startsWith('ppl-reply-'));
  const pitchFiles = files.filter(f => f.startsWith('ppl-buyer-pitch-'));

  // Get done/skipped counts too
  const doneFiles = await listMarkdownFiles(path.join(PROPOSALS_DIR, 'done'));
  const skippedFiles = await listMarkdownFiles(path.join(PROPOSALS_DIR, 'skipped'));

  return {
    pending_reply_proposals: replyFiles,
    pending_buyer_pitches: pitchFiles,
    done_count: doneFiles.length,
    skipped_count: skippedFiles.length,
  };
}

// ─── Route dispatcher ─────────────────────────────────────
export async function routeAdmin(req, body) {
  const url = req.url.split('?')[0];

  // Check auth first
  const auth = checkBasicAuth(req.headers['authorization']);
  if (!auth.ok) {
    return {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Tradesly Admin", charset="UTF-8"',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }),
    };
  }

  try {
    if (url === '/admin/api/summary') {
      return { status: 200, body: JSON.stringify(await getSummary()) };
    }
    if (url === '/admin/api/leads') {
      const limit = parseInt(new URL(req.url, 'http://x').searchParams.get('limit') || '50', 10);
      return { status: 200, body: JSON.stringify(await getLeads(limit)) };
    }
    if (url === '/admin/api/buyers-pending') {
      return { status: 200, body: JSON.stringify(await getBuyersPending()) };
    }
    if (url === '/admin/api/buyers-active') {
      return { status: 200, body: JSON.stringify(await getBuyersActive()) };
    }
    if (url === '/admin/api/deliveries') {
      const limit = parseInt(new URL(req.url, 'http://x').searchParams.get('limit') || '50', 10);
      return { status: 200, body: JSON.stringify(await getDeliveries(limit)) };
    }
    if (url === '/admin/api/invoices') {
      const limit = parseInt(new URL(req.url, 'http://x').searchParams.get('limit') || '50', 10);
      return { status: 200, body: JSON.stringify(await getInvoices(limit)) };
    }
    if (url === '/admin/api/signals') {
      const date = new URL(req.url, 'http://x').searchParams.get('date') || undefined;
      return { status: 200, body: JSON.stringify(await getSignals(date)) };
    }
    if (url === '/admin/api/proposals') {
      return { status: 200, body: JSON.stringify(await getProposals()) };
    }
    return { status: 404, body: JSON.stringify({ error: 'not_found' }) };
  } catch (err) {
    console.error('[admin] handler threw:', err);
    return { status: 500, body: JSON.stringify({ error: 'internal_error', message: err.message }) };
  }
}
