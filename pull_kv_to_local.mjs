#!/usr/bin/env node
/* pull_kv_to_local.mjs — Sync Cloudflare Workers KV → local JARVIS data dir
 *
 * After Kyle deploys the Worker, leads land in KV. This script pulls them down
 * to ~/jarvis/agents/data/ppl/{leads,buyers_pending}/ so the rest of the
 * JARVIS pipeline (qualifier, router, delivery, admin dashboard) can read them.
 *
 * Runs as a cron (suggested: every 5 min while Worker is active) OR on-demand.
 *
 * Env vars required:
 *   CF_ACCOUNT_ID            — Cloudflare account ID (in dashboard URL)
 *   CF_API_TOKEN             — Token with Workers KV Storage:Edit permission
 *   CF_KV_NAMESPACE_ID       — KV namespace ID for TRADESLY_KV binding
 *
 * Optional:
 *   TRADESLY_DATA_ROOT       — Override local data root (default ~/jarvis/agents/data/ppl)
 *   DELETE_AFTER_PULL=true   — Delete from KV after successful local write (default: false, keeps KV as canonical)
 *
 * Get account ID + API token:
 *   Account ID: Cloudflare dashboard → Workers & Pages → right sidebar
 *   API token: Profile → API Tokens → Create Token → "Workers KV Storage:Edit"
 *   KV namespace ID: wrangler.toml (id field in [[kv_namespaces]] block)
 *
 * Usage:
 *   node pull_kv_to_local.mjs              # pull new leads + buyer apps
 *   node pull_kv_to_local.mjs --once       # run once and exit (default)
 *   node pull_kv_to_local.mjs --dry-run    # print what would be pulled, don't write
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const DATA_ROOT = process.env.TRADESLY_DATA_ROOT
  || path.join(os.homedir(), 'jarvis/agents/data/ppl');

const PATHS = {
  leads: path.join(DATA_ROOT, 'leads'),
  buyersPending: path.join(DATA_ROOT, 'buyers_pending'),
};

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_KV_NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;
const DELETE_AFTER_PULL = process.env.DELETE_AFTER_PULL === 'true';
const DRY_RUN = process.argv.includes('--dry-run');

const API_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}`;

// ─── Cloudflare API helpers ─────────────────────────────
async function cfFetch(pathSuffix, opts = {}) {
  const url = API_BASE + pathSuffix;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  return res;
}

async function listKeys(prefix) {
  let cursor = '';
  const keys = [];
  do {
    const params = new URLSearchParams({ prefix, limit: '1000' });
    if (cursor) params.set('cursor', cursor);
    const res = await cfFetch('/keys?' + params.toString());
    if (!res.ok) {
      throw new Error(`KV list failed: ${res.status} ${await res.text()}`);
    }
    const json = await res.json();
    if (!json.success) throw new Error('KV list returned success=false: ' + JSON.stringify(json.errors));
    for (const k of json.result || []) keys.push(k);
    cursor = json.result_info?.cursor || '';
  } while (cursor);
  return keys;
}

async function getValue(key) {
  const res = await cfFetch('/values/' + encodeURIComponent(key));
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`KV get failed for ${key}: ${res.status}`);
  }
  return res.text();
}

async function deleteKey(key) {
  const res = await cfFetch('/values/' + encodeURIComponent(key), { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`KV delete failed for ${key}: ${res.status}`);
  }
}

// ─── Local filesystem helpers ───────────────────────────
async function localExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJSON(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, filePath);
}

// ─── Sync logic ─────────────────────────────────────────
async function syncPrefix(kvPrefix, localDir, label) {
  const keys = await listKeys(kvPrefix);
  const idsFromKV = keys.map(k => k.name.slice(kvPrefix.length));

  let pulled = 0;
  let skipped = 0;
  let deleted = 0;
  let errors = 0;

  for (const id of idsFromKV) {
    const localPath = path.join(localDir, id + '.json');
    if (await localExists(localPath)) {
      skipped++;
      continue;
    }

    const kvKey = kvPrefix + id;
    try {
      const value = await getValue(kvKey);
      if (value == null) {
        console.error(`[pull] ${kvKey} returned null (deleted?)`);
        errors++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`[pull] [DRY] would write ${localPath} (${value.length} bytes)`);
        pulled++;
        continue;
      }

      await writeJSON(localPath, value);
      pulled++;
      console.log(`[pull] +${id} (${value.length} bytes)`);

      if (DELETE_AFTER_PULL) {
        await deleteKey(kvKey);
        deleted++;
      }
    } catch (err) {
      console.error(`[pull] ${kvKey}: ${err.message}`);
      errors++;
    }
  }

  return { label, total_in_kv: idsFromKV.length, pulled, skipped, deleted, errors };
}

// ─── Main ───────────────────────────────────────────────
async function main() {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !CF_KV_NAMESPACE_ID) {
    console.error('Missing required env vars:');
    if (!CF_ACCOUNT_ID) console.error('  CF_ACCOUNT_ID (Cloudflare dashboard → Workers & Pages → right sidebar)');
    if (!CF_API_TOKEN) console.error('  CF_API_TOKEN (Profile → API Tokens → Create Token → "Workers KV Storage:Edit")');
    if (!CF_KV_NAMESPACE_ID) console.error('  CF_KV_NAMESPACE_ID (from wrangler.toml [[kv_namespaces]].id)');
    process.exit(1);
  }

  console.log(`[pull] ${DRY_RUN ? '[DRY RUN] ' : ''}Pulling from KV namespace ${CF_KV_NAMESPACE_ID}`);
  console.log(`[pull] Data root: ${DATA_ROOT}`);
  console.log(`[pull] Delete after pull: ${DELETE_AFTER_PULL}`);
  const start = Date.now();

  try {
    const leadResult = await syncPrefix('lead:', PATHS.leads, 'leads');
    const buyerResult = await syncPrefix('buyer_pending:', PATHS.buyersPending, 'buyers_pending');

    const summary = {
      ts: new Date().toISOString(),
      duration_ms: Date.now() - start,
      dry_run: DRY_RUN,
      leads: leadResult,
      buyers_pending: buyerResult,
    };
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('[pull] FATAL:', err.message);
    process.exit(1);
  }
}

main();
