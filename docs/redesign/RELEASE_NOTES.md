# Release status — 29 October 2026

This feature branch contains the approved local redesign candidate. It starts from GitHub main, excluding the canonical checkout's pre-existing unpushed Aria LLM-cascade migration commit (`fe1ff4a`). Existing production runtime behavior is preserved apart from the reviewed launch guards and partner routing changes. Reconcile that separate migration deliberately before a future release.

The original checkout and its untracked files were preserved. No production deployment, real enquiry or external notification was performed.

Previous local verification: 202 browser checks passed across 15 pages at three widths; 12 Worker checks passed with in-memory KV; 10 principal-page axe scans reported zero violations after contrast fixes. Keyboard focus, Escape and reduced motion passed in the earlier interaction run. These are not live integration verification or accessibility certification. The local mobile lab figures in the attached report are one sample, not field performance.

Before release, review adapted legal copy, confirm suitable partner availability and operating processes, verify single-buyer allocation, and run an approved real enquiry through storage, notification and sync. Explicit production approval is still required.


## Production release preparation — 29 October 2026

Kyle explicitly approved live deployment. The previously excluded Aria cascade commit has now been reconciled onto this branch as `7fe701d`, preserving the existing runtime integration. The production Worker uses the existing KV namespace, routes and secrets. Build, syntax, all 12 in-memory backend checks and a binding-aware Wrangler dry run passed.

Rollback references captured before release: GitHub Pages build `1137067646` at main commit `9650020e74aceecba88e6dd07e0008afe0d1e012`; Cloudflare Worker version `1ff7a51f-5d36-4bda-a9e5-bfcc45b5efbd`. Live verification will be recorded in the local project deployment report. Real partner capacity and end-to-end human notification/fulfilment remain operational verification gaps.
