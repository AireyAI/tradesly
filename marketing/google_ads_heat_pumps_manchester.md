# Google Ads — Heat Pumps Manchester (Campaign Brief v1)

**Status:** Ready to launch — pending Google Ads account + £30/day budget approval.
**Owner:** Kyle.
**Last updated:** 2026-05-19.

This is the first paid-acquisition campaign for Tradesly. Designed to deliver
T3-T4 homeowner leads in M-postcode area, fed to NW Heat Solutions (already
verified in the buyer pipeline). Expected CPL £25-40, target volume 5-10
qualified leads/week at £30/day budget.

---

## Account setup (one-time)

1. Create Google Ads account at https://ads.google.com (use apcapital.ai@gmail.com).
2. Skip the "Smart Campaign" guided flow — switch to **Expert Mode** immediately.
   Smart Mode burns budget on broad-match info queries.
3. Set billing: Kyle's business card. Set monthly cap = £900 (£30/day × 30).
4. Add the conversion-tracking pixel — see "Conversion tracking" section below.

## Campaign settings

| Setting | Value | Reason |
|---|---|---|
| Campaign type | Search (only) | No Display, no Performance Max — both waste budget at this stage |
| Goal | Leads | Optimises bidding for form/chat completions |
| Networks | Google Search ONLY (disable Search Partners + Display) | Search Partners is ~30% lower quality at same CPC |
| Locations | "People IN target location" → Manchester (target +10km radius) | NOT "interested in" — that includes searchers anywhere |
| Languages | English | |
| Audience segments | None | Skip — heat-pump search intent is already qualifying |
| Bidding | **Maximize conversions** (first 2 weeks) → switch to **Target CPA £30** after 15 conversions | Tactic: feed the algorithm conversion data before clamping |
| Daily budget | £30 | £900/month max spend, ~5-10 conversions/week target |
| Ad rotation | Optimize (default) | |
| Ad schedule | Mon-Fri 07:00-21:00, Sat-Sun 09:00-19:00 | Higher-intent hours; avoid 2am insomnia browsing |
| Devices | All — but **mobile bid adjustment +20%** | UK homeowners search trades on mobile during commute / evening |

## Ad group: "Air Source Heat Pump — Manchester"

### Keywords (phrase + exact match — NEVER broad match)

| Match type | Keyword | Why |
|---|---|---|
| Exact | `[air source heat pump manchester]` | Highest intent, lowest CPC |
| Exact | `[heat pump installer manchester]` | "Installer" = buyer intent |
| Exact | `[heat pump quote manchester]` | "Quote" = transaction intent |
| Phrase | `"air source heat pump installation"` + Manchester geotarget | Captures variations |
| Phrase | `"heat pump installation cost"` + Manchester geotarget | Price-aware buyer |
| Phrase | `"heat pump grant manchester"` | BUS grant intent — high-value lead |
| Phrase | `"replace gas boiler with heat pump"` | Switching intent |
| Phrase | `"heat pump engineer manchester"` | |
| Phrase | `"mcs heat pump installer"` + Manchester | MCS-aware buyer = informed, higher conversion |
| Exact | `[ground source heat pump manchester]` | GSHP is rarer but higher tier — keep it |
| Phrase | `"new build heat pump installation"` + Manchester | Property type = high tier-4 candidate |
| Phrase | `"heat pump for old house"` + Manchester | Property type signal |

### Negative keywords (CRITICAL — paste this entire block)

Add these as **Campaign-level negatives** so they apply to all ad groups:

```
diy
youtube
wikipedia
diagram
"how does"
"how do"
"what is"
"vs gas boiler"
"vs combi"
"vs oil"
versus
comparison
review
reviews
course
training
"learn to"
plumbing course
apprentice
job
jobs
career
salary
"manufacturer"
worcester bosch
mitsubishi
daikin
samsung
panasonic
spare parts
"second hand"
used
ebay
gumtree
free
"free quote"
images
photos
pictures
pdf
specification
brochure
forum
reddit
mumsnet
"which?"
trustpilot
```

**Why each block matters:**
- `diy youtube wikipedia diagram` — info-seekers, will never buy
- `vs gas boiler / vs combi / versus / comparison` — research phase, not buy phase
- `course training apprentice job` — installers researching their own trade, NOT homeowners
- Manufacturer names (Worcester Bosch, Daikin, etc.) — product researchers, not service-seekers
- `forum reddit mumsnet which? trustpilot` — review-reading phase, not action phase
- `free / second hand / ebay / gumtree` — wrong intent entirely

### Responsive Search Ads — 3 variants

**Headlines (rotate 11 — Google picks):**

1. Heat Pump Installer Manchester
2. MCS Certified Installers
3. Get a Heat Pump Quote Today
4. Save £7,500 with BUS Grant
5. Free Heat Pump Survey
6. Trusted Manchester Engineers
7. Air Source Heat Pumps Fitted
8. 4 Week Installation Window
9. Replace Your Gas Boiler
10. Heat Pump Specialists M-Postcodes
11. Lower Bills, Cleaner Heating

**Descriptions (4):**

1. "Get matched with MCS-certified heat pump installers in Manchester. Free initial survey, transparent quote, no pressure. We pre-qualify every job."
2. "Replace your gas boiler with an air source heat pump. £7,500 BUS grant available. Trusted local engineers covering all M-postcodes."
3. "Tell us about your property in 60 seconds. We match you with a vetted Manchester installer within 24 hours. No call centres, no spam."
4. "From semi-detached to listed buildings — Manchester heat pump installers who actually know your property type. Quotes within 48 hours."

**Display URL paths:** `/heat-pumps` and `/manchester`

**Final URL (with attribution):**
```
https://tradesly.co.uk/heat-pumps?utm_source=googleads&utm_medium=cpc&utm_campaign=heat-pumps-manchester&utm_content={creative}&utm_term={keyword}
```

Note: `{creative}` and `{keyword}` are Google Ads ValueTrack parameters — Google
auto-fills the ad variant ID and triggering keyword. Critical for diagnosing
which ads + keywords actually convert.

**Sitelink extensions:**
- "BUS Grant Info" → `/heat-pumps#grant?utm_source=googleads&utm_medium=cpc&utm_campaign=heat-pumps-manchester`
- "How It Works" → `/heat-pumps#how-it-works?utm_source=...`
- "Service Areas" → `/heat-pumps#areas?utm_source=...`
- "Talk to Aria" → `/heat-pumps#aria-chat?utm_source=...`

**Callout extensions:** MCS Certified · BUS Grant Help · 48 Hour Quote ·
M-Postcode Coverage · No Spam Calls

## Conversion tracking

Critical — without this, Maximize Conversions bidding has no signal.

**Option A (preferred):** Server-side conversion via Cloudflare Worker.

Add to `worker.mjs` `handleAriaChat()` after `lead_id` is generated:

```js
// Fire Google Ads conversion via Measurement Protocol if attribution has gclid
const gclid = payload.attribution?.gclid;
if (gclid && env.GOOGLE_ADS_CONVERSION_ID && env.GOOGLE_ADS_CONVERSION_LABEL) {
  // POST to https://www.google-analytics.com/mp/collect with the gclid +
  // a value matching the tier (T4=£250, T3=£150, T2=£80, T1=£40)
  // — gives Google Ads a value-per-conversion signal for Smart Bidding
  await fetch('https://www.google-analytics.com/mp/collect?...', { ... });
}
```

**Option B (lazy fallback):** Google Ads gtag.js conversion snippet on
tradesly.co.uk inside the Aria success state. Loses 10-15% of conversions
to iOS/Safari ITP. Use only if Option A is too much work for v1.

## Daily monitoring (first 14 days)

Check at 09:00 EAT daily:

- **Conversion volume.** Target: 1-3/day after day 5.
- **CPL.** Should drop from £50+ (day 1-3, algorithm learning) to £25-35 by day 7.
- **Search terms report.** Look for low-value matches we should add to negatives.
- **Quality Score on the 12 keywords.** Anything <5/10 = ad relevance or landing
  page issue.
- **Lost impression share — budget.** If >40%, budget is too low for the
  keyword volume; increase to £40-50/day OR tighten match types.

## Kill criteria

After 14 days OR £400 spend (whichever first):

- If CPL > £60 sustained → pause, do diagnostic on negatives + landing page.
- If conversion volume < 5 in 14 days → keyword set is wrong OR Manchester
  demand isn't there in May (heat pump season is autumn/winter — possible
  seasonal weakness, retry October).
- If CPL £25-40 and volume hits 5+/week → scale to £50/day budget.

## Open questions for Kyle

1. **Budget cap.** £30/day = £900/month max. Comfortable? Or start at £20?
2. **Tier-based bidding.** Should Aria's stage=`complete` fire a higher
   conversion value when tier=T4 vs T2? (Yes is the right answer for
   Smart Bidding, but adds 1h of implementation.)
3. **Second city when this works.** Birmingham? Leeds? Both are in NW Heat's
   coverage if they expand.
