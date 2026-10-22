# Investigate instrumentation

The owner can open a site's Settings and choose **Investigate instrumentation** for a window of 1–31 local days and a maximum of 1–500 sitemap pages. It uses the existing registered-origin crawler: robots rules apply, redirects and credentials are refused, requests carry no sign-in cookie, external scripts are not fetched, and scripts are not executed.

The investigation compares matching native script tags (direct or an active approved first-party proxy) and declared no-code selectors with a preceding native scan, plus accepted event counts. A renamed control can produce a candidate when its tag and ordinal match the old control and both have word-only IDs. This is structural evidence, not proof that the new control has the same meaning. Missing events are labelled silent, case changes are shown exactly, and multiple events per page load are labelled possible duplicates because repeated interactions may be intentional. A funnel event without a declaration is unverified, not declared nonexistent.

Review the evidence and the PR draft. **No PR has been opened**: GitHub/Pane deploy diffs, repository editing and external fix hand-off are not connected. Add the suggested script in your own source workflow. After reviewing any structural candidates, prepare the no-code change (it retains the old selector alongside the reviewed candidate, preserving unscanned templates) and approve it through the normal, version-bound Approvals form. The agent cannot approve a proposal or widen its collected fields.

Deploy the page change and send a deploy/release annotation through the existing owner-created annotation hook. Exercise the affected pages and controls. **Verify deployed instrumentation fix** requires the approved settings version, a later deploy/release receipt, matching live-page structure, and accepted page/event payloads after both approval and deployment. A missing page, missing selector, failed scan or absent payload leaves the fix unverified. Successful verification adds one dated annotation, even if repeated.

Only the owner can investigate, prepare, read or verify agent records. This adds no outbound destination: only the already-declared public-page scan runs. Native snapshots retain script counts, declared selector counts, and at most 40 word-only control IDs with tags/ordinals; fetched bodies, element text, form values and visitor fields are discarded. Derived findings and fixes travel in whole-installation archives, not pending authority in per-site transfers. History erasure removes investigations, fixes and scans; applying event retention removes investigations overlapping erased dates and their fixes. Audit rows retain only action/actor/time and record references.

Public native-session doors (same-origin POSTs only):

- `POST /api/vane/instrumentation/run`: `siteId`, `from`, `to` (exclusive), `pageLimit`.
- `GET /api/vane/instrumentation?siteId=…`: latest ten investigations and fixes.
- `POST /api/vane/instrumentation/prepare`: `siteId`, `runId`, `confirm: "on"`.
- `POST /api/vane/instrumentation/verify`: `siteId`, `fixId`.

The full AGENT-001 clause remains PARTIAL. Client payloads do not establish server-confirmed outcomes; CONV-008 carries Stripe, Shopify and CRM reconciliation. INSTALL-005 and AGENT-003 carry GTM/Pane and granted external hand-off. An inspected page is not evidence about unobserved pages, consent, blockers or actual execution.
