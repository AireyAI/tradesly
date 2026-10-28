# Tradesly redesign plan

28 October 2026. Owner decisions in this chat: one exclusive match; one trade and area first. The existing Bristol garden/landscaping proof plan supplies the launch cell.

## The job of the website

Help a Bristol homeowner describe a garden job, check whether an appropriate local partner is available, and consent to one introduction. A completed enquiry is the primary conversion. A confirmed suitable partner and a successful paid second lead are business outcomes to measure separately. Partner applications are the secondary conversion.

## Positioning and scope

Tradesly is a garden-job introduction service. It is not the contractor and does not book the work or guarantee a quote. Start with gardening and landscaping in BS postcodes, subject to partner availability. Keep other trade URLs discoverable with honest future-coverage messaging, instead of inviting enquiries that cannot yet be served. One lead is offered exclusively to one partner; rematching requires homeowner agreement. Preserve the current Worker/KV API and operator workflow.

## User journeys

1. Homeowner sees the local garden proposition and selects the kind of job plus postcode.
2. Full postcode is validated. Outside BS, explain the launch area and offer a contact link; do not pretend a match exists.
3. Ask for description and timeframe, then email and optional phone, then explicit consent to an exclusive introduction.
4. Show the brief for review. Submit to `/api/lead` using the existing payload.
5. Confirm only when a valid API acknowledgement returns. Show the reference, explain that availability is checked next, and never say a contractor has been found yet. Preserve input on failures.
6. Partners read the exclusive offer, four garden qualification tiers and first-three-free terms, then apply through `/api/buyer-apply`. The application is pending review, not immediate approval.

## Visual direction

A contemporary garden magazine meets a straightforward local matching product. Off-white (#FAFBF6), deep forest ink (#153C2E), leaf green (#CDEB8E), pale sage (#EDF1E6), muted olive-grey (#526457), and white. DM Sans carries both expressive display and legible UI, retaining a current brand typeface. Large two-line headlines, asymmetric photography, generous spacing and distinct section compositions. No fabricated review scores, member counts, contractor cards, live activity, promises of guaranteed availability, or client-project claims. Generated garden photography is labelled as illustrative inspiration.

## Page architecture

- Home: local proposition → start form → service discovery → process → privacy/control → coverage → partner acquisition → FAQ → final action.
- Garden page: same visual system, garden-specific introduction and services, shared request flow.
- Partner page: exclusive proposition, operating process, actual garden rate table, application and pending-review confirmation.
- Remaining eight trade pages: clear future-coverage state, working contact and garden-service navigation.
- Privacy/terms: retain existing operator/legal material, align match count to one, improve readability; owner must review before launch.
- Welcome and 404: purposeful next steps in the same brand.
- Admin and backend files remain available from the original source; this pass targets public journeys.

## Implementation

Work in `redesign/`, an isolated local candidate copied from tracked files. Original `site/` checkout remains intact. Static HTML, shared CSS tokens, vanilla JS and the existing Worker contracts. A small page generator makes public-page navigation/footer consistent without adding a framework. Local preview server acknowledges demo submissions without writing to Jarvis, KV, Telegram or email. Worker/KV code is retained; runtime credentials are not copied.

## Quality checks

Check desktop, tablet and mobile, keyboard navigation, dialog focus and escape, form back/review states, empty/invalid/out-of-area input, positive and negative API responses, timeout/retry behavior, mobile navigation, local links, imagery loading and text contrast. Check syntax and build generation. Performance target: fast HTML-first render, no animation CDN, compressed hero, explicit image dimensions, lazy below-fold imagery, no blocking chat/video. Any measured budgets and remaining gaps go in the handoff.

## Before production

Review the preview and copy. Confirm at least one suitable Bristol garden partner, actual response capacity and contact mailbox. Review adapted legal text, privacy wording and partner dispute process. Reconcile the local Worker commit with origin and deployment. Confirm only one buyer receives a lead and qualify rematching/dispute handling. Run an approved real end-to-end request and notification check. Then approve deployment explicitly. This task does not publish.
