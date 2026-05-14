# Tradesly — Deployment Guide

Production architecture:

```
┌────────────────────────────────────────────────────────────┐
│  GitHub Pages         (free, static)                       │
│  Serves: tradesly.co.uk/* → all 12 HTML pages + tokens.css │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼  (via Cloudflare in front)
┌────────────────────────────────────────────────────────────┐
│  Cloudflare DNS + CDN + Workers                            │
│  Routes:                                                    │
│    /*       → GitHub Pages (static)                        │
│    /api/*   → tradesly-intake Worker (lead/buyer intake)   │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│  Worker stores leads/applications in Workers KV            │
│  + Telegram alerts to Kyle on every capture                │
│  + Daily cron pulls KV → JARVIS for downstream processing  │
└────────────────────────────────────────────────────────────┘
```

## One-time setup

### 1. Register the domain (15 min, ~£8–£10/yr)

Suggested options (in priority order):
- `usetradesly.com` — global brand, .com gold standard
- `tradesly.uk` — UK-specific, half the price
- `tradesly.us` — US-specific, for later

Register via Namecheap (Kyle's preferred registrar). Set Cloudflare nameservers immediately so DNS propagates while we set up the rest.

### 2. Create Cloudflare zone (5 min)

1. Log in to Cloudflare → Add Site → enter your domain
2. Choose Free plan
3. Update nameservers at Namecheap to the Cloudflare ones (from the dashboard)
4. Wait for verification (usually 5–30 min)
5. Enable: Always Use HTTPS, Auto HTTPS Rewrites, HTTP/3, Brotli, HSTS (per `reference_cloudflare_setup`)

### 3. Deploy site to GitHub Pages (10 min)

```bash
cd ~/AireyAi_projects/tradesly
git init
git add .
git commit -m "Tradesly v1: site + intake-handlers + worker"

# Create repo under AireyAI org
gh repo create AireyAI/tradesly --public --source=. --remote=origin --push

# Enable GitHub Pages: Settings → Pages → Deploy from branch → main / (root)
```

Then in Cloudflare:
- DNS: add CNAME `tradesly.co.uk` → `aireyai.github.io` (proxied 🟠)
- DNS: add CNAME `www` → `tradesly.co.uk` (proxied 🟠)

In GitHub repo Settings → Pages → custom domain: `tradesly.co.uk`

### 4. Deploy intake Worker (10 min)

```bash
cd ~/AireyAi_projects/tradesly

# Install wrangler if needed
npm install -g wrangler
wrangler login

# Create KV namespace
wrangler kv:namespace create TRADESLY_KV
# → returns an id like "abc123def456..."

# Copy template + fill in the KV id
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml: replace {{REPLACE_WITH_KV_ID}} with the id from above

# Set Telegram secrets
wrangler secret put TG_BOT_TOKEN
# Paste your @AireyAIsitebot token (or whichever bot you use)
wrangler secret put TG_CHAT_ID
# Paste 1522022288 (Kyle's personal chat per memory)

# Uncomment the route block in wrangler.toml:
# routes = [
#   { pattern = "tradesly.co.uk/api/*", zone_name = "tradesly.co.uk" }
# ]

# Deploy
wrangler deploy
```

The Worker is now live at `https://tradesly.co.uk/api/lead` and `/api/buyer-apply`.

### 5. Verify end-to-end

```bash
# Health check
curl https://tradesly.co.uk/api/healthz

# Submit a test lead
curl -X POST https://tradesly.co.uk/api/lead \
  -H "Content-Type: application/json" \
  -d '{
    "niche_slug": "heat-pumps",
    "postcode": "M20 6FR",
    "email": "test@example.com",
    "problem": "Test lead from deploy verification",
    "gdpr_consent": true,
    "gdpr_consent_at": "2026-05-13T12:00:00Z"
  }'
# Expect: {"ok":true,"lead_id":"ld-..."}
# You should also get a Telegram alert
```

### 6. Set up daily KV pull → JARVIS (optional, can defer)

Once leads start landing in Workers KV, you'll want them mirrored to your local JARVIS so the downstream agents (qualifier, router, delivery) can process them.

**Option A (simplest):** add a daily cron on your Mac that uses `wrangler kv:key list` to fetch new keys + writes to `~/jarvis/agents/data/ppl/leads/`.

**Option B (better):** schedule a Worker cron that POSTs new leads to a Cloudflare Tunnel pointing at your Mac's `intake-handlers.mjs` (whenever it's running).

For v1 (manual buyer matching), Telegram alerts on every lead are enough — Kyle gets the alert, opens KV from the Cloudflare dashboard, copies the lead, manually emails the buyer. Automation comes after first 5–10 leads validate the model.

## Email setup (`hello@tradesly.co.uk`)

Required before `lead_qualifier.py` can send confirmation emails:

1. Google Workspace at admin.google.com → add `tradesly.co.uk` as domain → £5/mo
2. Verify domain via DNS TXT record in Cloudflare
3. Set MX records to Google
4. Create `hello@tradesly.co.uk` user
5. Generate Gmail app password (for SMTP from JARVIS) OR set up OAuth

Without this, the qualifier can't send/receive on Tradesly's behalf and stays blocked.

## Costs (steady state)

| Item | Monthly |
|---|---|
| Domain (`.co.uk`) | £0.65/mo (£8/yr) |
| Cloudflare (Free plan) | £0 |
| GitHub Pages | £0 |
| Workers (free tier: 100k req/day) | £0 (until 100k+) |
| Workers KV (free tier: 1k writes/day, 100k reads/day) | £0 (until volume) |
| Google Workspace (`hello@`) | £5 |
| **Total v1 launch** | **~£6/mo** |

Scaling: Workers + KV stay near-free until you're processing thousands of leads/day. At that point, paid Workers tier is £4/mo for 10M requests.

## Rollback

If anything breaks in prod:

```bash
# Rollback Worker to previous version
wrangler rollback

# Disable the Worker entirely (DNS still works, /api/* will 404 until re-enabled)
wrangler delete

# Pause site (Cloudflare → Domain → Pause Cloudflare on Site)
```

The static site on GitHub Pages stays up regardless of Worker state — only `/api/*` is affected by Worker issues.
