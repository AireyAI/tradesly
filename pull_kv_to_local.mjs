#!/usr/bin/env node
/* pull_kv_to_local.mjs — Sync Cloudflare Workers KV → local JARVIS data dir.
 *
 * Shells out to `wrangler kv ...` so it reuses Kyle's existing wrangler OAuth.
 * No CF_API_TOKEN env var needed. Auth-on-disk lives at:
 *   ~/Library/Preferences/.wrangler/config/default.toml
 *
 * After Kyle deploys the Worker, leads land in KV. This script pulls them down
 * to ~/jarvis/agents/data/ppl/{leads,buyers_pending}/ so the rest of the
 * JARVIS pipeline (qualifier, router, delivery, admin dashboard) can read them.
 *
 * Schedule: every 5 min while Worker is active (launchd plist
 * com.airey.jarvis-cron-tradesly-kv-pull.plist).
 *
 * Env vars (all optional):
 *   TRADESLY_KV_NAMESPACE_ID  — Override the hardcoded namespace ID
 *   TRADESLY_DATA_ROOT        — Override local data root (default ~/jarvis/agents/data/ppl)
 *   DELETE_AFTER_PULL=true    — Delete from KV after local write (default: false, KV is canonical)
 *
 * Why hardcode the namespace ID:
 *   Defence in depth. Even if wrangler's OAuth scope grants access to all KV
 *   namespaces in Kyle's CF account, this script can only ever read/write the
 *   Tradesly namespace. No accidental cross-site leakage.
 *
 * Usage:
 *   node pull_kv_to_local.mjs              # pull new leads + buyer apps
 *   node pull_kv_to_local.mjs --dry-run    # print what would be pulled
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);

// ─── Config ─────────────────────────────────────────────
const KV_NAMESPACE_ID = process.env.TRADESLY_KV_NAMESPACE_ID
  || '29db16b4f4864a799e04d7b63faa7405';

const DATA_ROOT = process.env.TRADESLY_DATA_ROOT
  || path.join(os.homedir(), 'jarvis/agents/data/ppl');

const PATHS = {
  leads: path.join(DATA_ROOT, 'leads'),
  buyersPending: path.join(DATA_ROOT, 'buyers_pending'),
};

const DELETE_AFTER_PULL = process.env.DELETE_AFTER_PULL === 'true';
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Wrangler CLI helpers ───────────────────────────────
const WRANGLER = process.env.WRANGLER_BIN || 'wrangler';
const NS_ARGS = ['--namespace-id', KV_NAMESPACE_ID, '--remote'];

async function wranglerKV(args) {
  // Single-shot wrangler kv call. Always pass --remote so we hit production KV,
  // not the local dev simulator. Captures stdout/stderr; throws on non-zero exit.
  const { stdout, stderr } = await execFileP(WRANGLER, ['kv', ...args, ...NS_ARGS], {
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,  // 10 MB ceiling per call
    env: process.env,
  });
  return { stdout, stderr };
}

async function listKeys(prefix) {
  // `wrangler kv key list` returns a JSON array. With --prefix it server-side filters.
  // No pagination handling needed — wrangler does it internally.
  const { stdout } = await wranglerKV(['key', 'list', '--prefix', prefix]);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    throw new Error(`could not parse wrangler kv key list output: ${e.message}\nraw: ${stdout.slice(0, 500)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`expected JSON array from wrangler kv key list, got: ${typeof parsed}`);
  }
  return parsed;  // [{name, metadata?, expiration?}, ...]
}

async function getValue(key) {
  // `wrangler kv key get <key>` writes the raw value to stdout. For our JSON
  // leads, stdout is the JSON string verbatim.
  try {
    const { stdout } = await wranglerKV(['key', 'get', key]);
    return stdout;
  } catch (err) {
    // wrangler exits non-zero for "not found" with a specific message
    const msg = (err.stderr || err.message || '').toLowerCase();
    if (msg.includes('not found') || msg.includes('value not found')) return null;
    throw err;
  }
}

async function deleteKey(key) {
  await wranglerKV(['key', 'delete', key]);
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
        console.error(`[pull] ${kvKey} returned null (deleted between list and get?)`);
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
  // Pre-flight: confirm wrangler is on PATH and authed.
  try {
    await execFileP(WRANGLER, ['whoami'], { timeout: 15_000 });
  } catch (err) {
    console.error('[pull] FATAL: wrangler not authed or not on PATH.');
    console.error('  Fix: `wrangler login` (interactive, opens browser).');
    console.error('  Inner error:', err.message);
    process.exit(2);
  }

  console.log(`[pull] ${DRY_RUN ? '[DRY RUN] ' : ''}Pulling KV namespace ${KV_NAMESPACE_ID} via wrangler CLI`);
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
      auth: 'wrangler-oauth',
      leads: leadResult,
      buyers_pending: buyerResult,
    };
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('[pull] FATAL:', err.message);
    if (err.stderr) console.error('  stderr:', err.stderr.slice(0, 1000));
    process.exit(1);
  }
}

main();
