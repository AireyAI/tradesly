# Tradesly website review

28 October 2026. Reviewed the live homepage, desktop/mobile screenshots, the static website source, current Worker/local intake handlers, terms/privacy, pricing, and existing project context. This is a design and product review; it is not evidence of a working customer acquisition or payment loop.

## What Tradesly should do

The website has two audiences, with one primary action. For a Bristol homeowner, turn an uncertain garden job into a useful, consented request for an introduction. For a Bristol gardener or landscaper, explain the exclusive introduction offer and collect an application for review. Success is not a form-shaped confirmation: a request must actually be acknowledged, a suitable partner must be available, and any introduction must respect the chosen exclusive model.

Kyle chose **one exclusive trade match** and **one trade/area first** in this chat. The redesign uses the existing **Bristol garden and landscaping** launch cell. It avoids a nationwide directory impression until supply and service quality support that scope.

## Competitor comparison

Official sites inspected on 28 October 2026. Hero captures are in `review/screenshots/`.

| Site | What its first journey does well | What Tradesly should learn | What does not transfer |
|---|---|---|---|
| [Checkatrade](https://www.checkatrade.com/) | Makes finding a trade the immediate task. Places its checking process, reviews and guarantee close to that action. Human work photography gives the service context. | Make the task and trust evidence visible together. Explain the specific process behind any quality claim. | Its network size, review volume, checking claims and guarantee are its own evidence; Tradesly cannot borrow them. |
| [MyBuilder](https://www.mybuilder.com/) | Starts with “What is your job?” and explains the sequence: post, receive interest, review profiles and choose. Gives trade recruitment its own route. | Ask a small, understandable first question; explain what happens after the request. Keep homeowner and partner journeys distinct. | A broad marketplace with profiles and a large review base is a different product from one exclusive introduction. |
| [MyJobQuote](https://www.myjobquote.co.uk/) | Combines a service choice and postcode with a clear free/no-obligation proposition. Explains its up-to-three-quotes model consistently. | Put the practical starting fields in the hero and state the matching model plainly. | The three-quote promise conflicts with Kyle’s selected exclusive model, so Tradesly should not imitate it. |
| [Rated People](https://www.ratedpeople.com/) | Exposes a large trade/location taxonomy and offers advice/cost information alongside finding a trade. | Category navigation and useful guidance can support expansion later. | A large taxonomy creates unnecessary choice and an impression of nationwide coverage at a small launch. |

The opportunity is a smaller, more considered service: one garden brief, one suitable local introduction, clear control over contact details. The design can feel more polished and personal without pretending to have an incumbent marketplace’s scale.

## Existing-site findings

| Priority | Finding and evidence | Consequence | Redesign response |
|---|---|---|---|
| P0 | Category-form catch blocks log API failures, then hide the form and show a generated `ld-local` reference as success. See the submit handler near the end of the existing garden page. | A homeowner can believe their enquiry was received when it was not saved. Contact details may also reach the console. | Success requires a valid acknowledgement and server reference. Failures remain visible, preserve the draft and allow retry; no contact data is logged. |
| P1 | Home/terms say up to three matches; a home feature and operational pricing say one exclusive match. | The homeowner’s expectation, consent and partner value proposition disagree. | One exclusive introduction across public copy, consent, stored matching policy and partner terms. |
| P1 | Broad UK coverage, 24-hour matching, universal vetting and automatic dispute/refund language lack supporting evidence in this inventory. | The site promises operating capacity that has not been demonstrated. | Focus on Bristol gardens, check availability after the request, remove response-time guarantees and explain review-based disputes. |
| P1 | Existing category pages link WhatsApp to `447000000000`. | A prominent contact control is a placeholder. | Remove it from the candidate; use the incumbent contact email and guided enquiry. |
| P1 | Homepage CTA sends visitors to another anchor/category choice instead of immediately beginning a brief. | Extra steps before the user makes progress; the “get quotes” destination is unclear. | Job type and postcode in the first screen, then a guided flow with back/review states. |
| P1 | Mobile nav hides `.links` without a replacement navigation control in the source. | Key information and the partner route are harder to reach on mobile. | Accessible menu button, expanded state, and the same navigation on every public page. |
| P2 | The baseline render uses purple glow, a decorative grid, technical quote examples and a dashboard-like panel, with no garden/home craft imagery. | The visual language feels closer to software than a trusted local home service. | A clear garden subject, bespoke illustrative photography, tactile green/stone palette and quiet UI. |
| P2 | Hero supporting copy and CTA were invisible in the baseline capture; the source relies on external GSAP and animation attributes. | An animation dependency or interrupted load can obscure useful content. | HTML-first visible content and CSS feedback; no animation CDN is required. |
| P2 | Pricing ranges differ across the partner page, Worker pitch and operational `pricing.json`. | Partners cannot tell what they will pay. | Publish the current garden T1–T4 rates (£25/£45/£70/£110), with tier and price agreement before paid delivery. |
| P2 | `og-image.jpg` and `sitemap.xml` returned 404 in direct live requests. Existing 404 content also contains template branding. | Weak sharing previews, incomplete discovery and an off-brand dead end. | Real generated-image reference, favicon, sitemap/robots, and a useful branded 404. |
| P2 | Nine trade categories imply a functioning broad marketplace; current inspected KV has no captured leads or pending applications. Active buyer availability was not confirmed. | Appearance and commercial readiness can be confused. | One launch service. Existing other-trade URLs explain that coverage is not open yet. |
| P2 | Privacy text claims indefinite retention of consent is a legal requirement and describes automatic retention/deletion behavior that was not verified. | Policy text may promise processes the implementation does not deliver. | Remove the invented automatic schedule from the local draft; require an owner-approved retention policy and process before launch. [ICO guidance](https://ico.org.uk/for-organisations/advice-for-small-organisations/information-security/data-storage-advice/) says retention must be justified by purpose rather than a universal fixed period. |

These are review judgments tied to observed source/rendering. They are not quantified claims about current conversion rates.

## UX and design specification

- Lead with the local garden task and the outcome of one introduction. Use plain language rather than “matching engine” or compliance badges as trust substitutes.
- Keep one main action: start a garden request. Partner recruitment has its own page and clearly defined process.
- Use a four-step request: job/location → description/timing → contact/consent → review. Ask for email; keep phone optional. Do not add an account requirement.
- State that a request is not a booking, quote, or guaranteed match. Show a reference only after the API acknowledges it.
- Use a focused partner application with real garden prices, declared coverage, capacity and credentials, pending human review.
- Use the contemporary green/ink visual system, oversized but legible type, varied section composition and garden/craft imagery. Use illustration labels instead of fake project proof.
- Use native controls, visible keyboard focus, native modal focus behavior, inline errors, a mobile menu, reduced-motion support and layouts without horizontal overflow.
- Retain the static HTML/vanilla JS stack and Worker/KV integrations. A small generator maintains shared page chrome. Avoid a framework migration that would not help the customer journey.

## Graphical and content changes implemented locally

The `redesign/` candidate includes a complete homepage, garden landing page, partner page/application, privacy/terms layouts, welcome page, branded 404 and eight future-coverage trade pages. It has a custom leaf/tradesly wordmark treatment, favicon, two generated photographic garden illustrations, responsive WebP variants, self-hosted DM Sans, shared spacing/type/color tokens and consistent navigation/footer.

The guided form has explicit validation, coverage handling, progress, back, review, loading, failure/retry and acknowledged-success states. It uses the existing `/api/lead` contract with consent-version and exclusive-policy metadata. The Worker and pure local intake handlers apply the same garden/BS launch restriction. Legacy `/pitch` URLs route to the new partner page with their query parameters retained. The old Aria code remains available; its widget is not loaded alongside the primary guided request flow.

## What to measure next

Use separate counts for request starts, completed steps, unsupported postcodes, acknowledged requests, API failures, partner applications, qualified requests, introductions, disputes, bookings and paid second leads. Campaign/referral metadata is preserved in the enquiry payload. Do not count a click or a form animation as a lead, and do not treat a paid introduction as a homeowner booking. No third-party analytics tracker was added in this pass.

The first commercial proof remains one genuine Bristol garden enquiry, a suitable consenting partner introduction, and evidence that the partner values the lead enough to pay for a later one. The new website supports that experiment; it does not prove it has happened.

## Remaining release decisions

Confirm partner availability, mailbox and response ownership before promising a working service. Review the adapted privacy/terms and agree retention, dispute, pause and rematching processes. Review the local Worker commit that is ahead of GitHub. Run an approved real submission/notification/sync test before launch. Current verification uses local simulated responses and an in-memory KV mock, so it does not establish live delivery or payment behavior.
