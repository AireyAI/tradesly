# Tradesly

Local redesign for one exclusive garden-trade introduction, starting with Bristol and BS postcode coverage. This branch is a review candidate, not an approved production release.

## Develop

- `npm run build` generates 15 public pages from `build-pages.mjs`.
- `npm run check` checks public JavaScript syntax.
- `npm run serve` starts http://127.0.0.1:3088 with simulated enquiry/application responses. The preview creates no records and sends no notifications.
- `node tests/verify-worker.mjs` verifies launch guards and metadata using in-memory KV and zero external requests.

Page content lives in `build-pages.mjs`; styling in `tokens.css` and `app.css`; the guided form in `app.js`; launch rules in `launch-config.mjs`. `worker.mjs` and `intake-handlers.mjs` use the same launch guards. Existing Aria code is retained, while the public pages use the guided form. Admin is outside this public redesign scope.

## Review and release

Read [the website review](docs/redesign/WEBSITE_REVIEW.md), [the redesign plan](docs/redesign/REDESIGN_PLAN.md), and [the release notes](docs/redesign/RELEASE_NOTES.md). Historical browser/accessibility evidence is included beside them. Screenshots referenced by the review remain in the local project workspace.

Garden imagery is generated illustrative inspiration, not Tradesly customer projects or approved partner work. See `assets/ASSET_NOTES.md` for provenance and the included DM Sans font license.

Legal copy is an adapted draft for owner review. Confirm partner availability, mailbox/response ownership, retention/dispute/rematching practices and exclusive allocation; then run an approved real enquiry/notification test before production approval. No runtime secrets or local wrangler configuration are included.
