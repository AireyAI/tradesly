#!/bin/bash
# DEPLOY_NOW.sh — One-shot Cloudflare Worker deploy + HTTPS check for Tradesly.
#
# PREREQUISITE (must do ONCE, interactively, before running this script):
#   wrangler login                # opens browser to authenticate
#
# After login, just run:
#   cd ~/AireyAi_projects/tradesly && ./DEPLOY_NOW.sh
#
# What this does (idempotent):
#   1. Creates wrangler.toml from .example if missing
#   2. Creates the TRADESLY_KV namespace if it doesn't exist (or reuses)
#   3. Patches the KV id into wrangler.toml
#   4. Sets the Telegram secrets (prompts you)
#   5. wrangler deploy
#   6. Checks the /api/health endpoint
#   7. Prints what's still left for HTTPS / Always-Use-HTTPS

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "===================================================================="
echo "Tradesly Worker deploy — $(date)"
echo "===================================================================="
echo

# ─── Step 1: wrangler.toml ───────────────────────────────────────────────
if [ ! -f wrangler.toml ]; then
  echo "[1/6] No wrangler.toml — copying from wrangler.toml.example"
  cp wrangler.toml.example wrangler.toml
else
  echo "[1/6] wrangler.toml already exists, leaving it alone"
fi

# Uncomment the route block (template ships with it commented for workers.dev testing).
# We want prod traffic at tradesly.co.uk/api/* so unconditionally uncomment.
# Three explicit replacements matching wrangler.toml.example's exact template shape.
python3 - <<'PYEOF'
from pathlib import Path
p = Path("wrangler.toml")
text = p.read_text()
before = text
text = text.replace("# routes = [\n", "routes = [\n")
text = text.replace('#   { pattern = "tradesly.co.uk/api/*", zone_name = "tradesly.co.uk" }\n',
                    '  { pattern = "tradesly.co.uk/api/*", zone_name = "tradesly.co.uk" }\n')
text = text.replace("# ]\n", "]\n")
if text != before:
    p.write_text(text)
    print("  routes block uncommented for prod (tradesly.co.uk/api/*)")
else:
    print("  routes block already uncommented (or template diverged) — verify wrangler.toml manually if /api/health fails")
PYEOF
echo

# ─── Step 2: KV namespace ────────────────────────────────────────────────
echo "[2/6] Checking KV namespace TRADESLY_KV"
KV_LIST=$(wrangler kv namespace list 2>/dev/null || echo "[]")
KV_ID=$(echo "$KV_LIST" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    data = []
for n in data:
    if n.get("title", "").endswith("TRADESLY_KV"):
        print(n.get("id", ""))
        break
')

if [ -z "$KV_ID" ]; then
  echo "  Creating new KV namespace TRADESLY_KV..."
  CREATE_OUT=$(wrangler kv namespace create TRADESLY_KV 2>&1)
  echo "$CREATE_OUT"
  KV_ID=$(echo "$CREATE_OUT" | grep -oE 'id\s*=\s*"[a-f0-9]+"' | head -1 | grep -oE '[a-f0-9]{20,}')
  if [ -z "$KV_ID" ]; then
    echo "ERROR: could not parse KV id from wrangler output. Run manually:"
    echo "  wrangler kv namespace create TRADESLY_KV"
    echo "Then paste the id into wrangler.toml and re-run this script."
    exit 1
  fi
  echo "  Created KV id: $KV_ID"
else
  echo "  Reusing existing KV id: $KV_ID"
fi
echo

# ─── Step 3: Patch wrangler.toml ─────────────────────────────────────────
echo "[3/6] Writing KV id into wrangler.toml"
# Replace any {{REPLACE_*KV_ID}} placeholder with the real id
python3 - <<PYEOF
from pathlib import Path
import re
p = Path("wrangler.toml")
text = p.read_text()
text = re.sub(r'\{\{REPLACE[_A-Z]*KV_ID\}\}', "$KV_ID", text)
text = re.sub(r'id\s*=\s*"\{\{[^}]+\}\}"', 'id = "$KV_ID"', text)
p.write_text(text)
print(f"  wrangler.toml patched ({len(text)} bytes)")
PYEOF
echo

# ─── Step 4: Telegram secrets (optional but recommended) ─────────────────
echo "[4/6] Telegram secrets (capture alerts to phone)"
if [ -n "${TG_BOT_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ]; then
  echo "  TG_BOT_TOKEN + TG_CHAT_ID found in env, pushing to worker secrets..."
  echo "$TG_BOT_TOKEN" | wrangler secret put TG_BOT_TOKEN
  echo "$TG_CHAT_ID"  | wrangler secret put TG_CHAT_ID
else
  echo "  TG_BOT_TOKEN / TG_CHAT_ID not set in env. Skipping."
  echo "  Set them in ~/.zshrc later, then re-run, OR push manually:"
  echo "    wrangler secret put TG_BOT_TOKEN"
  echo "    wrangler secret put TG_CHAT_ID"
fi
echo

# ─── Step 5: Deploy ──────────────────────────────────────────────────────
echo "[5/6] wrangler deploy"
wrangler deploy
echo

# ─── Step 6: Health check ────────────────────────────────────────────────
echo "[6/6] Health check"
sleep 4  # give CF a moment to propagate the route
echo "  --- HTTPS /api/health ---"
curl -sI --max-time 10 https://tradesly.co.uk/api/health 2>&1 | head -5
echo
echo "  --- HTTP /api/health ---"
curl -sI --max-time 10 http://tradesly.co.uk/api/health 2>&1 | head -5
echo

cat <<'EOF'
===================================================================
DEPLOY COMPLETE. Remaining manual steps in Cloudflare dashboard:
===================================================================

1. SSL/TLS mode → set to "Full" (NOT "Flexible"):
   https://dash.cloudflare.com → tradesly.co.uk → SSL/TLS → Overview

   Why: site is on GH Pages over HTTP. CF terminates TLS, talks HTTP
   to GH Pages, serves HTTPS to visitors. "Full" is the safe default.

2. Edge Certificates → enable "Always Use HTTPS":
   https://dash.cloudflare.com → tradesly.co.uk → SSL/TLS → Edge Certificates

   Why: any HTTP → HTTPS redirect happens at CF, not GH Pages.

3. Verify the cert is provisioned:
   curl -sI https://tradesly.co.uk/heat-pumps.html | head -5
   Expect: HTTP/2 200 with a tradesly.co.uk-valid cert
   If "subjectAltName does not match" — wait 5-15 min for CF to issue.

4. Test the form end-to-end:
   - Open https://tradesly.co.uk/heat-pumps.html in a browser
   - Submit the form with your own postcode + a throwaway email
   - Check ~/jarvis/agents/data/ppl/leads/ — a new ld-*.json should appear
     within ~5 min (via pull_kv_to_local.mjs cron)

5. Verify NW Heat Solutions (the one pending buyer):
   python3 ~/jarvis/agents/ppl_office/verify_buyer.py byr-20260512-223a79

   This moves them from buyers_pending/ to buyers/ and sends a welcome
   email — turns the router from "no active buyers" into "1 active buyer".
EOF
