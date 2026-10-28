<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->

# Accept a Vane installation

The primary journey: a US business owner adds one script or a platform path, brings the incumbent's history, tracking calls and goals across, reads cookie-free visitors, sources, goals and revenue the same day, gets a weekly report and alerts that are followed through, and has an agent explain what moved and keep the tracking honest.

## Progress

| Tier | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Core | 82 | 23 | 10 | 115 |
| Agent surface | 0 | 0 | 7 | 7 |
| Later | 3 | 1 | 2 | 6 |
| Full target | 85 | 24 | 19 | 128 |

Judged from the code and tests at commit `c0271cc7262225ab077ea7e8387ed47eeed89d96` (22 October 2026). Field proof register: 10 rows; 0 passed, 0 failed, 10 not run.

## Core

### Existing guarantees

#### HTTP-001 — One Worker with honest public and private doors

Core · published · **done** · Cites BASE-ACCESS-002, BASE-ACCESS-003, BASE-OPS-001

**Requirement.** One Cloudflare Worker serves the installed instance. The Lobby is at `/`, with `/health`, `/signin` and `/setup`. The collection script is at `/vane.js`, with its collection and configuration endpoints. Unknown paths return real 404 responses. The public run site is a separate static surface.

**Acceptance.**
1. Request `/health`, `/vane.js`, an unknown path and every private route signed out on a built Worker.
2. Health answers, the script is served, unknown paths return 404, and private routes return 401 or redirect to sign-in.

**Evidence.** `src/server.ts`; `src/vane/collect.ts`; `src/vane/routes.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### ACCESS-001 — Owners approve, administrators prepare, members read

Core · published · **done** · Cites BASE-ROLE-001, BASE-ACCESS-004

**Requirement.** Roles come from the native operator accounts. Members read sites and reports; `TEAM-001` makes each member a Viewer, who reads and adds notes, or an Analyst, who also prepares goal, funnel and no-code event changes; no member prepares a site, other settings or erasure. Administrators also prepare site, settings and erasure proposals. Only the owner approves proposals, imports, restores and exports history.

**Acceptance.**
1. Invite an administrator and a member.
2. The member cannot prepare a site, the administrator cannot approve or import, export is owner-only, and revoking the administrator ends their session.

**Evidence.** `tests/vane-access.mjs` — “administrator prepares, owner approves once, members neither prepare sites nor export, and revoked operators lose access”: native invitations create administrator and member; the member is refused site preparation; the administrator is refused approval, import and restore; both are refused the whole-history archive download while the owner succeeds; owner approval succeeds once and records distinct preparer and approver; native revocation ends the administrator session on the next request. Runner: `.github/workflows/verify.yml` product-1 → `package.json` verify → rer verify → `scripts/installer/local.mjs` → `scripts/verify-app.mjs` → `scripts/vane-tests.mjs` product-1 → Node test runner → `tests/vane-access.mjs`. `tests/vane.test.mjs` also imports the module. Requests use `tests/vane-helpers.mjs` and `tests/harness.mjs` against the built Worker with real D1 migrations; only declared network edges are faked.
**Gap.** None.

#### ACCESS-002 — Private doors refuse signed-out and cross-origin requests

Core · published · **done** · Cites BASE-ACCESS-002

**Requirement.** Every mutation through a private door also needs the configured same origin. A direct transport call gets the same refusal as a browser route.

**Acceptance.**
1. Call every private GET and POST door signed out, signed out after sign-out, and with a foreign Origin.
2. Each is refused.

**Evidence.** `src/vane/routes.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### APPROVE-001 — Prepared changes apply only on the owner's recorded approval

Core · published · **done** · Cites BASE-AGENT-008

**Requirement.** A site, a settings change or a history erasure that an administrator prepares in the UI waits as a proposal until the owner approves it once through the approval form; a change an agent prepares through the command API carries the class of that change, which the company's policy decides. The approver, the preparer and the time are recorded. Approval refuses a proposal whose site version has changed. An approval comes only from the owner's own signed-in session, so a command-API call can prepare and read a proposal and never records the owner's approval. The one exception is the owner's provisioning key (`API-001`): each site, goal or shared link it asks for is prepared and approved at once in the owner's name and audited via `key:<label>`.

**Acceptance.**
1. Prepare as an administrator, approve as the owner, then approve again; the second approval gets 409.
2. Inspect the proposal for distinct preparer and approver.

**Evidence.** `tests/vane-access.mjs` — “administrator prepares, owner approves once, members neither prepare sites nor export, and revoked operators lose access”. Prepare as administrator → site.create at line 34; approve as owner then approve again → 303 and 409 at lines 39–40; distinct preparer and approver → public proposal response comparison at line 41. Runner: `.github/workflows/verify.yml` product-1 → `package.json` verify → rer verify → `scripts/installer/local.mjs` → `scripts/verify-app.mjs` → `scripts/vane-tests.mjs` product-1 → Node test runner → `tests/vane-access.mjs`; `tests/vane.test.mjs` also imports that module. Public requests use `tests/vane-helpers.mjs` → `tests/harness.mjs` → built Worker with real D1 migrations; only mail and declared network edges are faked. Executed log: [Verify 40094473707, product-1 job 120873735698, step Run pnpm run verify](https://github.com/just-every/run-vane/actions/runs/40094473707/job/120873735698), passing title exactly as quoted above, 36 of 36 passed on b8f1ca0e07bfe2784a12633592bad9b716eb6073. Current assertions and loader chain are unchanged from that SHA.
**Gap.** None.

#### COLLECT-001 — A cookie-free script that sends only declared anonymous fields

Core · published · **done** · Cites BASE-INPUT-001

**Requirement.** `vane.js` sets no cookie or browser storage except the two declared exceptions below. In default mode it sends no visitor or session identifier, user agent, raw URL or query values. Only the consented-mode exception (`METRIC-005`) adds a transient random identifier and its issue time after explicit consent; only its site-scoped digest is stored. When Do Not Track or Global Privacy Control is set, Vane does nothing, with one exception: when the owner enables the `PRIVACY-002` counter, that page load sends one field-free count and nothing else. Collection accepts events only from the site's registered origin and only with the declared field set. It refuses extra fields, such as an email address. This clause constrains the field set: no stored raw identifier, ever. The target allows exactly two declared exceptions to "no browser storage", and the methodology page (`METRIC-004`) and data inventory (`PRIVACY-001`) name both. One is the owner's own-browser exclusion (`COLLECT-003`): a single `vane_ignore` localStorage flag holding no identifier, written only when the owner opts that browser out with `#vane-ignore=on` and cleared with `#vane-ignore=off`. The other is the consented identifier (`METRIC-005`), written only after granted consent. A visitor in the default mode gets no cookie and no storage. The public script-configuration door serves only the settings the script uses; incumbent compatibility (`IMPORT-008`) and consented mode (`METRIC-005`) add their own fields only when the owner turns them on.

**Acceptance.**
1. Post an event from a foreign origin (403), with an extra personal field (400) and with a path carrying a query (400).
2. A valid event is accepted (202).
3. In a browser, a default-mode pageview leaves no cookie and no storage entry; `#vane-ignore=on` writes only `vane_ignore` and excludes that browser, and `#vane-ignore=off` clears it.
4. `/methodology` and the report's data inventory name both storage exceptions.
5. With DNT and then GPC set, a page load sends nothing while the `PRIVACY-002` counter is off, and exactly one field-free count and nothing else while it is on.
6. The public-config journey asserts both compatibility modes: an unapproved proposal changes nothing; approval adds only the compatibility flag and ISO currency; private fields stay absent, and approved opt-out restores the exact earlier response bytes.

**Evidence.** `src/vane/tracker.ts`; `src/vane/collect.ts`; `src/vane/privacy-signals.ts`; `src/vane/methodology.ts`; `src/vane/views/report.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### CONSENT-001 — The site's consent mode is enforced at collection

Core · published · **done**

**Requirement.** A site chooses whether consent is required. When it is, only events that carry granted consent are admitted. Consent-mode changes go through `APPROVE-001`.

**Acceptance.**
1. On a consent-required site, an event without granted consent is refused with 403 and one with granted consent is accepted.

**Evidence.** `tests/vane-access.mjs` — “script ingestion enforces site origin, field allowlists, consent, deduplication and goal totals”. Consent-required site → approved addSite at line 55; no granted consent refused → 403 at line 56; granted consent admitted → 202 at line 57. Runner: `.github/workflows/verify.yml` product-1 → `package.json` verify → rer verify → `scripts/installer/local.mjs` → `scripts/verify-app.mjs` → `scripts/vane-tests.mjs` product-1 → Node test runner → `tests/vane-access.mjs`; `tests/vane.test.mjs` also imports that module. Public requests use `tests/vane-helpers.mjs` → `tests/harness.mjs` → built Worker with real D1 migrations; only mail and declared network edges are faked. Executed log: [Verify 40094473707, product-1 job 120873735698, step Run pnpm run verify](https://github.com/just-every/run-vane/actions/runs/40094473707/job/120873735698), passing title exactly as quoted above, 36 of 36 passed on b8f1ca0e07bfe2784a12633592bad9b716eb6073. Current assertions and loader chain are unchanged from that SHA.
**Gap.** None.

#### DEDUP-001 — Each page load is admitted once

Core · published · **done** · Cites BASE-OPS-003

**Requirement.** A fresh UUID identifies each page load. A repeat with identical data is acknowledged as a duplicate without counting twice, and a repeat with different data is refused.

**Acceptance.**
1. Send the same event twice (202, then 200 with nothing counted) and then a conflicting copy (409).
2. The report counts one visit.

**Evidence.** `tests/vane-access.mjs` — “script ingestion enforces site origin, field allowlists, consent, deduplication and goal totals”: the same load receives 202 then 200, a conflicting copy receives 409, and the public summary reports exactly one visit, one pageview and one goal. Runner: `.github/workflows/verify.yml` product-1 → `package.json` verify → rer verify → `scripts/installer/local.mjs` → `scripts/verify-app.mjs` → `scripts/vane-tests.mjs` product-1 → Node test runner → `tests/vane-access.mjs`. `tests/vane.test.mjs` also imports the module. Requests use `tests/vane-helpers.mjs` and `tests/harness.mjs` against the built Worker with real D1 migrations; only declared network edges are faked.
**Gap.** None.

#### TRAFFIC-001 — Page loads, sources, campaigns and goals with a comparison and stated limits

Core · published · **done**

**Requirement.** For any date range (default: the last seven days), the report shows accepted page loads, goal conversions, referring hostnames, campaigns, pages and goals. The totals and every breakdown row (referring hostnames, campaigns, pages and goals) carry their previous-period count and change, compared with the preceding period of the same length. Beside them, the report states the limits of collection coverage: sampling, consent, configured paths, imports and unknown coverage. The page-load count stays visible as pageviews when `METRIC-001` and `METRIC-002` add visitors and visits.

**Acceptance.**
1. Collect events in two adjacent periods of the same length and read the summary.
2. The compared totals and every referring-hostname, campaign, page and goal row show the correct previous-period count and change, and the counts and coverage-limit text match the seeded events.

**Evidence.** `src/vane/reports.ts`; `src/vane/views/report.ts`; `src/vane/views/html.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### IMPORT-001 — Reviewed, journaled and undoable event-based analytics import

Core · published · **done**

**Requirement.** The owner previews a documented event-based analytics v2 Events page without any write. Visitor identifiers, titles and raw URLs are discarded before custody. The owner then approves the exact reviewed document by its fingerprint. The import is idempotent and resumable, every effect is journaled, and an undo removes its contributions while the journal remains.

**Acceptance.**
1. Preview the import (no writes, no raw identifiers), apply it with a changed fingerprint (409), apply it twice (one job), read the journal and undo it.

**Evidence.** `tests/vane-access.mjs` — “Umami dry run retains no raw identifiers; exact reviewed import is idempotent, journalled and undoable”. Preview with no raw identifiers → preview response at lines 60–61; no preview writes → complete archive-table comparison at lines 62–63, accounting only for the export request’s own audit; changed fingerprint → 409 at line 64; apply twice with one job → equal job IDs at line 65; raw identifiers absent in custody → archive checks at lines 66–68; read journal → owner approval and batches at line 69; undo → 200 and zero imported events at line 70. Runner: `.github/workflows/verify.yml` product-1 → `package.json` verify → rer verify → `scripts/installer/local.mjs` → `scripts/verify-app.mjs` → `scripts/vane-tests.mjs` product-1 → Node test runner → `tests/vane-access.mjs`; `tests/vane.test.mjs` also imports that module. Public requests use `tests/vane-helpers.mjs` → `tests/harness.mjs` → built Worker with real D1 migrations; only mail and declared network edges are faked. Executed log: [Verify 40094473707, product-1 job 120873735698, step Run pnpm run verify](https://github.com/just-every/run-vane/actions/runs/40094473707/job/120873735698), passing title exactly as quoted above, 36 of 36 passed on b8f1ca0e07bfe2784a12633592bad9b716eb6073. Current assertions and loader chain are unchanged from that SHA.
**Gap.** None.

#### ARCHIVE-001 — Complete history export and atomic restore

Core · published · **done** · Cites BASE-DATA-001, BASE-BACKUP-001

**Requirement.** The owner exports every analytics, proposal, deletion and import-custody table as an integrity-checked archive, including each site's US metro-name table with its source label and public choice (`DASH-016`). A restore keeps the owner sign-in, rejects a corrupt archive and preserves import undo.

**Acceptance.**
1. Export, corrupt the archive and restore it (400, no writes).
2. Restore the real archive into an empty installation, check that the tables are identical, restore it again (409) and undo the restored import.

**Evidence.** `tests/vane-access.mjs` — “complete history restores atomically into an empty installation, rejects corruption and preserves import undo”: public export includes native events, privacy signals and reviewed imported history; corrupt restore returns 400 and every destination table is unchanged; the unmodified archive restores with every exported table compared in full, accounting explicitly for the preserved destination sign-in audit and the newly asserted restore receipt and audit; repeat restore returns 409 and the restored import remains undoable. An older archive without signal and audit tables still restores. `tests/locations.journey.mjs` — “DASH-016 APPROVE-001 AUDIT-001 ARCHIVE-001 the owner-approved metro-name table: an administrator uploads, the owner approves, names reach every surface and public pages only when chosen, refusals change nothing, and clear, erasure, archive and transfer keep the rules” proves that the metro-name table, attribution and public choice survive restore and site transfer; integrations-3 loads that journey through `scripts/vane-tests.mjs`. Runner: `.github/workflows/verify.yml` product-1 → `package.json` verify → rer verify → `scripts/installer/local.mjs` → `scripts/verify-app.mjs` → `scripts/vane-tests.mjs` product-1 → Node test runner → `tests/vane-access.mjs`. `tests/vane.test.mjs` also imports the module. Requests use `tests/vane-helpers.mjs` and `tests/harness.mjs` against the built Worker with real D1 migrations; only declared network edges are faked.
**Gap.** None.

#### ERASURE-001 — Owner-approved erasure, fenced against old backups

Core · published · **done** · Cites BASE-DATA-003

**Requirement.** An approved history erasure removes a site's live and imported events and retires its import custody. It records a deletion journal, and a later journal refuses the restore of an older archive that still holds the erased history.

**Acceptance.**
1. Erase a site with live and imported history.
2. Both are gone, the deletion and erasure journals exist, and restoring the old archive with the later journal is refused.

**Evidence.** `tests/vane-access.mjs` — “owner erasure removes live and imported custody and later journals fence old backups”. Seed live and imported history → line 85; prepare erasure and approve through owner form → lines 86–87; both histories gone and deletion plus erasure journals exist → exported tables at line 88; later journal refuses old archive → 409 and empty destination at lines 89–90. Runner: `.github/workflows/verify.yml` product-1 → `package.json` verify → rer verify → `scripts/installer/local.mjs` → `scripts/verify-app.mjs` → `scripts/vane-tests.mjs` product-1 → Node test runner → `tests/vane-access.mjs`; `tests/vane.test.mjs` also imports that module. Public requests use `tests/vane-helpers.mjs` → `tests/harness.mjs` → built Worker with real D1 migrations; only mail and declared network edges are faked. Executed log: [Verify 40094473707, product-1 job 120873735698, step Run pnpm run verify](https://github.com/just-every/run-vane/actions/runs/40094473707/job/120873735698), passing title exactly as quoted above, 36 of 36 passed on b8f1ca0e07bfe2784a12633592bad9b716eb6073. Current assertions and loader chain are unchanged from that SHA.
**Gap.** None.

#### RETENTION-001 — The declared retention window erases older history

Core · published · **done** · Cites BASE-DATA-002

**Requirement.** Each site declares 30, 90 or 365 days of retention (the `PRIVACY-001` target adds 13 and 25 months and unlimited). Applying retention erases older live and imported events in resumable steps and records the deletion in the journal.

**Acceptance.**
1. Import old history, collect a recent event and apply retention until it completes.
2. The old history is gone, the recent event remains, and one deletion is journaled.

**Evidence.** `tests/vane-access.mjs` — “retention removes old imported history while retaining recent events and a deletion journal”. Import old history and collect recent event → line 93; repeatedly apply retention through owner form until complete → three 303 responses at line 94; old history absent, recent event present and one deletion journal entry → archive counts at line 95. Runner: `.github/workflows/verify.yml` product-1 → `package.json` verify → rer verify → `scripts/installer/local.mjs` → `scripts/verify-app.mjs` → `scripts/vane-tests.mjs` product-1 → Node test runner → `tests/vane-access.mjs`; `tests/vane.test.mjs` also imports that module. Public requests use `tests/vane-helpers.mjs` → `tests/harness.mjs` → built Worker with real D1 migrations; only mail and declared network edges are faked. Executed log: [Verify 40094473707, product-1 job 120873735698, step Run pnpm run verify](https://github.com/just-every/run-vane/actions/runs/40094473707/job/120873735698), passing title exactly as quoted above, 36 of 36 passed on b8f1ca0e07bfe2784a12633592bad9b716eb6073. Current assertions and loader chain are unchanged from that SHA.
**Gap.** None.

#### RUNSITE-001 — The public run site reaches installation and every guide

Core · published · **done**

**Requirement.** The public homepage links to `/run` and `/docs`. `/run` shows the real `rer dev just-every/run-vane` launch command, and every guide's local links resolve. The run site contains only public routes, reads no installation data and loads only local assets; Run and Docs work without JavaScript.

**Acceptance.**
1. `rer build --site`, then follow every local link from the built homepage and guides.

**Evidence.** `src/base/run-site.ts`; `tests/site.test.mjs`
**Gap.** None.

#### DOCS-001 — Documentation built from repository Markdown

Core · published · **done** · Cites BASE-DOCS-001

**Requirement.** `/docs` renders the repository's Markdown guides with readable code blocks, tables, section links and optional copy-to-clipboard controls.

**Acceptance.**
1. Build the site and open each guide.
2. Code blocks, tables and heading anchors render, and the clipboard control copies the block.

**Evidence.** `src/site/docs/render.ts`; `src/site/docs/pages.ts`; `tests/site.test.mjs`
**Gap.** None.

#### HOME-001 — The approved homepage in the shared theme

Core · published · **done** · Register R-10

**Requirement.** The run site serves the owner-approved design-desk landing page (17 Oct 2026: the weather vane in an open sky, the swallow mark, Inter Tight and Inter type; page-s1: one launch week at Juniper Coffee, dated section by section, with the hero's wind carried down the page as one trail) in the shared theme with locally served fonts and artwork. At phone width its hero cards and every section's drawing stack under their copy. Its Juniper Coffee figures are explanatory drawings and are never seeded as analytics.

**Acceptance.**
1. In the repository, a browser opens the built homepage at 390 and 1440 px: at 390 px the hero cards and every section's drawing sit under their copy with no sideways scrolling, at 1440 px each two-column section's drawing sits beside its copy and the wind trail runs down the page, and every font, image and style comes from the run site itself, with Inter Tight and Inter loaded.

**Evidence.** `src/site/landing/page.ts` and its section files in `src/site/landing/`; `tests/site.test.mjs`
**Gap.** None.

#### LOBBY-001 — The installed Lobby and real sign-in stay intact

Core · published · **done** · Cites BASE-ACCESS-001

**Requirement.** An installed instance keeps its Lobby at `/`, real sign-in and first-run setup flows, and its existing authenticated routes, all in the shared Vane theme.

**Acceptance.**
1. On a fresh installation, bootstrap the owner, complete `/setup`, sign in by email link and open `/app`.
2. No landing-drawing numbers appear in analytics.

**Evidence.** `src/base/lobby.ts`; `tests/harness.mjs`; `tests/vane.test.mjs`; `tests/email-link.mjs`
**Gap.** None.

#### DEPLOY-001 — Run-site deployment stays behind its switch

Core · published · **partial**

**Requirement.** Run-site deployment runs only when the owner sets `RUN_SITE_DEPLOY`. The run site is configured for run-vane.com. Existing edition, package, Worker and database identifiers are preserved.

**Acceptance.**
1. With the variable unset, the run-site workflow skips deployment.
2. The identifiers in `wrangler.jsonc`, `package.json` and `edition.json` are unchanged.

**Evidence.** `.github/workflows/run-site.yml`, Run site workflow 40142096805 on e92c624a68c66d1000bee594f83a92066d510a70: the manual prove_unset_switch input unsets the effective RUN_SITE_DEPLOY variable for this execution without changing the repository variable. Job deployment-switch completed successfully and job deploy completed skipped. The same resolved-switch output gates normal runs; only the exact value true enables deployment. `wrangler.jsonc`, `package.json` and `edition.json` are byte-for-byte unchanged from starting main 35d45430bc9fb50ba944e45d5dfece89f1777ca5, preserving all edition, package, Worker and database identifiers. No permanent configuration-shape test was added.
**Gap.** Neither point has an asserting test: the skipped deployment rests on Run site workflow 40142096805 and the unchanged identifiers on a byte comparison, not on assertions in a cited file.

### Install and collection

#### INSTALL-001 — One script tag with live install verification

Core · target · **partial** · Cites BASE-DATA-004

**Requirement.** Settings show the snippet with a copy button. A **Verify installation** action loads the site's homepage server-side: the Worker sends a GET for the registered origin's public homepage, following up to five redirects, carries no visitor data and stores only the pass/fail result. The action finds the script and waits up to 60 seconds for a first event from that page. It then reports the exact cause of any failure: script missing, wrong site ID, origin mismatch, Content Security Policy blocking, consent flag never set, path excluded, or a blocker suspected. Until a first event arrives, the site shows **Awaiting first event** in the overview.

**Acceptance.**
1. Point a fixture site at Vane without the script, then with the wrong site ID, then with a CSP that blocks it, then correctly.
2. Each check names its cause; the correct one turns verified when the first event arrives.
3. Record the Worker's outbound requests during each check: only the homepage GET and at most five redirects, carrying no visitor data, and only the pass/fail result is stored.

**Evidence.** `src/vane/install-check.ts`; `src/vane/actions.ts`; `src/vane/views/settings.ts`; `src/vane/views/script-copy.ts`; `tests/vane.test.mjs`
**Gap.** The outbound record during Verify installation is unasserted: only the homepage GET with at most five redirects, no visitor data and pass/fail-only storage. Each failure cause, the redirect origin mismatch and the verified state are asserted.

#### INSTALL-002 — WordPress and WooCommerce plugin

Core · target · **missing** · Register R-2

**Requirement.** A WordPress.org plugin connects a WordPress site to a Vane installation with a site token. It inserts the script (or the proxied script from `INSTALL-006`), excludes logged-in administrators if the owner chooses, and turns on outbound-link, download, 404 and form events (`CONV-003`). With WooCommerce it records product views, add to cart, checkout and purchases with revenue (`CONV-007`). It shows a Vane dashboard widget in wp-admin.

**Acceptance.**
1. Install the plugin on a WordPress + WooCommerce test site, connect it and place a test order.
2. Pageviews, automatic events and a purchase with the correct USD revenue appear in Vane, the `CONV-007` ecommerce funnel and product report show the order's product, quantity and revenue, and admin visits are excluded when that option is set.

**Evidence.** None.
**Gap.** No WordPress or WooCommerce plugin.

#### INSTALL-003 — Shopify app with checkout tracking

Core · target · **missing** · Register R-3

**Requirement.** A Shopify app installs the script on the storefront through a theme app extension. It registers a Customer Events web pixel so that checkout steps and purchases (order value, currency, product lines) arrive as events with no customer personal data. Orders confirmed through the Shopify Admin API reconcile the purchases (`CONV-008`).

**Acceptance.**
1. Install the app on a Shopify development store and complete a test checkout.
2. Storefront pageviews, the checkout funnel steps and a reconciled purchase with its revenue appear, and the `CONV-007` ecommerce funnel and product report show the order's product, quantity and revenue.

**Evidence.** None.
**Gap.** No Shopify app, web pixel or order reconciliation.

#### INSTALL-004 — Webflow, Squarespace, Wix and static-site paths

Core · target · **missing**

**Requirement.** Step-by-step install guides with a verification check (`INSTALL-001`) cover Webflow (site-wide custom code), Squarespace (code injection), Wix (custom code or Velo) and common static hosts (Netlify, Vercel, GitHub Pages). Each guide also shows how to send the platform's form submissions as events.

**Acceptance.**
1. Follow each guide against its platform's test site and pass verification.

**Evidence.** None.
**Gap.** No platform guides with verification.

#### INSTALL-009 — Pane one-switch install and page variants

Core · target · **missing** · From INSTALL-004

**Requirement.** A [Pane](https://github.com/just-every/run-pane) site turns Vane on with one switch, and Pane's editor shows that page's visitors. Pane can also apply a split-test variant (`EXPERIMENT-001`) to the page without code.

**Acceptance.**
1. Turn on Vane in a Pane site and see the page's visitors in the Pane editor.
2. Apply a split-test variant (`EXPERIMENT-001`) from the Pane editor and see its exposures counted.

**Evidence.** None.
**Gap.** No Pane switch.

#### INSTALL-010 — Stall one-switch install with ecommerce events

Core · target · **missing** · From INSTALL-004

**Requirement.** A [Stall](https://github.com/just-every/run-stall) storefront turns Vane on with one switch and emits the `CONV-007` ecommerce events (product view, add to cart, begin checkout and purchase with its product lines).

**Acceptance.**
1. Turn on Vane in a Stall storefront and run a test purchase: the `CONV-007` ecommerce funnel and product report show the product, quantity and revenue.

**Evidence.** None.
**Gap.** No Stall switch; carried missing from INSTALL-004, which had no platform path.

#### INSTALL-005 — Google Tag Manager template

Core · target · **missing** · Register R-4

**Requirement.** A published GTM Community Template installs Vane, passes GTM consent state into `PRIVACY-003`, and maps dataLayer events to Vane custom events with declared properties.

**Acceptance.**
1. Import the template into a GTM container, publish it and fire a dataLayer purchase.
2. A Vane event with the mapped properties arrives, and denied consent sends nothing in a consent-required mode.

**Evidence.** None.
**Gap.** No Google Tag Manager template.

#### INSTALL-006 — First-party proxy for blocker-resilient delivery

Core · target · **partial** · Rules D-2 · Register R-5

**Requirement.** The owner can serve the script and collection endpoint from their own domain. Ready-made setups cover a Cloudflare Worker route (one click when the site's zone is in the same Cloudflare account), Next.js rewrites, Vercel, Netlify, Nginx, Apache and WordPress (`INSTALL-002`). A custom collection subdomain such as `stats.example.com` is also supported. The proxied path forwards the visitor's country and user agent for server-side derivation and never logs them. Reports label how much traffic arrived through the proxy (`COVERAGE-001`). The owner's proxy connection, its one-click route and its credentials follow the mechanism in `docs/first-party-proxy.md`.

**Acceptance.**
1. Configure the Cloudflare route and the Next.js rewrite, and load the site in Chromium with uBlock Origin's default lists active, including EasyPrivacy.
2. First prove the lists are live: in the same session, before the site loads, the incumbents' real tags `https://plausible.io/js/script.js` and `https://www.googletagmanager.com/gtag/js?id=G-TEST` fail with `net::ERR_BLOCKED_BY_CLIENT`.
3. Record the unproxied `vane.js` outcome with the uBlock and list versions; when it is blocked the proxied page still collects.
4. No Vane surface claims to evade blockers or recover blocked visitors; COVERAGE-001's proxy/direct shares are the only measure.
5. Events still arrive, the proxy share is reported, and the forwarded values are never stored raw.

**Evidence.** `tests/proxy.test.mjs` — “owner first-party proxy setup verifies installation and keeps every tracker door, regional consent, transport coverage, credential revocation and browser requests within the declared boundary” proves owner setup, one-use credentials, every current tracking door, regional consent and GPC, installation verification, proxy/direct CSV, both Stats APIs and signed-out public/shared reports, raw-metadata absence, site-overview and scheduled-email counts, and 1440/390 settings/report/credential/methodology/inventory/site-overview screens. `tests/proxy-adapters.test.mjs` — “server proxy forwards every public tracker door over HTTP and strips untrusted identity and credentials”, “proxy refuses unsupported doors, untrusted visitors, oversized streaming bodies and leaking upstream responses”, “custom collection hosts answer only registered-origin preflights without upstream credentials or data” and “downloaded adapters execute with platform-attested metadata and Next rewritten path parameters” prove all ready-made server setups at their network/platform edges. `tests/proxy-cloudflare.test.mjs` — “owner connects an existing installation Worker with narrow idempotent Cloudflare routes and unused dedicated subdomains without retaining the transient token” proves same-account and active-Worker checks, explicit narrow route/domain writes, collision refusals, idempotency, audit and no token retention, plus owner form submission and configured end states at 1440/390, with the Cloudflare HTTP edge simulated. `tests/proxy-next.journey.mjs` — “INSTALL-006: downloaded Next setup rewrites real browser script, config and collect into one private proxy pageview” proves production Next build/start with unchanged owner downloads and actual browser/Worker requests. `tests/site.test.mjs` — “DOCS-001 each built guide renders its Markdown code blocks, tables and heading anchors, and the copy control copies the block” proves the published proxy guide, code-copy control and 1440/390 guide views. `tests/proxy-blocker.journey.mjs` — “unchanged default lists allow actual first-party collection with private metadata and honest proxy counts” passes in Linux run 20261021T230943485957Z-heavy-slot-3d7fcc95 at a46fc52af8d0dc872df4cb53b6ab13de69431463: real Chrome/uBlock with untouched defaults loads the proxy script/config, accepts collection once, reports the exact proxy delta and stores no raw metadata. Its strict unproxied-blocked subtest fails, so the parent journey remains red and this clause partial.
**Gap.** Unproxied Vane was not blocked in the prior default-list run (uBlock 1.75, run 5d8af51e); conditional proxy survival under a real block remains unobserved. In the current default-list runs the real Google gtag control returns HTTP 307 instead of ERR_BLOCKED_BY_CLIENT, so the required parent journey stays red (run history in `CHANGELOG.md`). Cloudflare edge simulated.

#### INSTALL-007 — Single-page applications and hash routing

Core · target · **done**

**Requirement.** The script records a pageview on every History API navigation and, when the owner turns it on, on hash changes. It also sends pageviews manually via `vane('pageview', {url, props})` for frameworks that control routing, and a manual or automatic pageview carries custom properties like any event (`CONV-002`). The settings page shows both snippet attributes. Properties on a pageview, automatic or manual, are `CONV-002`'s, which carries them in its text and acceptance.

**Acceptance.**
1. Navigate a React Router and a hash-routed fixture through four views.
2. Four pageviews arrive with the right paths and no duplicates, and a manual pageview arrives with its path and kept UTM field.

**Evidence.** `src/vane/tracker.ts`; `src/vane/views/settings.ts`; `tests/fixtures/spa-router.jsx`; `tests/vane.test.mjs`
**Gap.** None.

#### INSTALL-008 — Server-side and mobile Events API

Core · target · **done** · Cites BASE-OPS-003

**Requirement.** An authenticated Events API accepts pageviews and custom events from servers, backends and mobile apps. It takes the same fields and properties as the script, plus a client IP and user agent supplied by the caller, which are used only for `METRIC-001` hashing and `DASH-005`/`DASH-006` derivation and then discarded. Tokens are scoped to one site, with rate limits and idempotency keys.

**Acceptance.**
1. Send events from a server with a site token, with a duplicate idempotency key and with a token for another site.
2. Events count once, the foreign token is refused, and no raw IP or user agent is stored.

**Evidence.** `src/vane/events-api.ts`; `src/vane/api-keys.ts`; `src/vane/api-door.ts`; `migrations/core/0040_vane_event_tokens.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### COLLECT-002 — Open path collection with automatic redaction

Core · target · **done**

**Requirement.** Every page on a registered site is collected without a path allowlist. Each event carries the page's hostname beside its path, and the hostname must be one of the site's allowed hostnames (`SITE-001`, `DASH-013`). The current allowlist becomes an optional include or exclude list. Query strings are dropped except UTM parameters, the `ref` and `source` parameters, and owner-allowlisted keys, such as a site-search parameter (`DASH-012`). a `ref` or `source` value is kept by default as the visit's source when no `utm_source` is present, after the same redaction, so directory, Product Hunt and newsletter links keep their label. Ad click identifiers (gclid, fbclid, msclkid) are recorded only as a paid-click channel flag, never as values. Path segments that look like email addresses, long tokens, UUIDs or long numbers are replaced with placeholders before storage. Owners can add rewrite rules such as `/orders/*` → `/orders/:id`. Page titles are never stored.

**Acceptance.**
1. Load pages with emails, tokens, order numbers and UTM and click-ID queries in the URL.
2. Stored paths are redacted, UTM values and the paid-click flag are kept, and a rewrite rule groups the order pages.
3. Visits landing on `/?ref=producthunt` and `/?source=newsletter` report `producthunt` and `newsletter` as their sources, and a visit with both `utm_source=google` and `ref=x` reports `google`.

**Evidence.** `src/vane/paths.ts`; `src/vane/collect.ts`; `src/vane/tracker.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### COLLECT-003 — Bot, referrer-spam and internal-traffic exclusion

Core · target · **done** · Rules D-1, D-2

**Requirement.** At ingestion Vane drops known crawlers and automation, using the Cloudflare bot score where available plus a maintained user-agent list, data-center traffic heuristics and a maintained referrer-spam list. Owners can exclude IP addresses or ranges, exclude pages, exclude up to 30 countries (ISO codes matched against Cloudflare geolocation at ingestion), and exclude their own browser. The own-browser opt-out is a link on the site's settings page that sets the `vane_ignore` flag declared in `COLLECT-001` in that browser only, and opening it again clears the flag. Excluded counts are reported by reason, never silently.

**Acceptance.**
1. Send traffic from a headless browser, a spam referrer, an excluded IP, an excluded country and an opted-out browser beside real visits.
2. Only the real visits count, and the exclusion report shows each reason and its count.

**Evidence.** `src/vane/traffic.ts`; `src/vane/collect.ts`; `src/vane/auto-events.ts`; `src/vane/exclusions.ts`; `src/vane/tracker.ts`; `src/vane/privacy.ts`; `src/vane/views/settings.ts`; `src/vane/views/report.ts`; `src/vane/methodology.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### COLLECT-004 — Collection at small-business scale

Core · target · **done**

**Requirement.** One installation collects at least 10 million pageviews a month across its sites with bursts of 500 events per second. Dashboards answer a 12-month query in under 2 seconds at that volume, using aggregated rollups and a declared analytical store (Cloudflare Analytics Engine, D1 rollups or the buyer's warehouse through `API-002`). Any limit is published and shown before it is reached.

**Acceptance.**
1. A load test at the stated volume and burst rate admits every valid event exactly once.
2. The 12-month dashboard query is timed, and the limit warning appears at the published threshold.

**Evidence.** `tests/collection-scale.journey.mjs` — “COLLECT-004 genuine monthly pageviews, …” (the full-volume test), Collection scale workflow 40065213328 on b554a0bf06080d844cb29bca72faf2a3e1caf312, passed 24 October 2026: 120,015,102 pageviews admitted exactly once across twelve months at 10,000,000 monthly pageviews plus admission and burst traffic; 519.6 events per second completed during the paced burst; all 26 timed complete public summary and HTML reports below 2,000 ms, maximum 1,623.8 ms. Actual store 9,895,727,104 bytes of the 10,737,418,240-byte D1 limit (92%). Collection, rollup, analytics, report and scale-journey sources are unchanged from that exact run SHA through main 35d45430bc9fb50ba944e45d5dfece89f1777ca5. `tests/vane-report-settings.mjs` — “RETENTION-002 a keep-forever site keeps 30 months of imported history and today's events, 25 months erases only older events with one journal entry, and a store past 80% of its capacity warns with both choices and drops nothing” proves the published 80% warning before capacity, continued admission and the retention and export choices; report and capacity views have 1440 and 390 browser proof. `.github/workflows/collection-scale.yml` runs the full journey weekly on Sunday at 20:29 UTC in job collection, outside push Verify. This is runtime capacity and timing proof; actual provider billing remains HOST-001.
**Gap.** None.

#### COVERAGE-001 — Coverage shown beside every number

Core · target · **partial**

**Requirement.** Every report states what it cannot see: the consent-declined share (the script sends a field-free declined counter when consent is not granted, if the owner enables it), sampling, exclusions by reason, the proxy and direct share, imported periods with unknown coverage, and deleted history. Where the site's Cloudflare zone is connected, Vane also compares its pageviews with zone page requests to estimate the share lost to blockers. No total is presented as complete when coverage is unknown.

**Acceptance.**
1. Combine declined consent, sampling, exclusions, an import and a zone comparison on one site.
2. The report shows each share with its denominator and labels the totals as partial.

**Evidence.** `src/vane/exclusions.ts`; `src/vane/reports.ts`; `src/vane/views/report.ts`; `tests/vane.test.mjs`
**Gap.** The Cloudflare zone comparison is unasserted (no zone connection exists); declined consent, exclusions, sampling, an import, privacy signals and erased history are asserted with their denominators and the partial label.

### Visitors and engagement

#### METRIC-001 — Cookie-free unique visitors from daily-rotating salted hashes

Core · target · **partial**

**Requirement.** The server derives a visitor hash from SHA-256(daily salt + site ID + IP address + user agent). The salt is random, rotates at midnight in the site's time zone and is deleted after 24 hours. The IP and user agent are never stored, logged or returned. Unique visitors count distinct hashes within a day. For a multi-day range, the count is the sum of daily uniques unless consented mode (`METRIC-005`) applies, and the methodology page says so. A cookie-free visitor cannot be followed across days or across sites. The separate explicitly consented mode (`METRIC-005`) can link days within one site only.

**Acceptance.**
1. Send pageviews from two simulated visitors over two days.
2. Unique visitors are 2 per day and the range shows 4 under the stated method.
3. Show that the database, logs and archive hold no IP, no user agent and no salt older than 24 hours, and that the same visitor hashes differently on another site.

**Evidence.** `src/vane/visitors.ts`; `src/vane/collect.ts`; `src/vane/reports.ts`; `src/vane/methodology.ts`; `src/server.ts`; `migrations/core/0018_vane_visitors.sql`; `tests/vane.test.mjs`
**Gap.** No test reads the logs for the IP or user agent; the database, archive, salt lifetime and cross-site hashing are asserted.

#### METRIC-002 — Visits and pages per visit

Core · target · **done**

**Requirement.** A visit is a run of events from one visitor hash with no gap over the site's visit timeout, 30 minutes by default (the owner may approve another from 15 to 120 minutes as a dated definition version, `METRIC-004`); it also ends when the daily salt rotates. Reports show visits, pageviews, pages per visit and views per visitor.

**Acceptance.**
1. Send one visitor's pageviews with gaps of 10, 40 and 5 minutes.
2. The report shows 2 visits, 4 pageviews and 2 pages per visit.

**Evidence.** `src/vane/visits.ts`; `src/vane/reports.ts`; `src/vane/collect.ts`; `src/vane/clock.ts`; `src/vane/views/report.ts`; `src/vane/methodology.ts`; `migrations/core/0019_vane_visits.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### METRIC-003 — Bounce rate and visit duration

Core · target · **done**

**Requirement.** A bounce is a visit with one pageview and no engagement event. Visit duration runs from the first event to the last engagement signal. The script sends a field-free engagement ping when the page is hidden or after 10 seconds or more of visible time, which counts time on the final page. Reports show the bounce rate and the median and average visit duration, per page as well as overall.

**Acceptance.**
1. Simulate a quick bounce, a single-page visit with 45 seconds of engagement, and a three-page visit.
2. The bounce rate, visit durations and per-page time match the definitions.

**Evidence.** `src/vane/tracker.ts`; `src/vane/collect.ts`; `src/vane/visits.ts`; `src/vane/views/report.ts`; `src/vane/methodology.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### METRIC-004 — Methodology disclosed and versioned

Core · target · **done**

**Requirement.** Every installation serves a public methodology page. It defines visitors, visits, bounce, duration, scroll depth, conversions and revenue, the hash recipe and salt lifetime, consented mode, the two declared browser-storage exceptions (`COLLECT-001`), how each metric combines in a multi-site roll-up (`DASH-010`), sampling and estimation limits. Each metric in the app links to its definition. A change to a definition is versioned and appears as an annotation on every chart it affects (`DASH-009`).

**Acceptance.**
1. Open the methodology page signed out and follow each metric's definition link from the dashboard.
2. The page states the roll-up rules and the two storage exceptions.
3. Change the visit timeout and see a definition annotation dated on the charts.

**Evidence.** `src/vane/methodology.ts`; `src/vane/definitions.ts`; `src/vane/commands.ts`; `src/vane/visits.ts`; `src/vane/views/chart.ts`; `src/vane/views/report.ts`; `src/vane/views/settings.ts`; `src/vane/reports.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### METRIC-005 — Consented visitor mode: returning visitors and retention

Core · target · **done**

**Requirement.** A site can turn on a consented mode for visitors who grant analytics consent. It stores a random first-party identifier with a lifetime the owner chooses (at most 13 months) and adds new and returning visitors, multi-day unique visitors, multi-visit attribution and weekly retention cohorts. Visitors without consent stay in cookie-free mode, and reports show the consented share. Revoking consent deletes the identifier on the device and stops linking. In consented mode a funnel can order its steps within one visitor across visits (`CONV-005`), and a split test (`EXPERIMENT-001`) keeps a consented visitor's variant across days, assigned from the identifier instead of the daily hash.

**Acceptance.**
1. With consent granted, visit on day 1 and day 8 and see one returning visitor in the week-2 cohort.
2. Without consent, the same visits count as cookie-free daily visitors.
3. A revoke deletes the identifier.
4. The methodology page (`METRIC-004`) defines consented mode, its identifier and lifetime.
5. A consented visitor who views the product on day 1 and buys on day 3 completes a cross-visit funnel, and sees the same split-test variant on both days.

**Evidence.** `tests/consented.test.mjs` — “METRIC-005: approved consented mode, returning cohorts, attribution, cross-visit funnels and browser revocation” proves recorded approval/off default and lifetime bound; day-1/day-8 returning/cohort counts; cookie-free daily and consented range uniques; consented share, first/last-touch attribution, aggregate CSVs and site isolation; day-1/day-3 funnel completion and stable variants; no raw device identifier or digest in reports; denied, expired and GPC refusals; immediate browser revoke/regrant; inventory/methodology and responsive settings/report/funnel views at 1440/390.
**Gap.** None.

#### METRIC-006 — Scroll depth and time on page

Core · target · **done**

**Requirement.** The script reports the maximum scroll depth reached on each page as a whole percentage (0 to 100), as part of the engagement ping. Page reports show the average scroll depth, the share reaching 75%, and the time on page, and scroll-depth goals (`CONV-001`) count against the same figure.

**Acceptance.**
1. Scroll a long fixture page to 50% and to 100% in separate visits.
2. The page shows the average depth and the 75% share as expected.

**Evidence.** `src/vane/tracker.ts`; `src/vane/collect.ts`; `src/vane/visits.ts`; `src/vane/privacy.ts`; `src/vane/views/report.ts`; `src/vane/methodology.ts`; `migrations/core/0020_vane_scroll.sql`; `tests/vane.test.mjs`
**Gap.** None.

### Dashboards and analysis

#### DASH-001 — Real-time dashboard

Core · target · **done**

**Requirement.** A real-time view shows current visitors (active in the last 5 minutes), pageviews per minute for the last 30 minutes, and live top pages, sources and locations, refreshing at least every 15 seconds without a reload.

**Acceptance.**
1. Send events while the real-time view is open.
2. Current visitors and the live lists update within 15 seconds and drop once the visitors go idle for 5 minutes.

**Evidence.** `src/vane/realtime.ts`; `src/vane/views/realtime.ts`; `src/vane/views/index.ts`; `src/vane/routes.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### DASH-002 — Historical time series in the site's time zone

Core · target · **done**

**Requirement.** The main chart plots visitors, visits, pageviews, bounce rate, duration, conversions and revenue by hour, day, week or month. Preset ranges cover today, yesterday, the last 7, 30 and 90 days, month to date, last month, year to date, the last 12 months and all time, and any custom range can be chosen. Days start at midnight in the site's time zone, which defaults to the owner's US time zone and handles daylight-saving changes. Every chart has an accessible data table.

**Acceptance.**
1. Seed events either side of a US daylight-saving change and midnight in America/Chicago.
2. The daily buckets follow local days, each preset range returns the expected totals, and the data table matches the chart.

**Evidence.** `src/vane/periods.ts`; `src/vane/series.ts`; `src/vane/reports.ts`; `src/vane/views/chart.ts`; `src/vane/views/report.ts`; `src/vane/views/index.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### DASH-003 — Page, entry and exit reports

Core · target · **done**

**Requirement.** Page reports list top pages, entry (landing) pages and exit pages, each with visitors, pageviews, bounce rate, time on page, scroll depth and conversion rate. Pages can be grouped by path prefix or by a rewrite rule. When a site has more than one hostname, each row shows its hostname and the same path on two hostnames is two rows (`DASH-013`).

**Acceptance.**
1. Seed visits with known entry and exit pages.
2. The three tables match, and grouping by `/blog/*` sums the posts correctly.

**Evidence.** `src/vane/visits.ts`; `src/vane/reports.ts`; `src/vane/routes.ts`; `src/vane/views/report.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### DASH-004 — Channels, referrers and UTM campaigns

Core · target · **done**

**Requirement.** Every visit gets a channel, using published definitions: Direct, Organic Search, Paid Search, Organic Social, Paid Social, Email, Referral, AI Assistants (ChatGPT, Perplexity, Claude, Gemini, Copilot), Affiliates and Display. Referrer domains and URLs come from public referring pages. All five UTM fields (source, medium, campaign, term, content) are available as dimensions. No allowlist is needed. Email-client and webmail referrers are grouped. Every channel, referrer and UTM table shows, per row, the visitors, visits, bounce rate, visit duration and the conversion rate for the selected goal, as the pages table does.

**Acceptance.**
1. Send visits with Google organic, Google paid (gclid flag), Facebook, an email UTM, a chatgpt.com referrer and five-field UTMs.
2. Each lands in its documented channel, every UTM field is reportable, and each row's visitors, bounce rate and visit duration equal a hand-computed count of the seeded visits.

**Evidence.** `src/vane/channels.ts`; `src/vane/collect.ts`; `src/vane/visits.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### DASH-005 — Country, region and city

Core · target · **done** · Rules D-1

**Requirement.** Location comes from Cloudflare's request geolocation at ingestion. Country, region (US state) and city are stored as names. On shared links, embeds and public dashboards (`SHARE-001`, `SHARE-002`), a city with fewer than 5 visitors in the selected range is folded into an "Other cities" row in its region. Signed-in team members see every city. Country, region and city rows show conversions and conversion rate for the selected goal (`CONV-004`). Countries, regions and cities join the movers in the report's explanation (`REPORT-003`) and are filter dimensions (`DASH-007`). The real-time view (`DASH-001`) gains a live locations list: current visitors by country, region and city, compared with the same window 30 minutes earlier. US metro areas are `DASH-015` and the owner's metro names `DASH-016`.

**Acceptance.**
1. Send events with Cloudflare geo for Texas, Ontario and London.
2. Reports show the country, region and city, and no IP appears anywhere in storage.
3. Seed Austin with 12 visitors and Marfa with 3, then open a shared link.
4. Austin is listed, Marfa is folded into "Other cities" in Texas, and the signed-in dashboard lists both.
5. With the real-time view open, a current visitor from Texas appears in its live locations list and drops after 5 minutes idle.
6. A week where Texas visitors fall names Texas among the explanation's movers with its totals.
7. The country table shows each country's conversions and conversion rate for the selected goal.
8. Filtering by country is United States keeps only those visits.

**Evidence.** `src/vane/locations.ts`; `src/vane/metro-names.ts`; `src/vane/collect.ts`; `src/vane/reports.ts`; `src/vane/realtime.ts`; `src/vane/segments.ts`; `src/vane/views/locations.ts`; `src/vane/views/metro-names.ts`; `src/vane/views/public.ts`; `migrations/core/0061_vane_metro_names.sql`; `tests/locations.journey.mjs`; `tests/vane.test.mjs`
**Gap.** None.

#### DASH-006 — Devices, browsers and operating systems

Core · target · **done**

**Requirement.** The server derives the device class (desktop, mobile, tablet), browser and major version, operating system and version, and a screen-size class from the user agent and an optional viewport width. The raw user agent is discarded.

**Acceptance.**
1. Send events from iPhone Safari, Android Chrome, Windows Edge and an iPad.
2. The device, browser and OS tables match, and no raw user agent is stored.

**Evidence.** `src/vane/devices.ts`; `src/vane/collect.ts`; `src/vane/tracker.ts`; `src/vane/reports.ts`; `src/vane/views/report.ts`; `migrations/core/0021_vane_devices.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### DASH-007 — Filters, segments and saved views

Core · target · **done**

**Requirement.** Clicking any dimension value filters the whole dashboard. Filters combine with is, is not, contains, does not contain and matches (regex), on any dimension (including Hostname, `DASH-013`) or event property. Filter combinations can be saved as named segments, shared with the team, and used in reports, alerts and the API. A saved segment also filters a funnel (`CONV-005`).

**Acceptance.**
1. From the report, filter by Organic Search and mobile and not `/blog/*`, save the segment and reopen it in the report and the summary API.
2. Each total equals a hand-computed count of the seeded events, and each comparison keeps whole visits.
3. The saved segment recomputes a funnel's step counts.
4. A member applies the segment but cannot save one.
5. An unsupported pattern is refused at save with the reason, never silently ignored or run.

**Evidence.** `tests/vane-conversions.mjs` — “DASH-007 filtering the report by Organic Search, mobile and not /blog/* keeps hand-counted whole visits, saves a team segment that reopens in the report and the API and recomputes a funnel, and each comparison filters by visit” proves dimension filters, comparison totals, saved segments, funnel recomputation, member authority, audit and deletion; “DASH-007 restricted matches refuse unsupported patterns visibly at every filter door and keep whole visits” proves backreference and lookaround refusals with reasons in the filter form, segment save and summary API, no saved mutation, accepted linear patterns retaining whole visits, and 1440 and 390 screens with the menu tooltip.
**Gap.** None.

#### DASH-008 — Period comparisons

Core · target · **done**

**Requirement.** Any range can be compared with the previous period, the same period last year or a custom period. Both series appear on the chart, and every table shows the change with its absolute and percentage values. Comparisons match weekdays when the owner chooses.

**Acceptance.**
1. Compare the last 30 days with the previous period and with last year.
2. The chart overlays and the per-row changes match the seeded data.

**Evidence.** `src/vane/periods.ts`; `src/vane/reports.ts`; `src/vane/views/chart.ts`; `src/vane/views/report.ts`; `src/vane/views/tables.ts`; `src/vane/views/html.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### DASH-009 — Annotations, manual and automatic

Core · target · **done**

**Requirement.** Team members add dated notes to charts. Vane adds annotations for settings and definition changes, imports, agent-shipped changes (`AGENT-003`), Mango campaign sends, Uptime incidents, Spool error spikes, deploy webhooks and GitHub releases. Annotations show on every affected chart, in reports and in agent explanations.

**Acceptance.**
1. Add a manual note, approve a settings change, post a deploy webhook and receive an Uptime incident.
2. All four annotations appear on the chart at the right time.
3. Each one is listed in the explanation of a report whose range covers it (`REPORT-003`).

**Evidence.** `src/vane/annotations.ts`; `src/vane/annotation-door.ts`; `src/vane/github-releases.ts`; `src/vane/overview.ts`; `src/vane/views/chart.ts`; `src/vane/views/report.ts`; `src/vane/views/settings.ts`; `migrations/core/0029_vane_annotations.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### DASH-010 — Multi-site overview and roll-up

Core · target · **done**

**Requirement.** The sites list shows each site's visitors, change and a sparkline for the selected range, and the list can be sorted and searched. An owner can create a roll-up view that combines several sites, for example the marketing site and the store. Every report, filter and breakdown works on the roll-up, and each row can be split by site. The roll-up never de-duplicates people across sites, because `METRIC-001` hashes the site ID into every visitor hash. So each metric combines by a stated rule. Visitors and visits are the sum of each site's own counts, labeled "summed per site", with a note that one person on two sites counts once per site. Pageviews, events, conversions and revenue are exact sums. Bounce rate, visit duration and conversion rate are recomputed from the summed visits and conversions, not averaged across sites. The methodology page (`METRIC-004`) states these rules, and the roll-up links to them. A site with consented mode (`METRIC-005`) still counts its visitors on its own, so the roll-up never links one consented identifier across sites.

**Acceptance.**
1. With three sites, open the overview, sort it by change and create a roll-up of two of them.
2. Send one simulated visitor (same IP and user agent) to both sites on one day, and two other visitors to one site each.
3. The roll-up shows 4 visitors and 4 visits, labeled "summed per site", with the cross-site note.
4. Its pageviews, conversions and revenue equal the exact sums.
5. Its bounce rate equals the summed bounced visits over the summed visits.
6. The site split gives each site's own figures, and the methodology page states each rule.

**Evidence.** `src/vane/overview.ts`; `src/vane/rollups.ts`; `src/vane/reports.ts`; `src/vane/methodology.ts`; `src/vane/views/settings.ts`; `src/vane/views/rollup.ts`; `src/vane/views/report.ts`; `migrations/core/0028_vane_rollups.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### DASH-011 — Journeys and paths

Core · target · **done**

**Requirement.** From any page or entry page, a journey view shows the next and previous three steps within visits, with counts and drop-off, and it can be filtered by segment.

**Acceptance.**
1. Seed visits through home → pricing → signup and home → blog → exit.
2. The journey from home shows both paths with the right counts.

**Evidence.** `src/vane/journeys.ts`; `src/vane/reports.ts`; `src/vane/views/report.ts`; `src/vane/views/tables.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### DASH-012 — Site-search analytics

Core · target · **done**

**Requirement.** When the owner names the site-search query parameter, Vane reports search terms, searches per visit, the pages searches start from and the share of visits that exit after searching. A search term is shown only after at least two different visitors have searched it, so one person's search cannot be singled out.

**Acceptance.**
1. Search `?q=returns` from two visitors and `?q=alice@example.com` from one.
2. The returns term appears and the email-like term never does.

**Evidence.** `src/vane/search.ts`; `src/vane/collect.ts`; `src/vane/tracker.ts`; `src/vane/privacy.ts`; `src/vane/views/report.ts`; `migrations/core/0022_vane_search.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### DASH-013 — Hostnames and subdomains within one site

Core · target · **partial**

**Requirement.** A site that accepts several hostnames (`SITE-001`), for example `www.example.com`, `blog.example.com` and `app.example.com`, records the hostname of every pageview and event (`COLLECT-002`) as a dimension. The hostname is stored lowercased and without its port, and only when it is one of the site's allowed hostnames. A Hostnames report shows visitors, visits, pageviews, bounce rate and conversions per hostname. Page, entry and exit tables keep the same path on different hostnames apart (`DASH-003`). A Hostname filter (is, is not, contains, and matches with wildcards such as `*.example.com`) narrows every report, funnel, goal, alert, shared link, export and Stats API answer (`DASH-007`, `API-001`), and it can be saved in a segment. A goal or funnel step can be scoped to a hostname.

**Acceptance.**
1. On one site with `www.` and `blog.` hostnames, send `/` and `/pricing` from each.
2. The pages table shows four rows, each with its hostname.
3. The Hostname filter `is blog.example.com` narrows the dashboard, the Stats API answer and a CSV export to the blog's events.
4. `is not` and `contains` return the complements and matches, a wildcard matches both hostnames, and a segment saved with the filter gives the same totals in a scheduled report.
5. An event from a hostname that is not allowed is refused.

**Evidence.** `src/vane/hosts.ts`; `src/vane/visits.ts`; `src/vane/reports.ts`; `src/vane/goals.ts`; `tests/vane.test.mjs`
**Gap.** The Hostname filter on the Stats API answer and on a CSV export, and a hostname segment's totals in a scheduled report, are unasserted; the dashboard filter, is, is not, contains and wildcard, the four page rows and the refused hostname are asserted.

#### DASH-014 — Named sources for referrer domains and app referrers

Core · target · **partial**

**Requirement.** Every referrer is reported under a named source from a maintained source list that Vane publishes with its methodology (`METRIC-004`). Web and app referrers for the same service group together: `news.ycombinator.com` reports as Hacker News, `android-app://com.slack.android`, `slack.com` and `app.slack.com` as Slack, `l.facebook.com`, `m.facebook.com` and `android-app://com.facebook.katana` as Facebook, and `t.co` as X. The source feeds the channel definitions (`DASH-004`), and the referrer domains and app identifiers stay available as a drill-down beneath each source. A referrer that is not on the list reports under its own domain, and an owner can add grouping rules of their own through `APPROVE-001`.

**Acceptance.**
1. Send visits with the referrers `https://news.ycombinator.com/item?id=1`, `android-app://com.slack.android`, `https://app.slack.com/` and `https://l.facebook.com/`, and an unlisted `https://brewblog.example/`.
2. The sources table shows Hacker News, Slack with two visits, Facebook and `brewblog.example`, and Slack's drill-down lists both of its referrers.
3. An approved owner rule naming `brewblog.example` as Brew Blog regroups that row, and the published source list names every grouping used.

**Evidence.** `src/vane/sources.ts`; `src/vane/channels.ts`; `src/vane/reports.ts`; `tests/vane.test.mjs`
**Gap.** That the published source list names every grouping used is unasserted; the named sources, the Slack drill-down and the approved owner rule are asserted.

#### PERF-001 — Page performance

Core · target · **done**

**Requirement.** The script can report Core Web Vitals (LCP, INP, CLS) and page load time, without identifiers, and Vane shows them per page and device class at the 75th percentile. Performance alerting and synthetic checks belong to [Uptime](https://github.com/just-every/run-uptime), which can read these figures.

**Acceptance.**
1. Load a fixture page with an artificially slow image and see its LCP p75 above 2.5 s on that page only.

**Evidence.** `src/vane/performance.ts`; `src/vane/tracker.ts`; `src/vane/reports.ts`; `src/vane/views/report.ts`; `src/vane/methodology.ts`; `src/vane/inventory.ts`; `migrations/core/0030_vane_performance.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### HEAT-001 — Aggregate click and scroll maps

Core · target · **done** · Rules D-2

**Requirement.** For pages the owner chooses, Vane records click positions on a grid and scroll depth, without identifiers, form contents or text. It shows them as a heatmap and a scroll map over the page’s recorded geometry, with blocks sized from the captured anonymous layout grid and no image. No individual session can be replayed. Heatmaps are off until the owner enables an audited exact path, and only the owner reads the maps (RL-2). A live screenshot behind the maps is `HEAT-002`.

**Acceptance.**
1. Click two buttons repeatedly on a fixture page.
2. The heatmap concentrates on them, no event holds text or identifiers, and the scroll map matches `METRIC-006`.

**Evidence.** `tests/heat.test.mjs` — “HEAT-001 real clicks aggregate at two buttons without text or identifiers; scroll reach is METRIC-006 and recorded geometry maps fit desktop and mobile” proves two real button concentrations, anonymous grid/geometry request and custody shape, denied consent and privacy signals, off-default owner-only audited controls, scroll equality with METRIC-006 and both recorded-geometry map pages at 1440/390. `tests/proxy-adapters.test.mjs` — “server proxy forwards every public tracker door over HTTP and strips untrusted identity and credentials” includes heat clicks.
**Gap.** None.

### Conversions and revenue

#### CONV-001 — Pageview goals with patterns and conversion rates

Core · target · **done**

**Requirement.** A goal can be a single path or a wildcard pattern with these rules: `*` matches within one path segment and `**` across segments (`/thank-you*`, `/thanks/*`, `/blog/**`). Reports show conversions, unique converting visitors and the conversion rate against visitors. A goal can also be a scroll-depth goal: visitors reaching N% (any whole percentage) of a page or pattern, such as 75% on `/blog/**`, counted from `METRIC-006`, with the same uniques and conversion rate. the aggregate source’s scroll-depth goals import as these (`IMPORT-008`).

**Acceptance.**
1. Define `/thanks/*` and `/thanks**` and visit `/thanks/pro` and `/thanks/pro/annual`.
2. `/thanks/*` converts on `/thanks/pro` only (`*` stays within one path segment), `/thanks**` converts on both, and the conversion rate equals converting visitors divided by visitors.
3. Define a 75% scroll goal on `/blog/**`.
4. A visitor scrolling a post to 80% converts and one scrolling to 50% does not.

**Evidence.** `src/vane/goals.ts`; `src/vane/privacy.ts`; `src/vane/collect.ts`; `src/vane/reports.ts`; `src/vane/views/report.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### CONV-002 — Custom events with properties

Core · target · **done**

**Requirement.** Sites send events through `vane('Signup', {props: {plan: 'pro'}})` or by adding CSS classes (`vane-event-name=Signup`, with property classes). An event can carry up to 30 properties with string or number values. Property keys and values pass the `COLLECT-002` redaction, and an event carrying an email address is refused. Properties are dimensions for filtering (`DASH-007` filters and saved segments), breakdowns and funnels. Pageviews, automatic or sent with `vane('pageview', {url, props})`, carry properties the same way, for example author or category on a blog post (`INSTALL-007`). The script also accepts the aggregate website analytics and event-value analytics call and class syntax, so a switched site keeps counting before any code changes (`IMPORT-008`). A funnel step can be a custom event with property conditions (`CONV-005`).

**Acceptance.**
1. Fire Signup with plan=pro and plan=free through JavaScript and CSS classes.
2. The breakdown by plan matches, and a property holding an email address is refused.
3. A manual pageview (`INSTALL-007`) with author=jo breaks down by author.
4. A funnel step on Signup with plan=pro counts only the pro signups.
5. A `DASH-007` filter plan is pro keeps only the visits with a pro signup.

**Evidence.** `src/vane/custom-events.ts`; `src/vane/properties.ts`; `src/vane/custom-reports.ts`; `src/vane/collect.ts`; `src/vane/tracker.ts`; `src/vane/segments.ts`; `src/vane/funnels.ts`; `src/vane/views/events.ts`; `migrations/core/0032_vane_custom_events.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### CONV-003 — Automatic outbound-link, file-download, 404 and form-submission events

Core · target · **done**

**Requirement.** Each automatic event is turned on per site. Outbound links record the destination URL without its query, downloads record the file path for common document and media extensions, 404 pages record the missing path (the site marks its 404 page), and form submissions record the form's ID or action path, never field values.

**Acceptance.**
1. Click an outbound link and a PDF link, open a 404 page and submit a form on a fixture site.
2. Four events arrive with the right properties and no form contents.

**Evidence.** `src/vane/auto-events.ts`; `src/vane/tracker.ts`; `src/vane/privacy.ts`; `src/vane/views/settings.ts`; `src/vane/views/tables.ts`; `migrations/core/0023_vane_auto_events.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### CONV-004 — Conversion rates by source, campaign, landing page and audience

Core · target · **done**

**Requirement.** Every breakdown (channel, referrer, UTM, entry page, country, device) can show the conversions, conversion rate and revenue for a chosen goal.

**Acceptance.**
1. Seed conversions from Google and from email.
2. The channel table shows each channel's conversion rate and revenue for the selected goal.

**Evidence.** `src/vane/visits.ts`; `src/vane/reports.ts`; `src/vane/views/tables.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### CONV-005 — Funnels

Core · target · **done**

**Requirement.** An owner or analyst defines a funnel of 2 to 8 steps (pageviews, wildcard paths or custom events with property conditions), ordered within one visit, or within one visitor across visits in consented mode. The funnel report shows the entrants, conversion and drop-off at each step, the median time between steps and a segment filter. Clicking a drop-off opens the journeys (`DASH-011`).

**Acceptance.**
1. Define the funnel product → cart → checkout → purchase and seed visits that drop at each step.
2. The step counts and rates match, and the segment filter recomputes them.

**Evidence.** `src/vane/funnels.ts`; `src/vane/reports.ts`; `src/vane/privacy.ts`; `src/vane/views/report.ts`; `src/vane/views/settings.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### CONV-006 — Revenue goals

Core · target · **done**

**Requirement.** A custom event can carry a revenue amount and an ISO currency. Revenue is stored and reported in the currency the event sends; reports total it in the site's currency (USD by default, `SITE-001`), and another currency converts only at an exchange rate the owner entered for it, dated, which is shown and labeled as owner-entered and never fetched; revenue no rate converts is listed separately in its own currency. Reports show total revenue, average order value, and revenue per visitor by source, campaign, page and segment. Payment-processor referrers (Stripe Checkout, PayPal, Shop Pay, Klarna, Afterpay) are excluded from attribution, so the original source keeps credit. Revenue for the selected goal joins every breakdown row that shows conversions (`CONV-004`).

**Acceptance.**
1. Record USD and CAD purchases with a Stripe Checkout return referrer.
2. Revenue totals in USD at the owner-entered CAD rate, which is shown, and attribution goes to the original source rather than Stripe, both after the visit timeout and within the visit; a EUR amount with no rate is listed apart.
3. The methodology page (`METRIC-004`) defines revenue: what is summed, the owner-entered conversion rate and the roll-up's exact sum.
4. With Google and email conversions seeded, the channel table shows each channel's revenue and revenue per visitor for the selected goal, and the revenue chart, its data table, the compared period and a roll-up's exact sum match.
5. The site's public stats page, with totals, pages and devices chosen, shows no revenue; once the owner adds the revenue report, it shows the USD and CAD amounts as sent, the USD total with the CAD rate labeled as owner-entered and the EUR amount apart, while the page and device rows still carry none.

**Evidence.** `src/vane/revenue.ts`; `src/vane/custom-events.ts`; `src/vane/collect.ts`; `src/vane/visits.ts`; `src/vane/series.ts`; `src/vane/reports.ts`; `src/vane/methodology.ts`; `src/vane/privacy.ts`; `src/vane/views/revenue.ts`; `src/vane/views/tables.ts`; `src/vane/views/chart.ts`; `src/vane/views/settings.ts`; `migrations/core/0034_vane_revenue.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### CONV-007 — Ecommerce events

Core · target · **done**

**Requirement.** Standard events cover product view, add to cart, begin checkout and purchase, with a product SKU, name, category, quantity and price. WooCommerce (`INSTALL-002`), Shopify (`INSTALL-003`) and [Stall](https://github.com/just-every/run-stall) (`INSTALL-010`) emit them under their own clauses, and a ready-made ecommerce funnel and a product-performance report come with them.

**Acceptance.**
1. In a browser, one visitor views a tee, adds two to the cart, adds a mug, checks out and buys both across three page loads, and another views and adds a tee.
2. The ecommerce funnel shows 2, 2, 1 and 1 visits, and the product report shows each product's views, units and revenue ($50.00 for the tees, $12.50 for the mug), with a euro purchase kept as €20.00.
3. Lines on another event, an email address in a line, a zero quantity, an unknown or missing currency, an undeclared line field and more than 50 lines are refused.

**Evidence.** `src/vane/ecommerce.ts`; `src/vane/custom-events.ts`; `src/vane/tracker.ts`; `src/vane/reports.ts`; `src/vane/views/events.ts`; `migrations/core/0033_vane_ecommerce.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### CONV-008 — Conversions reconciled with real orders and leads

Core · target · **missing**

**Requirement.** Connected outcome sources confirm browser conversions by an opaque order or submission ID, never by customer details. Stripe confirms through webhooks, Shopify and WooCommerce through their order APIs, and Stall through its events. Lead and booking sources are HubSpot forms and CRM, [Orbit](https://github.com/just-every/run-orbit), [Pencil](https://github.com/just-every/run-pencil) and [Dial](https://github.com/just-every/run-dial). Reports show browser-reported, confirmed, unconfirmed and server-only outcomes side by side, with refunds subtracted, and attribute a server-only outcome to a source only when its browser event matched. It also raises `ALERT-002`'s tracking-health alert for a divergence between browser-reported and confirmed outcomes, under that clause's daily check, recipients and explanation.

**Acceptance.**
1. Complete three Stripe test payments, one with the browser event blocked and one refunded, and two HubSpot form submissions, one later marked qualified.
2. The report shows each outcome in its correct confirmed or unconfirmed column, with net revenue.
3. Block browser purchase events while Stripe confirms orders, and the `ALERT-002` divergence alert names the gap.

**Evidence.** None.
**Gap.** No outcome-source connections or reconciliation; it carries `ALERT-002`'s divergence alert.

#### CONV-009 — No-code event definitions

Core · target · **done**

**Requirement.** In the app, an owner or analyst can define events without editing the site: a click on a CSS selector, a form submission, an element becoming visible, or a pageview pattern. A definition is previewed against the live page and applied through `APPROVE-001`, and the script picks it up from the site configuration.

**Acceptance.**
1. Define a click event for `#book-demo`, preview the matched element and approve it.
2. Clicks on the live fixture arrive as the event, with no site code change.

**Evidence.** `src/vane/event-definitions.ts`; `src/vane/privacy.ts`; `src/vane/tracker.ts`; `src/vane/routes.ts`; `src/vane/views/settings.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### EXPERIMENT-001 — A/B tests with honest results

Core · target · **done**

**Requirement.** An owner sets up a split test of 2 to 4 variants on a page. Assignment is stable within a visitor's day in cookie-free mode, and across days in consented mode. The site applies a variant through the script API or the buyer's code; applying one from Pane is `INSTALL-009`. Results show each variant's visitors, conversions and conversion rate with a 95% interval, the probability that it beats control, a minimum-sample warning, and a sample-ratio-mismatch check. A test cannot be called while it is underpowered.

**Acceptance.**
1. Run a fixture test with a seeded 20% lift and a null test.
2. The first reaches significance with the expected interval, the null test never does, and a skewed split triggers the mismatch warning.
3. Before every variant has the minimum sample the test reports underpowered and calls no result.
4. In a browser, `vane('experiment', ...)` hands the page its variant and reports the exposure, and an exposure naming its own variant is refused.

**Evidence.** `src/vane/experiments.ts`; `src/vane/experiment-stats.ts`; `src/vane/collect.ts`; `src/vane/tracker.ts`; `src/vane/reports.ts`; `src/vane/privacy.ts`; `src/vane/views/experiments.ts`; `src/vane/views/settings.ts`; `migrations/core/0035_vane_experiments.sql`; `tests/vane.test.mjs`
**Gap.** None.

### Search and advertising

#### SEARCH-001 — Google Search Console keywords

Core · target · **done** · Rules D-3, D-4

**Requirement.** The owner connects Google Search Console through OAuth with a read-only scope. Vane shows queries with clicks, impressions, CTR and average position, per page and overall, for any range Search Console holds (up to 16 months). Clicking a query filters the dashboard's organic landing pages. Tokens are encrypted and can be disconnected. Vane syncs Search Console at least daily. Search Console publishes each day two to three days late, so the latest days show as pending with the next sync time, and each is filled in once at the first sync after Google publishes it. Each query lists the landing pages its clicks went to, beside that page's Vane visitors.

**Acceptance.**
1. Against a Search Console API fixture, connect, read the queries, filter by a query and disconnect.
2. The query and page figures match the fixture, and the tokens are removed after disconnect.
3. With a fixture that has not yet published its last two days, those days show as pending with the next sync time.
4. After the fixture publishes them, the next sync fills both days in once with the fixture's figures, and each query lists its landing pages with their clicks and Vane visitors.

**Evidence.** `src/vane/search-console/index.ts`; `src/vane/routes.ts`; `src/vane/views/search-keywords.ts`; `migrations/core/0054_vane_search.sql`; `tests/search-console.test.mjs`
**Gap.** None.

#### SEARCH-002 — Bing Webmaster Tools keywords

Core · target · **done** · Rules D-3, D-4

**Requirement.** The same keyword report is available from Bing Webmaster Tools (API key or OAuth), shown beside Google's.

**Acceptance.**
1. Against a Bing API fixture, connect and see Bing queries beside Google's with matching figures.

**Evidence.** `src/vane/bing/index.ts`; `src/vane/routes.ts`; `src/vane/views/search-keywords.ts`; `migrations/core/0055_vane_bing.sql`; `tests/bing.test.mjs`
**Gap.** None.

#### ADS-001 — Ad spend matched to campaigns

Core · target · **missing** · Rules D-3

**Requirement.** The owner connects Google Ads, Microsoft Advertising, Meta Ads and LinkedIn Ads read-only. Vane imports daily campaign-level spend, impressions and clicks in USD, and nothing at the person level. It matches campaigns to UTM campaigns by name or by an explicit mapping, and it reports cost per visit, cost per conversion and return on ad spend from confirmed revenue (`CONV-008`).

**Acceptance.**
1. Against ad API fixtures, connect two platforms and map one campaign by hand.
2. Spend, CPA and ROAS per campaign match the fixtures and the confirmed revenue.

**Evidence.** None.
**Gap.** No ad-platform connections.

### Import and migration

#### IMPORT-002 — Property-based analytics history import

Core · target · **partial** · Rules D-3, D-4

**Requirement.** The owner connects property-based analytics through OAuth (read-only) and picks a property and a date range. Vane imports daily aggregates through the property-based analytics Data API: users, sessions, pageviews, bounce and engagement, pages, landing pages, channels, source and medium, campaigns, countries, regions, cities, devices, browsers, operating systems, key events and ecommerce revenue. Every import shows a preview of the property-based analytics metric definitions that differ from Vane's, is journaled and can be undone (`IMPORT-001` custody). Legacy session analytics archives exported as CSV import the same way.

**Acceptance.**
1. Against a property-based analytics Data API fixture, preview, apply, read the journal and undo a 13-month import.
2. Imported totals match the fixture per dimension, and the definition-difference notes are shown.

**Evidence.** `tests/ga4.test.mjs` — “IMPORT-002 thirteen months of GA4 daily history and independent dimensions preserve source metrics, key events, review, journal and undo without creating native visits” proves each source dimension and definition differences; “IMPORT-002 UA CSV retains daily source aggregates; rejects partial GA4 exports, forged carries, personal URLs and unsupported columns before custody” proves UA and refusal; “Connected GA4 reads every source page before review, journals and undoes source history, fences OAuth and visibly stops revoked access” proves paged read-only OAuth, returned properties, inclusive 13-month dates, 910 rows including a second Data page and second Admin pages, sealed nonportable tokens, revocation, journal and undo; “IMPORT-002 owner uploads, reviews, applies, completes a recovered key event for approval and undoes source reports at desktop and mobile widths” proves review and definition completion at 1440 and 390. `docs/history.md`.
**Gap.** The definition-difference notes are unasserted; preview, apply, journal, undo and the per-dimension and daily totals of a 13-month import are asserted.

#### IMPORT-003 — Aggregate website analytics import

Core · target · **done** · Rules D-4

**Requirement.** Vane imports an aggregate website analytics CSV export ZIP, or reads the aggregate website analytics Stats API with a buyer's API key. It covers visitors, visits, pageviews, bounce rate, duration, pages, entry and exit pages, sources, UTM fields, locations, devices, goals, custom properties and revenue, with the same preview, journal and undo. The import also recovers the site's goal and custom-property definitions from whatever the buyer's aggregate website analytics plan exposes, and rebuilds funnels through a guided step, because aggregate website analytics exposes no funnel definitions in any export or API (`IMPORT-012`). The recovered definitions are proposed as Vane definitions (`IMPORT-008`). Dashboard CSV breakdowns summarize the exported period and carry the owner-chosen period label date; the dated visitors series keeps its source dates. Stats API reads import one source-local date at a time, with source units, percentages and currency retained. Every report stays separate from native totals; merging and overlap remain `IMPORT-007`.

**Acceptance.**
1. Import a fixture in the aggregate source’s dashboard-export layout and a Stats API fixture.
2. Each dimension's totals match the source, the goals are proposed under the same names with the types and patterns `IMPORT-009` recovers, no funnel is read from either source, and undo removes the imported history.

**Evidence.** `src/vane/movein/plausible-history.ts`; `src/vane/movein/plausible-export.ts`; `src/vane/movein/aggregates.ts`; `src/vane/views/imported-reports.ts`; `tests/plausible-history.test.mjs`; `tests/plausible-definitions.test.mjs`
**Gap.** None.

#### IMPORT-004 — Event-value analytics import

Core · target · **missing**

**Requirement.** Vane imports the event-value source’s CSV export (pageviews, visitors, referrers, UTM fields, locations, devices and events), with preview, journal and undo. Event-value analytics event names and their `_value` revenue are proposed as Vane goals and revenue goals (`IMPORT-008`).

**Acceptance.**
1. Import an event-value analytics export fixture.
2. The totals match, each event-value analytics event is proposed as a goal under its name, and undo works.

**Evidence.** None.
**Gap.** No event-value analytics import.

#### IMPORT-005 — Reporting analytics import

Core · target · **partial** · Rules D-3, D-4

**Requirement.** Vane imports from hosted reporting analytics or self-hosted reporting analytics through its Reporting API with a token, or from report CSV exports. It brings visits, unique visitors, actions, pages, referrers, campaigns, locations, devices, goals and ecommerce, with preview, journal and undo. Visitor logs are never imported.

**Acceptance.**
1. Import from a reporting analytics Reporting API fixture.
2. The aggregates match, no visitor-log rows are stored, and undo works.

**Evidence.** `src/vane/movein/matomo.ts`; `src/vane/movein/matomo-reader.ts`; `src/vane/movein/aggregates.ts`; `src/vane/views/imported-reports.ts`; `migrations/core/0053_vane_import_reports.sql`; `tests/matomo.test.mjs`
**Gap.** Hosted reporting analytics and self-hosted Reporting API and unformatted report CSVs import daily aggregate visits, visitors, actions, pages, referrers, campaigns, locations, devices, goals and ecommerce without visitor logs. Owner-reviewed preview, resumable apply, journal, undo, archive and restore, retention and native goal proposals work. Gap: resolved-address and pinned egress (Base egress door) for the owner-entered endpoint (RL-7).

#### IMPORT-006 — Event-based analytics, lightweight analytics and web-event analytics at full scale

Core · target · **done**

**Requirement.** Beyond the event-based analytics v2 Events page (`IMPORT-001`), Vane imports a complete event-based analytics database export or reads its API across all pages. It also imports lightweight analytics exports and web-event analytics web events (a `$pageview` export), keeping only the declared anonymous fields, with resumable batches for millions of rows.

**Acceptance.**
1. Import a 2-million-row event-based analytics export, a lightweight analytics export and a web-event analytics export fixture, with an interruption mid-way.
2. Each resumes, totals match, and no identifiers are kept.

**Evidence.** `tests/import-scale.journey.mjs` — “IMPORT-006 two-million-row Umami CSV preview and publication resume after one million rows, preserving exact anonymous totals under a bounded CLI heap” proves all two million distinct source records, interrupted preview and publication, lost committed response, exact resumed per-day and page totals and unknown coverage, bounded CLI heap and identifier absence across custody. It runs on the exact committed candidate SHA through heavy-slot, separately from push Verify; the landing report cites that run ID. `.github/workflows/import-scale.yml` runs nightly in job umami-publication at 19:43 UTC and provides the manual branch workflow_dispatch door. `tests/import-export.test.mjs` — “IMPORT-006 whole Umami and Simple Analytics CSV files preview in bounded pages, resume interrupted preview and publication, preserve totals without identifiers, and refuse changed sources or unreviewed apply” and “IMPORT-006 whole PostHog JSON Lines preview and apply resume after interruption and a lost response, deduplicate across pages, discard identifiers and undo through the public doors” prove the other provider exports, reviewed publication, cross-page deduplication, journal and undo and source-change refusals.
**Gap.** None.

#### IMPORT-007 — Imported history merges without double counting

Core · target · **done** · Rules D-4

**Requirement.** Each import declares a cut-over date. For overlapping days, live data wins and the overlap is reported. Imported periods are labeled on charts with their source and their definition differences, and their coverage counts as unknown (`COVERAGE-001`). Any viewer, including a shared-link viewer, can switch imported data on or off for the dashboard. The choice applies to every report, comparison and CSV export on that view, and the Stats API takes the same choice as a query option. Two imports never double count either. When an import covers days that another import already holds, such as an aggregate website analytics export reaching back into a period imported from property-based analytics, its preview names those days and the source that holds them. They are skipped unless the owner chooses the new source for them, and the import journal lists them. The parallel-run report is `IMPORT-010`.

**Acceptance.**
1. Import property-based analytics history that overlaps two days of live collection.
2. Charts show the overlap once using live data, label the imported range and count it as unknown coverage.
3. Switching imported data off removes the imported range from the chart, the tables, a CSV export and the Stats API answer with the option set, and switching it back on restores them.
4. Import property-based analytics history through 4 June 2024, then preview an aggregate website analytics export that starts on 3 June 2024.
5. The preview lists 3–4 June 2024 as overlapping property-based analytics and skipped, the applied import's journal lists them, and those days' totals equal property-based analytics's alone.

**Evidence.** `tests/import-merge.test.mjs` — “IMPORT-007 later sources name and skip held days; the owner can replace them without losing undo or custody” proves property-based analytics-held 3–4 June totals, named preview and journal skips, owner replacement, repeated approval, successive undo and event-export overlap; “IMPORT-007 any viewer switches imported data off and on for the dashboard, its comparison, CSV tables, shared link and both Stats API doors” proves all viewer doors; “IMPORT-007 a reviewed cut-over keeps live days once across events, source reports, CSV and ZIP; custody, transfer, restore and undo retain the policy” proves normalized date precedence, unknown coverage and portability; “IMPORT-007 the owner reviews and applies a dated import through the history form at 1440 and 390” proves date review and source and definition labels on the chart. `tests/import-parallel.test.mjs` — “IMPORT-010 owner compares 14 live overlap days with paginated Plausible queries and an export, attributes measured bot differences only to owner evidence, saves nothing, and uses history forms at 1440 and 390” proves both daily columns, sources, every goal kind, known bot-filter evidence, unresolved causes and browser review. `tests/import-export.test.mjs` — “IMPORT-006 whole PostHog JSON Lines preview and apply resume after interruption and a lost response, deduplicate across pages, discard identifiers and undo through the public doors” proves one declared CLI cut-over across duplicate source events on separate pages.
**Gap.** None.

#### IMPORT-010 — Parallel-run report during a switch

Core · target · **done** · From IMPORT-007 · Rules D-4

**Requirement.** A buyer who runs both scripts during a switch gets a parallel-run report for the overlap days: Vane's and the incumbent's visitors, visits, pageviews, bounce rate, top sources and goal conversions side by side per day (the incumbent's read through its Stats API or export). Each difference over 5% is explained by its known cause: definition, bot filtering, consent, blockers or proxy coverage, from evidence the owner supplies; a difference without evidence stays unresolved.

**Acceptance.**
1. Against an aggregate website analytics Stats API fixture for 14 overlap days, the parallel-run report shows both columns per day and explains a seeded bot-filter difference.

**Evidence.** `tests/import-merge.test.mjs` — “IMPORT-007 later sources name and skip held days; the owner can replace them without losing undo or custody” proves property-based analytics-held 3–4 June totals, named preview and journal skips, owner replacement, repeated approval, successive undo and event-export overlap; “IMPORT-007 any viewer switches imported data off and on for the dashboard, its comparison, CSV tables, shared link and both Stats API doors” proves all viewer doors; “IMPORT-007 a reviewed cut-over keeps live days once across events, source reports, CSV and ZIP; custody, transfer, restore and undo retain the policy” proves normalized date precedence, unknown coverage and portability; “IMPORT-007 the owner reviews and applies a dated import through the history form at 1440 and 390” proves date review and source and definition labels on the chart. `tests/import-parallel.test.mjs` — “IMPORT-010 owner compares 14 live overlap days with paginated Plausible queries and an export, attributes measured bot differences only to owner evidence, saves nothing, and uses history forms at 1440 and 390” proves both daily columns, sources, every goal kind, known bot-filter evidence, unresolved causes and browser review. `tests/import-export.test.mjs` — “IMPORT-006 whole PostHog JSON Lines preview and apply resume after interruption and a lost response, deduplicate across pages, discard identifiers and undo through the public doors” proves one declared CLI cut-over across duplicate source events on separate pages.
**Gap.** None.

#### IMPORT-008 — Tracking cut-over keeps incumbent calls and definitions

Core · target · **partial**

**Requirement.** On the day the buyer swaps the incumbent's script for Vane's, their custom events, conversions and revenue keep arriving with no page edit, and their goal definitions come with them. The cut-over has two parts here; the call-site scan is `IMPORT-011`. *Compatible calls.* With the owner's per-site *Incumbent compatibility* setting approved and on (the public script-config response then adds only its compatibility flag and ISO site currency, under `COLLECT-001`), `vane.js` defines `window.plausible` and `window.fathom` shims. `plausible(name, {props, revenue: {amount, currency}, interactive, callback})` and its pre-load queue (`window.plausible.q`) become Vane custom events with properties and revenue. The `plausible-event-name=` CSS classes become events too, in both the `=` and the `--` form, with `plausible-event-<prop>=` property classes and `+` read as a space. `fathom.trackEvent(name, {_value})` becomes an event whose `_value` is read in cents and converted to the site currency (USD by default, `CONV-006`), and `fathom.trackPageview()` becomes a pageview. The shim also reads the options an aggregate website analytics snippet configures, so pageview properties and automatic events do not stop silently after cut-over. Every shimmed call passes the same `COLLECT-001`/`COLLECT-002` field rules and redaction as a native call, so an incumbent call carrying an email address is refused. The incumbent's own script tag, if left in place, is detected and reported. *Definitions carried over.* Vane proposes the incumbent's pageview, custom-event, scroll-depth and revenue goals and its custom-property names under the same names, so imported history and live conversions line up. Each definition comes from the source the buyer's incumbent plan actually exposes, and funnels are rebuilt through the guided step, as `IMPORT-012` sets out. Property-based analytics key events (`IMPORT-002`) and reporting analytics goals (`IMPORT-005`) are proposed the same way. The proposals wait for approval (`APPROVE-001`). Approving one makes live conversions count against it from that moment, and each carried-over definition is annotated (`DASH-009`).

**Acceptance.**
1. On a fixture page instrumented only with aggregate website analytics calls (props and USD revenue) and `plausible-event-name=Book+Demo` and `plausible-event-name--Book+Demo` classes, swap in `vane.js` with compatibility on.
2. The same events, properties and USD revenue arrive with no page edit.
3. On a fixture page whose snippet calls `plausible.init({customProperties: {author: 'jo'}, fileDownloads: {fileExtensions: ['dwg']}})`, the pageview carries author=jo and a click on a `.dwg` link arrives as a file download.
4. On a second fixture page with `fathom.trackEvent('Purchase', {_value: 4999})`, a $49.99 revenue event arrives.
5. After the `IMPORT-009` export fixture is imported, the goals are proposed under the same names, and approving them makes the live events from the first fixture count as conversions in the goal reports.

**Evidence.** `src/vane/tracker-compat.ts`; `src/vane/cutover/scan.ts`; `src/vane/cutover/findings.ts`; `src/vane/movein/import-definitions.ts`; `tests/plausible-definitions.test.mjs`; `tests/incumbent-options.test.mjs`; `tests/sitemap-scan.test.mjs`
**Gap.** `plausible()` calls carrying USD revenue and the `plausible-event-name=` and `plausible-event-name--` class forms are unasserted; `plausible()` events with properties, the init options, Fathom cents and the approved carried-over goals are asserted.

#### IMPORT-011 — Call-site scan drafts native rewrites

Core · target · **done** · From IMPORT-008 · Cites BASE-DATA-004

**Requirement.** An explicit owner- or administrator-started scan in installation settings reads the registered origin's sitemaps and the same-origin pages they list, up to an owner-selected page limit, and lists every page that still loads an incumbent script or fires an incumbent call or class. For each one it drafts the native `vane()` rewrite, so the shim can be retired. Its fetch boundary is in `docs/contract/data-flows.md`.

**Acceptance.**
1. A third page that still loads `plausible.js` appears in the call-site scan with a drafted rewrite.

**Evidence.** `src/vane/tracker-compat.ts`; `src/vane/cutover/scan.ts`; `src/vane/cutover/findings.ts`; `src/vane/movein/import-definitions.ts`; `tests/plausible-definitions.test.mjs`; `tests/incumbent-options.test.mjs`; `tests/sitemap-scan.test.mjs`
**Gap.** None.

#### IMPORT-009 — Goal definitions recovered from what each incumbent plan exposes

Core · target · **done**

**Requirement.** Vane recovers each incumbent definition from a source that really holds it on the buyer's plan, never from one that does not, and it says which source each proposal came from. *Aggregate website analytics Business with a Stats API key.* Vane reads goals and custom properties from the read-only Sites API endpoints , which aggregate website analytics opens to a Stats API key on any plan that includes the Stats API. *Aggregate website analytics Enterprise with a Sites API key.* Vane reads the same endpoints with the Sites API key, and the threshold and currency are recovered the same way. *Aggregate website analytics Starter, or a buyer with only the dashboard CSV export.* The export's `conversions.csv` holds goal display names and summary counts, and `custom_props.csv` holds property names and values. Vane infers each goal's definition from the aggregate source’s default display-name forms. A matching accepted live event carrying revenue establishes a revenue goal and its currency, which the owner must confirm. *What cannot be recovered is asked for, never guessed.* A display name the owner renamed in aggregate website analytics and that matches no form, and a currency or threshold that no source holds, is listed under **Needs completion** with the evidence Vane has (its imported conversion counts and any matching live events). The owner, an analyst or `AGENT-001` completes it, and nothing is proposed for approval until it is complete. *Event-value analytics, property-based analytics and reporting analytics by the same rule.* event-value analytics event names come from its CSV export or from its API with the buyer's key, and an event whose export carries `_value` totals becomes a revenue goal (`IMPORT-004`). Property-based analytics key events come from the property-based analytics Admin API (`IMPORT-002`). Reporting analytics goals, with their match patterns and revenue, come from the Reporting API's `Goals.getGoals` (`IMPORT-005`).

**Acceptance.**
1. Import a fixture in the aggregate source’s real dashboard-export layout, with no funnel file.
2. Its `conversions.csv` holds `Visit /thanks*`, `Scroll 75% on /blog/**`, a custom event `Signup`, a goal named `Purchase` with counts and no revenue columns, and a goal renamed to `Leads (old)`, and its `custom_props.csv` holds `plan`.
3. Matching accepted live `Signup` and `Purchase` calls establish their event names, and the live `Purchase` carrying USD revenue establishes revenue type and currency.
4. Four goals are proposed with the right type, pattern, threshold and currency (USD, shown for confirmation).
5. `Leads (old)` appears under Needs completion and is not proposed.
6. `plan` is proposed as a property.
7. Against a fixture of the read-only goals endpoint called with a Stats API key, plus a Stats API v2 revenue answer in EUR, the same goals are read directly, `Purchase` carries EUR, and no field is inferred from a name except the scroll threshold.
8. Against a fixture of the same endpoint called with an Enterprise Sites API key, the result is identical.

**Evidence.** `src/vane/movein/plausible-definitions.ts`; `src/vane/movein/plausible-reader.ts`; `src/vane/movein/import-definitions.ts`; `src/vane/views/import-definitions.ts`; `tests/plausible-definitions.test.mjs`; `tests/matomo.test.mjs`
**Gap.** None.

#### IMPORT-012 — Funnels rebuilt in a guided step

Core · target · **done** · From IMPORT-009

**Requirement.** Aggregate website analytics offers funnels on its Business plan but exposes no funnel definition in its export, Stats API or Sites API, so Vane says so on the import screen and offers a guided rebuild. The owner names the funnel and either picks its steps in order from the recovered goals or pastes the step list as shown in the incumbent's funnel settings, and each pasted line is matched to a recovered goal by display name. The rebuilt funnel is a `CONV-005` funnel proposed through `APPROVE-001`. Once approved, it counts live events, and it applies to the imported period only where the imported data supports it, which is labeled. Reporting analytics funnels are rebuilt through the same guided step.

**Acceptance.**
1. Rebuild the funnel `Visit /pricing` → `Signup` → `Purchase` by pasting the three step names, approve it, and replay the live shimmed events from the first `IMPORT-008` fixture.
2. The funnel report counts them at each step.
3. The import screen states that aggregate website analytics exposes no funnel definitions, and no funnel is ever proposed from an export or API read.

**Evidence.** `src/vane/movein/plausible-definitions.ts`; `src/vane/movein/plausible-reader.ts`; `src/vane/movein/import-definitions.ts`; `src/vane/views/import-definitions.ts`; `tests/plausible-definitions.test.mjs`; `tests/matomo.test.mjs`
**Gap.** None.

### Reports, alerts and follow-up

#### REPORT-001 — Scheduled email reports

Core · target · **done** · Cites BASE-OPS-004

**Requirement.** Each team member, or an external recipient the owner adds, can subscribe to daily, weekly or monthly email reports for chosen sites and segments. Reports are sent at a chosen local time in the site's time zone. Each one shows the headline metrics with their comparison, top pages, sources, goals and revenue, the coverage notes and the explanation (`REPORT-003`). Every email has a one-click unsubscribe. A temporary delivery failure is retried 3 times, after 15 minutes, 2 hours and 12 hours, using the same message ID so the report is never sent twice. A permanent bounce is not retried. Either way the failure shows in the app with its reason. A weekly report goes out on the weekday the recipient chooses (Monday by default), and a monthly report on the first day of the month.

**Acceptance.**
1. Subscribe two recipients to the weekly report at 8:00 America/New_York and run the schedule across a daylight-saving change.
2. Each email arrives once at the local hour with figures that match the dashboard, and unsubscribe stops it.
3. With a fake mail provider and clock, fail one delivery temporarily twice: it is retried at 15 minutes and 2 hours and delivered once.
4. Fail another on all four attempts: it shows as failed after the 12-hour retry.
5. A permanent bounce shows in the app at once and is not retried.
6. A weekly report set to Mondays at 8:00 am arrives on Monday at 8:00 local time and on no other day.

**Evidence.** `src/vane/email-reports.ts`; `src/vane/mail-events.ts`; `src/vane/views/report-settings.ts`; `migrations/core/0042_vane_email_reports.sql`; `migrations/core/0045_vane_report_mail_events.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### REPORT-004 — Provider delivery events stop report mail

Core · target · **partial** · From REPORT-001 · Cites BASE-MAIL-001

**Requirement.** A permanent bounce, a spam complaint or a suppression the mail provider reports later, through its signed delivery events, shows on that report send and stops further report email to the address. The send list labels each provider event as the provider's, with its date. The event intake is in `docs/contract/rules.md`.

**Acceptance.**
1. A signed provider event reports a permanent bounce on one delivered report hours later and a spam complaint on another: each shows on its send at once.
2. A wrong signature or another address is refused, and an identical retry changes nothing.
3. The next scheduled sends to both addresses fail unsent with that reason while other recipients keep their reports.

**Evidence.** `src/vane/email-reports.ts`; `src/vane/mail-events.ts`; `src/vane/views/report-settings.ts`; `migrations/core/0042_vane_email_reports.sql`; `migrations/core/0045_vane_report_mail_events.sql`; `tests/vane.test.mjs`
**Gap.** A spam complaint shown on its own send, and that an identical provider-event retry changes nothing, are unasserted: the journey checks only that each of those deliveries answers 200. A bounce shown on its send at once, the refused wrong signature and other address, and the stopped later sends with other recipients kept are asserted.

#### REPORT-002 — Slack, Microsoft Teams and Nook delivery

Core · target · **partial** · Rules D-3

**Requirement.** Reports and alerts can be sent to a Slack channel (Slack app with OAuth), a Microsoft Teams channel (Teams app or workflow webhook) or a [Nook](https://github.com/just-every/run-nook) channel, with a link back to the filtered dashboard.

**Acceptance.**
1. Against fixture endpoints for all three, send a weekly report and an alert.
2. Each payload carries the right figures and a working deep link, and a revoked token surfaces as a delivery failure.

**Evidence.** `src/vane/chat/connections.ts`; `src/vane/chat/delivery.ts`; `src/vane/views/chat-settings.ts`; `migrations/core/0056_vane_chat.sql`; `tests/chat.test.mjs`
**Gap.** Slack OAuth, Teams workflow and Nook NOOK-079 reports/alerts, sealed credentials, filtered links and once-per-period outcomes. Gap: resolved-address/pinned egress (Base egress door), as RL-7 sets for owner-entered endpoints.

#### REPORT-003 — A readable explanation of what changed

Core · target · **done**

**Requirement.** Every report and alert explains its change by its largest contributors: which channels, pages, campaigns, locations or devices moved, and by how much, with denominators. It includes annotations in the window and any coverage change. It labels a change "within normal variation" exactly when the value falls inside the 95% prediction interval of `ALERT-001`'s day-of-week baseline, and it shows that interval. The explanation never claims a cause.

**Acceptance.**
1. Seed a week where organic search falls 40% on one page while other channels are stable.
2. The explanation names that page and channel with its denominators, lists the overlapping annotation, and labels a fluctuation inside the baseline's 95% prediction interval as normal variation and one outside it as not.

**Evidence.** `src/vane/explain.ts`; `src/vane/reports.ts`; `src/vane/views/report.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### ALERT-001 — Traffic spike and drop alerts

Core · target · **done**

**Requirement.** An owner sets an alert on visitors, visits or pageviews for a site or a saved segment (`DASH-007`), which then counts only the segment's visits. It fires on a fixed threshold, or on an anomaly: a value outside the 95% prediction interval of a day-of-week and hour baseline that accounts for US federal holidays and the owner's business calendar. Alerts have quiet hours, a cool-down and a recipients list across email, Slack, Teams, Nook and webhook. A spike alert can also watch current visitors (`DASH-001`) against a fixed threshold. Spike and current-visitor conditions are evaluated at least every 5 minutes, and the alert is sent within 15 minutes of the threshold being crossed. The owner can enter scheduled maintenance windows, one-off or recurring, and an Uptime maintenance window arrives the same way. A drop inside a window is held, not sent, and the held alert is recorded in the alert log and on the chart with its reason. Its baseline is the day-of-week baseline of `REPORT-003`, refined by hour and the owner's business calendar, and the report's normal-variation judgment uses the same refinement. Every alert explains its change as `REPORT-003` does: its largest movers with their totals, the annotations in its window and any coverage change.

**Acceptance.**
1. Seed eight weeks of baseline traffic, then inject a 4× spike, a 70% drop and a Thanksgiving-day dip.
2. The spike and drop alert once each, the holiday dip does not, and the cool-down suppresses a repeat.
3. With a current-visitors threshold of 50 and a fake clock, raise current visitors above 50.
4. The alert is sent within 15 minutes of the crossing, and the recorded crossing and send times show it.
5. Enter a recurring Saturday 2:00–3:00 am maintenance window and inject a 90% drop inside it.
6. No alert is sent, and the alert log shows the drop as held with the reason scheduled maintenance; the same drop at 4:00 am alerts.
7. Each alert's message lists its largest movers with their totals, as the report's explanation does.
8. An alert on a saved `DASH-007` segment counts only that segment's visits.

**Evidence.** `src/vane/traffic-alerts.ts`; `src/vane/alert-baseline.ts`; `src/vane/alert-explain.ts`; `src/vane/annotation-door.ts`; `src/vane/annotations.ts`; `src/vane/explain.ts`; `src/vane/views/alert-settings.ts`; `migrations/core/0046_vane_traffic_alerts.sql`; `migrations/core/0047_vane_alert_anomaly.sql`; `migrations/core/0048_vane_alert_recipients.sql`; `migrations/core/0049_vane_closed_days.sql`; `migrations/core/0050_vane_alert_segments.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### ALERT-002 — Conversion, revenue and tracking-health alerts

Core · target · **partial**

**Requirement.** Alerts also cover a goal or revenue drop and a conversion-rate change. Revenue alerts judge custom-event amounts in the site currency configured at evaluation (retained on each logged crossing), using `CONV-006` dated rates and per-event rounding. A fixed threshold is a major-unit amount with the currency’s minor-unit precision, compared with the last 60 minutes; the usual-range condition uses `ALERT-001`’s hourly baseline. Windows include their start and exclude their end (the fixed window includes the evaluation instant). A window containing an amount without a dated exchange rate is not judged and records an audit diagnostic; it never becomes zero revenue. Tracking-health alerts cover a site with prior traffic that goes silent, a goal that stops firing after a deploy, a surge in collection errors, a collapse in the consent rate, and a divergence between browser-reported and confirmed outcomes (`CONV-008`). Tracking health also covers a page or template that stops sending pageviews while the rest of the site still does. The site overview shows a tracking-health line: how many goals are tracking out of how many, and when the check last ran. The check runs at least daily, at a local time the owner sets (9:00 am by default). Every alert explains its change as `REPORT-003` does: its largest movers with their totals, the annotations in its window and any coverage change.

**Acceptance.**
1. Remove the script from a fixture site, break a goal's event name and block browser purchase events while Stripe confirms orders.
2. Each condition raises its own named alert.
3. Drop the script from `/pricing` only while the other pages keep sending, and a page-silent alert names `/pricing`.
4. With twelve goals that all fire, the overview reads all 12 goals tracking with the time of the last check; break one, and the next check reads 11 of 12 and names the silent goal.
5. Each alert's message lists its largest movers with their totals, as the report's explanation does.

**Evidence.** `src/vane/tracking-health.ts`; `src/vane/traffic-alerts.ts`; `src/vane/alert-baseline.ts`; `src/vane/collect.ts`; `src/vane/views/alert-settings.ts`; `src/vane/views/settings.ts`; `migrations/core/0052_vane_alert_goals.sql`; `migrations/core/0059_vane_alert_currency.sql`; `migrations/core/0062_vane_tracking_health.sql`; `tests/vane.test.mjs`; `tests/revenue-alert.test.mjs`; `tests/tracking-health.test.mjs`
**Gap.** The browser-reported versus confirmed-outcome divergence alert is unasserted; it needs `CONV-008`'s outcome sources (RL-8). The silent site, the goal silent after a deploy, the silent page, separate named alerts, the overview line and the movers are asserted.

#### FOLLOW-001 — Alerts are followed through until a person resolves them

Core · target · **done**

**Requirement.** Each alert opens an item with a responsible person, a next due action and a due time in local business hours. The item can be acknowledged, assigned, commented on and resolved with an outcome: real change, tracking fault fixed, expected, or ignored. Unacknowledged items remind the responsible person on the owner's schedule; escalating to a second person is Oncall's job. Reminders stop when the item is resolved, the metric recovers and a person confirms it, or the owner ends the policy. A delivery or connector failure keeps the item open, and an alert notification alone never closes it.

**Acceptance.**
1. Fire a drop alert and leave it unacknowledged past the reminder time.
2. One reminder arrives.
3. Acknowledge and resolve it as a tracking fault.
4. Reminders stop and the item records who resolved it, when and with what outcome.

**Evidence.** `src/vane/follow-up.ts`; `src/vane/views/follow-settings.ts`; `src/vane/traffic-alerts.ts`; `migrations/core/0051_vane_follow_up.sql`; `tests/vane.test.mjs`
**Gap.** None.

### Sharing, team and data access

#### SHARE-001 — Shared links and embedded dashboards

Core · target · **done** · Cites BASE-PUBLIC-002

**Requirement.** An owner creates read-only shared links to a site or segment, optionally password-protected and with an expiry. Each link is revocable and can hide revenue or chosen reports. A link can be embedded as an iframe with a light or dark theme. Viewers need no account and cannot see settings or other sites.

**Acceptance.**
1. Create a password-protected link that hides revenue, open it signed out and embed it.
2. The figures match the dashboard with no revenue shown, the wrong password is refused, and a revoked link returns 404.

**Evidence.** `src/vane/share.ts`; `src/vane/views/share.ts`; `src/vane/views/share-settings.ts`; `src/vane/actions.ts`; `src/server.ts`; `migrations/core/0036_vane_share_links.sql`; `public/vane.css`; `tests/vane.test.mjs`
**Gap.** None.

#### SHARE-002 — Public dashboards

Core · target · **done** · Cites BASE-PUBLIC-001

**Requirement.** A site can publish a public stats page at a stable URL. The owner chooses which reports appear and whether search engines may index it. No report is chosen by default, so a site has no public page until the owner chooses one; revenue appears only in the revenue report, when the owner chooses it (`CONV-006`).

**Acceptance.**
1. Make a site public with two reports chosen and open its URL signed out.
2. Only those reports appear, and turning it off returns 404.
3. Revenue appears only once the owner adds the revenue report (`CONV-006`).

**Evidence.** `src/vane/public.ts`; `src/vane/public-reports.ts`; `src/vane/views/public.ts`; `src/vane/privacy.ts`; `src/vane/views/settings.ts`; `src/server.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### TEAM-001 — Per-site roles and invitations

Core · target · **done** · Cites BASE-ROLE-001, BASE-ACCESS-004

**Requirement.** People are invited by email to the whole installation or to chosen sites with a role. An Owner controls everything, including billing and erasure. An Admin manages sites and settings. An Analyst creates goals, funnels, segments (`DASH-007`), no-code events (`CONV-009`), reports and alerts. A Viewer reads. Ownership can be transferred, and removal takes effect at once. Every private door also enforces the person's site scope on the server.

**Acceptance.**
1. Invite an analyst to one site and a viewer to two sites.
2. Exercise every action through its public route as each role, including the analyst saving a segment (`DASH-007`) and preparing a no-code event (`CONV-009`): every out-of-role or out-of-scope call is refused, and a transfer of ownership works only with the current owner's confirmation.

**Evidence.** `src/vane/team.ts`; `src/vane/core.ts`; `src/vane/routes.ts`; `src/vane/commands.ts`; `src/vane/views/team.ts`; `migrations/core/0037_vane_team.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### TEAM-002 — Single sign-on through Google and Microsoft

Core · target · **partial** · Cites BASE-SIGNIN-001

**Requirement.** Team members can sign in with Google Workspace or Microsoft Entra ID through OIDC, and owners can require SSO. Provider bindings are installation-owned, SSO is off until the owner turns it on, and the owner's documented break-glass sign-in works during an identity-provider outage (RL-3). SAML and SCIM provisioning are `TEAM-004`; second-step sign-in is `TEAM-003`.

**Acceptance.**
1. Against an OIDC fixture issuer, sign in and enforce SSO.
2. The owner turns SSO on with an audited proof, enforcement covers owners and existing sessions at the next request, and the owner's deployment-issued break-glass link signs in during an identity-provider outage with audit.

**Evidence.** `tests/security.test.mjs` — “organization OIDC signs in Google and Entra members, refuses altered proofs and replay, and fences existing sessions when SSO is required” proves Google/Entra fixture sign-in and SSO enforcement; “SAML fixture signs existing invited accounts into native sessions, enforces signed binding constraints and refuses response replay” proves SAML fixture sign-in and enforced SSO; “SCIM credentials are owner-issued once, hashed, isolated from native and API authority, rotatable and revocable with audit” proves credential custody; “SCIM provisions bound zero-site Viewers without mail or email merges and never grants sites or raises roles” proves immutable federation binding and provisioning scope; “SCIM deactivation ends native and federated sessions, API keys and push tokens on the next request; replays and owner removal never reactivate” proves revocation and replay/order safety; “authenticator sign-in refuses wrong and replayed codes, consumes a recovery code once, and excludes credentials from analytics archives” proves TOTP/recovery and archive exclusion; “owner enforcement holds every account without a factor at enrollment, refuses private mutations and enrolls it before authenticator sign-in” proves owner-proved enrollment and all existing private HTTP and bearer doors. `tests/security-browser.test.mjs` — “members enroll and challenge in a real browser; owner requirements and SAML sign-in render at 1440 and 390” proves sign-in, factor and SCIM-credential screens; “owner outage recovery requires a deployment-issued owner link, preserves the second step and audits one recovery at 1440 and 390” proves audited owner break-glass and its access limits.
**Gap.** Status carried from partial TEAM-002, whose named gap is the real-tenant SCIM run (TEAM-004, R-6); this part is a fresh-judge candidate.

#### TEAM-003 — Two-step sign-in with TOTP or a passkey

Core · target · **partial** · From TEAM-002 · Cites BASE-SIGNIN-002

**Requirement.** Every account can turn on a TOTP or passkey second step, with one-time recovery codes. Owners can require a passkey or TOTP second step for everyone; a member without one is then held at enrollment on their next sign-in and can reach nothing else until they enroll.

**Acceptance.**
1. Turn on TOTP for one member and sign in with a valid code, a wrong code (refused) and a recovery code (accepted once).
2. Then enforce a second step for everyone.
3. A member without one is held at the enrollment page, and every private route refuses them until they enroll, after which they sign in with TOTP.

**Evidence.** `tests/security.test.mjs` — “organization OIDC signs in Google and Entra members, refuses altered proofs and replay, and fences existing sessions when SSO is required” proves Google/Entra fixture sign-in and SSO enforcement; “SAML fixture signs existing invited accounts into native sessions, enforces signed binding constraints and refuses response replay” proves SAML fixture sign-in and enforced SSO; “SCIM credentials are owner-issued once, hashed, isolated from native and API authority, rotatable and revocable with audit” proves credential custody; “SCIM provisions bound zero-site Viewers without mail or email merges and never grants sites or raises roles” proves immutable federation binding and provisioning scope; “SCIM deactivation ends native and federated sessions, API keys and push tokens on the next request; replays and owner removal never reactivate” proves revocation and replay/order safety; “authenticator sign-in refuses wrong and replayed codes, consumes a recovery code once, and excludes credentials from analytics archives” proves TOTP/recovery and archive exclusion; “owner enforcement holds every account without a factor at enrollment, refuses private mutations and enrolls it before authenticator sign-in” proves owner-proved enrollment and all existing private HTTP and bearer doors. `tests/security-browser.test.mjs` — “members enroll and challenge in a real browser; owner requirements and SAML sign-in render at 1440 and 390” proves sign-in, factor and SCIM-credential screens; “owner outage recovery requires a deployment-issued owner link, preserves the second step and audits one recovery at 1440 and 390” proves audited owner break-glass and its access limits.
**Gap.** Status carried from partial TEAM-002, whose named gap is the real-tenant SCIM run (TEAM-004, R-6); this part is a fresh-judge candidate.

#### AGENCY-001 — Agency client workspaces and branded reports

Core · target · **done**

**Requirement.** An agency installation groups sites by client. Client users see only their client's sites, and reports, shared links and emails can carry the agency's or the client's logo, colors and custom domain. The agency sees a cross-client overview. The owner manages client membership, site assignment, branding and public report domains; branding is off by default, and its rules are in `docs/contract/rules.md`.

**Acceptance.**
1. Create two clients, each with a site and a client user.
2. Each client user sees only their own site, the branded weekly email shows the agency logo, and the agency overview lists both.

**Evidence.** `tests/agency.test.mjs` — “AGENCY-001 two clients isolate every site door; agency and client brands reach reports, shared links and weekly mail; custom hosts expose only public reports and unsubscribe” covers both client scopes, current site moves, weekly agency-logo email, private/public/shared branding, colors and custom-host boundaries. “AGENCY-001 owner manages two realistic client workspaces at 1440 and 390; client report uses the uploaded logo without overflow” covers the overview, branding form and rendered reports at both widths. Owner direction 22 Oct 11:07Z approves the landed conservative semantics by default; implementation landed at 643a7598e6604cdc523c7e0536f21aec6f3c4a41 and remains on main 775feef1adc5b4af6d1739946bfa0ad4cdb284d1.
**Gap.** None.

#### API-001 — Stats API

Core · target · **done**

**Requirement.** A documented REST API with an OpenAPI description answers the same metrics, dimensions, filters, segments, comparisons and date ranges as the dashboard. It uses API keys that are scoped to sites, read-only and revocable, and it publishes its rate limits. Answers equal the dashboard's figures. For switchers, an aggregate website analytics Stats API v2-compatible route answers existing aggregate website analytics scripts and dashboards with Vane's figures. A Sites API with provisioning keys lets an agency create sites, goals and shared links from its own tooling.

**Acceptance.**
1. With a scoped key, query visitors by channel with a filter, a saved segment (`DASH-007`) and a comparison; the figures equal the dashboard's.
2. A key for another site, a revoked key and a burst over the rate limit are each refused.
3. A aggregate website analytics v2 query fixture returns the same figures from the compatible route, and a provisioning key creates a site and a goal that then appear in the app.

**Evidence.** `src/vane/api-door.ts`; `src/vane/api-keys.ts`; `src/vane/stats-api.ts`; `src/vane/provisioning.ts`; `src/vane/views/api-keys.ts`; `migrations/core/0038_vane_api_keys.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### API-002 — CSV, Looker Studio and warehouse export

Core · target · **done** · Rules D-3

**Requirement.** Every report table downloads as CSV, and a whole site exports as a ZIP of CSVs in the same layout aggregate website analytics uses. A Looker Studio connector reads the Stats API. A scheduled export of rollups and anonymous events goes to BigQuery, Snowflake, Amazon S3 or Cloudflare R2, with a declared schema.

**Acceptance.**
1. Download a breakdown as CSV and a site ZIP, run the Looker Studio connector against the API, and run a scheduled export to an R2 fixture.
2. Each matches the dashboard and the declared schema.

**Evidence.** `src/vane/csv.ts`; `src/vane/site-zip.ts`; `src/vane/zip.ts`; `src/vane/warehouse.ts`; `src/vane/sealed.ts`; `src/vane/views/export-settings.ts`; `connectors/looker-studio/Code.gs`; `migrations/core/0039_vane_exports.sql`; `tests/apps-script.mjs`; `tests/vane.test.mjs`
**Gap.** None.

#### API-003 — Webhooks for goals, alerts and reports

Core · target · **done** · Cites BASE-OPS-003, BASE-OPS-004 · Rules D-3

**Requirement.** Signed webhooks fire on goal conversions (aggregated per minute, never per person), alerts, follow-up changes and report generation. They are retried with backoff, and their deliveries are visible. They feed [Crank](https://github.com/just-every/run-crank), Zapier and Make.

**Acceptance.**
1. Subscribe a webhook endpoint, fire an alert and a goal burst, and fail the first delivery.
2. Signed payloads arrive once each after the retry, and the delivery log shows the failure and the success.

**Evidence.** `src/vane/webhooks.ts`; `src/vane/views/webhook-settings.ts`; `migrations/core/0041_vane_webhooks.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### API-004 — MCP endpoint for assistants

Core · target · **done** · Cites BASE-AGENT-001

**Requirement.** An authenticated Model Context Protocol endpoint lets Claude, ChatGPT and other assistants query a site's analytics with the same scopes as API keys. A write tool acts only within an agent grant the owner issued (`AGENT-003`).

**Acceptance.**
1. Connect an MCP client with a scoped key and ask for last week's top sources; the result equals the Stats API answer, and a write tool is refused without a grant.

**Evidence.** `src/vane/mcp.ts`; `src/vane/api-door.ts`; `tests/vane.test.mjs`
**Gap.** None.

### Privacy, compliance and administration

#### PRIVACY-001 — Data inventory and privacy-policy text

Core · target · **partial**

**Requirement.** For each site, Vane shows exactly which fields are collected, which are derived and then discarded, the identifier lifetime in each mode, the salt rotation, the retention (30, 90 or 365 days, 13 or 25 months, or unlimited) and the processors (Cloudflare, plus each connected integration). It also generates plain-language privacy-policy text the owner can paste. The text changes when the settings change.

**Acceptance.**
1. Toggle consented mode, automatic events and a Search Console connection.
2. The inventory and the generated text change to match, and the stored data matches the inventory.

**Evidence.** `src/vane/inventory.ts`; `src/vane/views/settings.ts`; `tests/vane.test.mjs`
**Gap.** Toggling consented mode and a Search Console connection is unasserted in the inventory journey; automatic events, site search, kept query parameters, the signal counter, retention, time zone and the stored-column check are asserted.

#### RETENTION-002 — Raw events kept as long as the owner chooses

Core · target · **done** · Cites BASE-DATA-002

**Requirement.** Each site chooses how long its raw pageviews and events are kept: 30, 90 or 365 days, 13 or 25 months, or for as long as the installation exists. Inside the window every accepted pageview and event is kept at full detail, never only as a rollup, and applying retention (`RETENTION-001`) erases only events older than the window. Before the installation's store reaches 80% of its published capacity (`COLLECT-004`), the app warns and names the two choices: a scheduled warehouse export (`API-002`) or a shorter window. Vane never drops or rolls up raw events silently to make room.

**Acceptance.**
1. On a site set to keep events for as long as the installation exists, import 30 months of history, collect today's events and apply retention.
2. Every imported and live event remains, and a raw-event query for the oldest imported day returns its events.
3. Switch the site to 25 months and apply retention: only the events older than 25 months are erased, and one deletion is journaled.
4. Fill a fixture store to 80% of its published capacity: the warning names both choices, and no event is dropped.

**Evidence.** `src/vane/retention.ts`; `src/vane/capacity.ts`; `src/vane/privacy.ts`; `src/vane/actions.ts`; `src/vane/views/store.ts`; `src/vane/views/settings.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### PRIVACY-002 — US state privacy signals honored

Core · target · **done**

**Requirement.** Global Privacy Control and Do Not Track are honored by default, and the owner can see how much traffic sends them. Vane never sells or shares visitor data for cross-context behavioral advertising. Settings and the methodology page record the site's stance under CCPA/CPRA and the other state privacy laws.

**Acceptance.**
1. Load a fixture page with GPC set and with DNT set.
2. Nothing is collected, the signal share is counted in a field-free counter if the owner enables it, and the stance shows on the methodology page.

**Evidence.** `src/vane/tracker.ts`; `src/vane/privacy-signals.ts`; `src/vane/methodology.ts`; `src/vane/views/settings.ts`; `src/vane/views/report.ts`; `migrations/core/0016_vane_signals.sql`; `tests/vane.test.mjs`
**Gap.** None.

#### PRIVACY-003 — Consent managers and regional consent modes

Core · target · **done** · Rules D-1, D-2

**Requirement.** Consent comes from `window.vaneConsent`, Google Consent Mode v2 signals, or a ready adapter for OneTrust, Cookiebot, Termly, Osano, Iubenda and CookieYes. A site can require consent only for chosen regions (for example the EU, the UK and California) and stay cookie-free elsewhere. Consented mode (`METRIC-005`) runs only after consent.

**Acceptance.**
1. With each adapter on a fixture page, deny and then grant consent from a California, a German and a Texas location.
2. Collection follows each region's rule.

**Evidence.** `src/vane/consent.ts`; `src/vane/tracker.ts`; `src/vane/collect.ts`; `src/vane/views/settings.ts`; `src/vane/privacy.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### PRIVACY-005 — Visitor data stays in the owner's installation

Core · target · **done** · Cites BASE-DATA-004, BASE-DATA-005

**Requirement.** Visitor events go only from the visitor's browser to the installation's own Worker, or to the owner's own proxy (`INSTALL-006`), and are stored only in the installation's own database. The script loads nothing from any other host and sends nothing to one. Collection, reports, imports and exports make no outbound request except to an integration the owner has connected, each declared in `docs/contract/data-flows.md` and in `seed.json`, and no integration ever receives a visitor-level record. Verify installation (`INSTALL-001`) and the call-site scan (`IMPORT-011`) are the two owner-started fetches of the owner's own site, with the boundaries in `docs/contract/data-flows.md`.

**Acceptance.**
1. In a browser, load a fixture page with `vane.js` and record every request: only the installation's origin receives one.
2. With every outbound request from the Worker refused and recorded, collect events, read every report, apply an import and download the archive.
3. Each succeeds, and the record holds no outbound request.
4. `seed.json` lists Cloudflare as the only required external; every other entry is an integration an owner connects.

**Evidence.** `src/vane/cutover/scan.ts`; `tests/sitemap-scan.test.mjs`; `src/vane/tracker.ts`; `src/vane/collect.ts`; `seed.json`; `tests/harness.mjs`; `tests/vane.test.mjs`
**Gap.** None.

#### AUDIT-001 — Durable audit of settings, data and agent actions

Core · target · **done** · Cites BASE-OPS-005, BASE-AUDIT-001

**Requirement.** An audit history records every proposal and approval, setting change, import and undo, export, restore, erasure, retention run, shared-link and API-key change, sign-in and agent action, with the actor, time and subject. It covers every action that exists: an agent action is any proposal prepared through the agent command API (`agent.prepare`), and a sign-in is recorded on every new session. The history is portable in the archive. Shared-link and API-key changes are audited as `SHARE-001` and `API-001` set out.

**Acceptance.**
1. Perform each audited action that exists, including an `agent.prepare` proposal and a sign-in that opens a new session, and read the audit view and export.
2. Each entry is present with its actor, time and subject, and erasing a site's history leaves the audit entries without the erased data.

**Evidence.** `migrations/core/0017_vane_audit.sql`; `src/vane/audit.ts`; `src/vane/commands.ts`; `src/vane/views/audit.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### SITE-001 — Site management

Core · target · **done** · Cites BASE-DATA-003

**Requirement.** Owners and admins add sites and, through `APPROVE-001`, change a site's name, origins (including extra allowed hostnames and subdomains), time zone, currency, retention and collection options. They can also transfer a site between installations by archive, and delete a site together with its history (`ERASURE-001`). Extra allowed origins are exact origins, up to 10 besides the website origin (each subdomain is listed), and events from any of them count for the site. The currency is an ISO 4217 code, USD by default. Deletion is prepared and approved like any change: it erases the site's history as history erasure does, then removes the site with its counters and salts; the audit entries and the deletion journal keep only its ID, and an archive made before the deletion cannot bring the site back into that installation. Like every export (`ACCESS-001`), a site archive is downloaded and added only by the owner; admins prepare deletion for the owner to approve. The archive carries the site's settings, events, privacy-signal counts, automatic events, deletion journal and imported rows, and it is added only to an installation where neither that site nor its origin exists. The site keeps its ID, so its script tag keeps working, and imported rows arrive settled: their import journal and undo stay in the source installation's archive (`ARCHIVE-001`). Daily salts never leave an installation, so a visitor seen on both sides of a transfer on the same day counts once in each.

**Acceptance.**
1. Add a site with a `www` and an apex hostname, change its time zone and currency through approval, and delete it.
2. Events from both hostnames count, and deletion leaves no history.

**Evidence.** `src/vane/commands.ts`; `src/vane/privacy.ts`; `src/vane/transfer.ts`; `tests/vane.test.mjs`
**Gap.** None.

#### HOST-001 — Owner-run hosting with measured cost

Core · target · **partial** · Cites BASE-INSTALL-001 · Register R-1

**Requirement.** Vane runs in the buyer's own Cloudflare account with one `rer deploy`. It has no third-party analytics processor and nothing for the owner to patch: no virtual machine, PHP runtime or MySQL database. The deployment is one Worker and its declared Cloudflare bindings (`deploy.json`). The Cloudflare plan the buyer needs is stated before setup. Workers Free suits a trial or a small site, but its daily request limit (100,000 Worker requests a day) is far below the `COLLECT-004` volume, so an installation whose collection, engagement and dashboard requests exceed it needs Workers Paid. The setup screen and cost panel name the plan the measured request volume needs, and Vane warns at 80% of the Free daily limit. The app shows the measured monthly cost in USD at the installation's volume, and the documentation publishes the cost per 100,000 pageviews from a measured run.

**Acceptance.**
1. Deploy to a Cloudflare test account, run a deployed native load of 1,000,000 pageviews and read the cost panel.
2. The stated cost per 100,000 pageviews matches the measured account usage within 10%, and the deployed resources are exactly the Worker and the bindings `deploy.json` declares.
3. The cost panel names Workers Paid as the plan for the load-test volume.
4. On a Workers Free fixture account, traffic at 80% of the daily request limit raises the plan warning.

**Evidence.** `deploy.json`; `wrangler.jsonc`; `rer-setup.json`; `README.md`; `src/vane/hosting.ts`; `src/vane/hosting-cost.ts`; `src/vane/views/hosting.ts`; `docs/hosting-cost.md`; `tests/host-cloudflare-cost.journey.mjs`; `tests/host-cloudflare-usage.mjs`; `tests/vane-report-settings.mjs` — “HOST-001 a deployed Vane Worker under real native load costs what the panel states, within 10% of Cloudflare's own account usage” in `tests/host-cloudflare-cost.journey.mjs` is the held-account sandbox proof (receipt: verification run on 6e3124d34ceaa082d70db9285be6555ef33b825c, 26 October 2026, CLOUDFLARE_VANE_TEST_TOKEN through the injector, exit 0, kept with the campaign). It deploys with public rer deploy into the RunEditRun test account, loads 1,000,000 genuine pageviews through the COLLECT-004 native batch door and reads Cloudflare's own Worker and D1 analytics: usage cost per 100,000 pageviews USD 0.804 measured against 0.803 stated, and monthly cost at 10,000,000 pageviews USD 34.43 against 34.32, each asserted within 10%; the deployed panel names Workers Paid; the account inventory gained exactly one Worker and one D1 database, the Worker's bindings equal `deploy.json` plus the four rer kit bindings, and the inventory is identical after removal. `tests/vane-report-settings.mjs` — “HOST-001 real collection measures requests, D1 work and storage before projecting hosting cost” proves real native admissions, owner-only projection, the Workers Paid notice, the Free fixture warning at 80%, missing and stale input honesty, the plan notice in the setup questions read through rer's own manifest reader, and the 1440 and 390 cost panels.
**Gap.** `deploy.json` does not declare the four bindings the rer deploy kit adds (`ASSETS`, `RER_VERSION`, `RER_DEPLOY_FINGERPRINT`, `RER_DEPLOY_SOURCE`), so the deployed bindings are not exactly the declared ones; the 1,000,000-pageview deployed cost within 10%, the plan and the Free warning are asserted.

#### HOST-002 — Runs on the owner's own computer

Core · target · **done** · Cites BASE-INSTALL-001

**Requirement.** One command, `npx -y @runeditrun/rer dev just-every/run-vane` (or `rer dev` in a checkout), clones, installs and starts the complete Vane on the owner's own macOS, Linux or Windows (WSL2) computer. Collection, dashboards, imports and the archive all work there, with the data in a local D1 database inside the checkout. After installation it needs no Cloudflare account and no outside service; sign-in mail goes to the local outbox. Moving a local installation to the owner's Cloudflare account, history included, is `HOST-003`.

**Acceptance.**
1. From an empty folder, run the one-line command until it reports the app ready and prints its sign-in link.
2. Open the link, add a site, load a fixture page that carries the site's script and see the pageview in the report.
3. Repeat the journey with network access cut off after installation, and it still passes.

**Evidence.** `tests/host-local.journey.mjs` — “HOST-002 installed journey: empty-folder command, sign-in, real tracker, durable report and network-cut replay”, Local installation journey workflow 40050422780 on bdbcf6377f3a8c04f58b671fb01c321749dfd6a2, passed 24 October 2026. It proves the empty-folder public installation reaches readiness and sign-in, an owner-approved site and real fixture tracker show one pageview at 1440 and 390, the report survives a stopped and restarted installation, and the same installed checkout repeats sign-in, site approval, real collection and both report widths after external networking is cut. `tests/host-offline-replay.mjs` proves only loopback exists, no external route exists and an actual external connection fails before restarting through rer dev. The separate “HOST-002 network-denied runtime collects through the tracker and preserves reports, import and archive restore” in `tests/host-local.journey.mjs` covers offline import and archive lifecycle. `.github/workflows/host-local.yml` runs both local journeys nightly in job host-local at 18:17 UTC; `docs/hosting-cost.md`.
**Gap.** None.

#### HOST-003 — Local installation moves to the owner's Cloudflare account

Core · target · **done** · Cites BASE-DATA-001, BASE-INSTALL-001

**Requirement.** A local installation moves to the owner's Cloudflare account (`HOST-001`) with `rer export` and `rer import`, history included.

**Acceptance.**
1. The installation is a local (`HOST-002`) installation whose report shows a fixture pageview.
2. Export the installation, import it into a fresh Cloudflare test deployment, and the same pageview is in the report there.

**Evidence.** “HOST-003 local rer archive restores the same fixture pageview into a fresh Cloudflare deployment” in `tests/host-cloudflare.journey.mjs`, with `tests/host-transfer-source.mjs`, proves empty-folder local installation, the real tracker pageview, public rer export, public rer import with --target remote, fresh hosted deployment, normal owner sign-in and first-run confirmation, the same /subscriptions pageview at 1440 and 390, missing-authority refusal and occupied-destination refusal. [Cloudflare installation transfer run 40185411652](https://github.com/just-every/run-vane/actions/runs/40185411652) passed on fdbb065e3796dea09720cdf306e375f3ecefe69b on 25 October 2026, with one test passed, zero failures and zero skips. `tests/host-cloudflare-cleanup.mjs` runs ownership-checked removal from the finally path and independently lists the account after removal; the [retained receipt and screenshots](https://github.com/just-every/run-vane/actions/runs/40185411652/artifacts/12595818007) record transfer and cleanup passed, 242 remaining Workers and 78 remaining D1 databases, with this run Worker and D1 absent. `.github/workflows/host-cloudflare.yml` runs job host-cloudflare every Sunday at 19:37 UTC and by manual dispatch, using the two mandatory RunEditRun Actions secrets. Both absent-secret cases fail before installation without skipping. One-off network-edge failure proof verifies both inventory reads still run after an ownership-read failure; a 120-Worker response and two D1 pages prove complete inventory traversal. `docs/hosting-cost.md`.
**Gap.** None.

#### OPEN-001 — Free and open source under the MIT license

Core · target · **partial** · Cites BASE-DATA-005

**Requirement.** Vane's complete source is published at https://github.com/just-every/run-vane under the MIT license. Every capability in this contract ships in that source. Vane has no paid tier, feature gate or seat limit, and nothing in it bills or meters use. The only running cost is the buyer's own Cloudflare usage, which `HOST-001` measures and shows.

**Acceptance.**
1. `LICENSE` holds the MIT license text and `package.json` declares `MIT`.
2. A scan of `src/` finds no payment-provider call, plan gate or usage meter, and the product tests pass on a fresh clone with no key or account other than the owner's own.

**Evidence.** `LICENSE`; `package.json`; `tests/host-local.journey.mjs` — “HOST-002 installed journey: empty-folder command, sign-in, real tracker, durable report and network-cut replay” proves complete-source installation and analytics without a vendor credential; `tests/vane.test.mjs` and `.github/workflows/verify.yml` prove fresh-checkout product tests with no vendor key or account.
**Gap.** No test asserts the licence text, the package licence field or the absence of payment calls, plan gates and meters in `src/`; fresh-checkout product tests pass in Verify and the installed journey.

#### DEMO-001 — Try Vane on realistic data

Core · target · **done**

**Requirement.** `rer demo` and the hosted demo open a signed-in Vane with three example sites, two weeks of traffic, goals and a pending change to review. The demo writes no real installation data and never fetches.

**Acceptance.**
1. Start `rer demo`, open each example site and approve the pending change.
2. Stop the demo; its data is removed.

**Evidence.** `src/demo.ts`; `DEMO.md`; `tests/demo.journey.mjs`; `.github/workflows/verify.yml` (its demo job)
**Gap.** None.

#### MOBILE-001 — Phone-ready, accessible dashboard

Core · target · **done** · Cites BASE-ACCESSIBILITY-001 · Register R-8, R-9

**Requirement.** Every dashboard, report, settings page and approval works at 390 px wide without horizontal scrolling, and every chart has a data table. The app can be installed as a PWA that receives web-push alerts.

**Acceptance.**
1. At 390 and 1440 px, complete the site, report, filter, approval and alert journeys by keyboard with an automated accessibility scan clean.
2. Install the PWA and receive a push alert.

**Evidence.** `src/vane/views/shell.ts`; `src/vane/views/html.ts`; `src/vane/views/settings.ts`; `public/vane.css`; `src/vane/push.ts`; `src/vane/views/push.ts`; `src/vane/traffic-alerts.ts`; `src/vane/views/alert-settings.ts`; `public/manifest.webmanifest`; `public/vane-sw.js`; `tests/vane.test.mjs`
**Gap.** None.

### Push further with agents

#### AGENT-001 — Maintain trustworthy instrumentation

Core · push-further · **partial** · Rules D-3

**Requirement.** The agent compares the declared goals, events and funnels with what actually arrives. It also reads the site's pages (by crawling the sitemap), deploy diffs from a connected GitHub repository or Pane, the consent state, and server-side counts from Stripe, Shopify or the CRM (`CONV-008`). It finds missing, duplicated, misnamed and newly broken events, pages without the script, and funnels whose steps no longer exist. For each problem it drafts a fix: a pull request to the site repository, a GTM template change, a Pane setting or a no-code event (`CONV-009`). After the fix ships it verifies the real payload. Each fix carries the class of its change (a pull request is external, a no-code event or setting is live), and the company's policy decides whether it runs alone or waits for a person; the agent never widens the collected fields. GitHub access is off until the owner connects one mapped repository with audited consent, through a credential limited to contents and pull requests on it; the agent opens one pull request per fix on a Vane branch and never merges, deploys or updates the base branch (RL-4).

**Acceptance.**
1. Deploy a fixture site change that renames the signup button and drops the script from one template.
2. The agent reports both with evidence and drafts a PR and a no-code event.
3. Under the held policy, after the owner approves and the change deploys, the agent confirms the events arrive again and annotates the fix.

**Evidence.** `tests/instrumentation.test.mjs`; `docs/instrumentation.md`
**Gap.** PARTIAL until a real GitHub receipt. The fixture edge proves fixed-host mapped-file comparisons, a mapped script-only HTML draft PR after exact-diff-hash approval and separate confirmation, with sensitive/operational path and classic-token refusals, source drift refusal, read-only response-loss reconciliation and sealed/revocable credential custody. Native script tags and declared selectors are inspected statically; execution, consent and blockers remain unmeasured. Only word-ID/tag/ordinal structural rename candidates are drafted. Pane deploy-diff connections, automatic edits for source languages other than mapped HTML, GTM/Pane hand-off (INSTALL-005/AGENT-003), and server-confirmed outcome reconciliation (CONV-008) are absent. This is account-free foundation, not the complete agent; no DONE claim.

#### AGENT-002 — Explain why traffic or conversions moved

Core · push-further · **partial**

**Requirement.** When numbers change, the agent separates four causes. Tracking coverage covers event volume against confirmed outcomes, consent rate, script errors and blockers. Channel mix covers the contributions by source, campaign and search query (`SEARCH-001`). Page behavior covers funnel steps, page speed (`PERF-001`) and errors from Spool. External events cover Uptime incidents, Mango sends, ad-spend changes, seasonality and US holidays. It returns ranked hypotheses, each with denominators, linked evidence, its confidence and the observation that would disprove it. Missing coverage is stated as missing, never as a cause, and the agent never claims causality from a correlation. Its explanations list the annotations in their window (`DASH-009`). Investigations are owner-started and run on this installation's own figures; sender-reported outside aggregates are off until the owner issues a site-scoped sender credential, and they are labelled sender-reported in every explanation (RL-5).

**Acceptance.**
1. Seed three fixture weeks: a tracking break, an organic ranking drop, and a real checkout failure that confirmed orders corroborate.
2. For each, the agent ranks the true cause first with cited evidence and names what is unknown.
3. Each explanation lists the annotations dated in its window.

**Evidence.** `tests/movement.test.mjs`; `docs/movement.md`
**Gap.** PARTIAL until real sender integrations exist. External aggregates authenticate the owner-selected sender, not a real Stripe/Shopify/CRM, Spool or Uptime provider; CONV-008 reconciliation and independently verified confirmed orders are absent. Blocker share, browser script errors, unpreserved historical consent settings, numeric Mango sends/ad-spend (ADS-001) and established seasonality remain unknown. No complete-agent or causality claim.

#### AGENT-003 — Propose and ship a site or campaign change under granted authority

Core · push-further · **partial**

**Requirement.** From an explanation or an opportunity (`AGENT-006`), the agent drafts a concrete change. The change can be page copy, a call to action, a title and meta description, a broken link or a form fix, a UTM correction, or a campaign budget or schedule change. It states the expected effect, its guardrail metrics and how it will be measured (`AGENT-004`). The agent ships only through grants the owner has given: a Pane page edit, a pull request to the site's GitHub repository, a Webflow CMS item, a Mango campaign draft, or an ad-platform change. A spend change carries the money class and a copy change the live class (with external when it is published), and the company's policy decides each; every grant can be revoked. A 404 path that gets visits (`CONV-003`), such as a mistyped `/pricng`, gets a drafted redirect to the page it most likely meant. Every change the agent ships is added as a dated annotation on the charts (`DASH-009`). Local drafts that create no outbound deployment or campaign authority need no grant; shipping needs a current grant for that exact destination and action, checked for revocation before the effect (RL-101).

**Acceptance.**
1. Grant Pane page-edit and GitHub PR access but no ad access.
2. Under the held policy the agent ships an approved CTA change in Pane and opens a PR for a title change.
3. Under the held policy its proposed budget change waits for approval, and without the ad grant it cannot ship under either policy, and revoking the Pane grant blocks the next edit.
4. From a 404 report where `/pricng` has 37 visits, the agent drafts a redirect to `/pricing` and opens it as a PR under the GitHub grant.
5. Once it is merged and deployed, the next visit to `/pricng` lands on `/pricing`, and the path's 404 count stops growing.
6. The shipped CTA change appears as an annotation on its day.

**Evidence.** `tests/agent-work.test.mjs`; `docs/agents.md`
**Gap.** Local drafts record the expected effect, guardrail and measurement; no shipping destination is built yet, and the instrumentation GitHub authority (RL-4) is not widened. External dependency: Pane page-edit capability is unavailable. General title and redirect PRs, grant lifecycle, deployed redirect proof and shipped-change annotation remain unbuilt.

#### AGENT-004 — Measure the result against coverage gaps

Core · push-further · **partial**

**Requirement.** For every shipped change, the agent runs an experiment (`EXPERIMENT-001`) where it can, or a before-and-after comparison with matched weekdays and guardrails where it cannot. It reports the measured effect with an interval, whether coverage changed in the window, and a verdict: measured improvement, no detectable change, worse, or inconclusive because of coverage or sample size. It recommends keeping or reverting the change, and a revert runs only under a current grant for that destination and carries the live class, which the company's policy decides. A result states its comparison and experiment intervals with their coverage and sample limits, and an observed coverage change withholds a positive verdict (RL-102).

**Acceptance.**
1. Ship two fixture changes: one with a real lift under an experiment, and one before-and-after change during a consent-rate drop.
2. The first is reported as a measured improvement with its interval, the second as inconclusive because of coverage, and under the held policy an approved revert restores the prior page.

**Evidence.** `tests/agent-work.test.mjs`; `docs/agents.md`
**Gap.** A result endpoint requires a verified deployed instrumentation fix, matched weekdays and existing experiment intervals, and withholds positive verdicts for observed coverage changes. Only draft-as-shipped refusal is asserted so far; positive lift, consent-drop assessment and approved page revert acceptance remain unproved. Pane revert depends on the unavailable Pane edit capability.

#### AGENT-005 — Pursue anomalies to resolution

Core · push-further · **partial**

**Requirement.** On an alert (`ALERT-001`, `ALERT-002`), the agent investigates with `AGENT-002` first and attaches its findings to the follow-up item (`FOLLOW-001`). It contacts the responsible person only when a decision or an outside fix is needed, for example a developer for a broken event or the marketer for a paused campaign, on the owner's channels and schedule. It keeps the item open until it is resolved, and it closes it on a verified recovery with coverage intact or when a person confirms the outcome; traffic reduction alone never proves a repair. A new outside contact uses the audience and cadence the owner configured (RL-103).

**Acceptance.**
1. Fire a silent-site alert caused by a deploy.
2. The agent attaches its evidence, messages the configured developer once, reminds them after the due time, and after the fix verifies events and closes the item with that evidence.
3. A real traffic dip with no fault is closed as expected after the owner confirms.

**Evidence.** `tests/agent-work.test.mjs`; `docs/agents.md`
**Gap.** An owner-requested pursuit runs the movement investigation first and attaches its evidence to the existing follow-up item, which stays open; outside contact and closure on a verified recovery are unbuilt. Silent-deploy investigation, one configured developer contact, due reminder and verified event recovery with intact coverage remain unproved.

#### AGENT-006 — Weekly growth brief with opportunities

Core · push-further · **done**

**Requirement.** Each week the agent writes a brief of three to five opportunities, each with figures. Examples are pages with high entry and high exit, campaigns that convert above the site's average, Search Console queries ranking 4 to 20 with high impressions, slow pages that convert below their peers, and stalled funnel steps. It links each one to a drafted `AGENT-003` change. The owner can dismiss an opportunity type, and the agent stops raising it. Linked changes stay drafts until `AGENT-003` ships them.

**Acceptance.**
1. On a fixture site with seeded opportunities, the brief names each with correct figures and a linked draft.
2. A dismissed type does not return the next week.

**Evidence.** `tests/agent-work.test.mjs` — “Weekly local opportunities cite exact native figures and linked drafts and suppress dismissed types next week”; “Scheduled ended-week briefs review all five opportunity types with exact figures and suppress dismissed types in saved briefs and next week” proves cron production, all five types and exact figures, working local draft links, repeat idempotence, immediate dismissal in saved brief reads and Settings with recalculated shortfall, preserved historical evidence and drafts, next-week suppression and all-type review at 1440 and 390. `docs/agents.md`.  CT judged DONE-JUSTIFIED on 25 October 2026 at e905c013f97d392a9e4689de679c5c52db8a6215. `tests/agent-work.test.mjs`, lines 60–100, proves both acceptance sentences with owner-only local drafts and no new outbound authority; shipping remains AGENT-003.
**Gap.** None.

#### AGENT-007 — Answer questions in plain English in the app and MCP, with the query shown

Core · push-further · **done**

**Requirement.** In the app and through MCP, a team member asks a question such as "Which campaigns brought paying customers from Texas last month?". The answer comes back as a chart, the figures, and the exact filters, metrics and range used. The figures equal what the dashboard shows for that query. Ambiguous questions get a clarifying choice, and questions the data cannot answer (people, causes, data outside coverage) say so. Questions are off until the owner turns them on for a site; only the question and Vane's own vocabulary go to the deployment's model provider, Vane validates and runs the resulting Stats API query itself, and it stores no question or answer (RL-6). Slack and Teams questions are `AGENT-008`.

**Acceptance.**
1. Ask ten fixture questions, including an ambiguous one and an unanswerable one.
2. Every numeric answer equals the Stats API result for the shown query, the ambiguous question gets a choice and the unanswerable one says why.

**Evidence.** `tests/ask.test.mjs` — “AGENT-007 ten fixture questions answer with the shown Stats API query, a clarifying choice and honest refusals, and the model sees only the question and the vocabulary” covers ten questions, numeric equality with Stats API results; choice and refusal paths, question-only egress, no stored text and chart/table pages at 1440/390; “AGENT-007 questions are off until the owner enables them, owner-only to change, scoped, limited, and a bad model reply runs nothing” covers audited owner-only enablement, app/MCP scope and site switch, all refusal attempts in the shared budget, and no repair. `tests/ask-journey.mjs` — real-model sandbox passed 2026-10-22T22:50:41.860Z on c0271cc7262225ab077ea7e8387ed47eeed89d96 through deployment Base ai with gpt-4.1: seven numeric answers independently equal the shown Stats API result; one clarifying choice runs without a further model call; people and causes are refused; exactly ten provider calls and text-free audit custody pass.
**Gap.** None.

#### AGENT-008 — Questions from Slack and Teams

Core · push-further · **missing** · From AGENT-007

**Requirement.** The same plain-English questions work from Slack and Microsoft Teams, under the same per-site switch, provider rules and hourly budget as the app and MCP, with the answer's figures and its exact query.

**Acceptance.**
1. From a Slack and a Teams fixture, ask ten fixture questions, including an ambiguous one and an unanswerable one.
2. Every numeric answer equals the Stats API result for the shown query, the ambiguous question gets a choice and the unanswerable one says why.

**Evidence.** None.
**Gap.** No Slack or Teams question door exists; the old AGENT-007 gap named them as future.

## Agent surface

### Agent surface

#### SURFACE-001 — The registry equals this table and the Base harness passes

Agent surface · target · **missing** · From new · Cites BASE-AGENT-001, BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-013

**Requirement.** Vane serves the Base MCP door at `/mcp` with the tools, resources, events and prompts in this section, each tool calling the same server action as the analytics UI. The tools of the existing MCP endpoint (`API-004`) move onto that door under their table names.

**Acceptance.**
1. `tools/list` names exactly the tools in the table, each with its declared classes in `_meta`, and their Core clause ids plus the not-a-tool reasons cover every Core clause.
2. The Base conformance harness runs BASE-AGENT-001 to BASE-AGENT-013 on Vane's seeded sites under the all-autonomous and the held policies, and passes.
3. On the shared fixture, each tool and its UI action give the same record state and audit event type.
4. `resources/templates/list` names the resources above, and a site read as a Viewer returns exactly the figures and settings the Viewer sees in the UI.
5. The existing `list_sites`, `query_stats`, `add_annotation` and `ask_question` tools answer at `/mcp` under their table names, and the old path stays an alias.
6. `/docs/agents` lists every tool, class, resource, event type and prompt in this section.

**Evidence.** None.
**Gap.** No Base MCP door, class declarations or harness run; four tools answer today at `/api/v1/mcp` (`API-004`).

#### SURFACE-002 — Sharing and outside delivery carry external with their counterparty

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006

**Requirement.** Every call that exposes figures outside the business carries the external class, with facts the server computes from the recipients, the link and the site's team.

**Acceptance.**
1. A shared link or a public stats page carries external with counterparty public and the reports it exposes.
2. A report or alert to a team member's address is standard; to an outside address it carries external with counterparty new, and to an owner-connected chat destination external with counterparty known, each with its recipient count.
3. Adding a webhook endpoint or scheduling a warehouse export carries external with the destination host as its counterparty.
4. An argument or record text claiming a recipient is internal leaves the computed class and facts unchanged.

**Evidence.** None.
**Gap.** No class declarations or classifier.

#### SURFACE-003 — Collection settings and shipped site changes carry live

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006

**Requirement.** Every call that changes what the running script or collection does for a site's visitors, or what the site itself serves, carries the live class with the site and the setting as facts.

**Acceptance.**
1. Changing consent mode or regions, collection paths, exclusions, script options, no-code events, split tests or incumbent compatibility carries live with the site and setting; changing only goals, funnels or source rules is standard.
2. Connecting, rotating or revoking the first-party proxy route carries live · security.
3. Shipping a page, title, redirect or campaign change through a grant carries live, adds external when it publishes outside the business, and adds money with the amount in USD when it changes spend.

**Evidence.** None.
**Gap.** No class declarations or classifier.

#### SURFACE-004 — Access, security and destructive calls

Agent surface · target · **missing** · From new · Cites BASE-AGENT-005, BASE-AGENT-006

**Requirement.** Team, key and grant changes carry access, sign-in and credential changes carry security, and history erasure carries destructive, each with facts the server computes.

**Acceptance.**
1. Inviting, changing, removing or transferring a person, a client membership, a key or an agent grant carries access with the people count and whether it widens or narrows.
2. SSO, second-step, SCIM, events-token and key-secret changes carry security.
3. Erasing a site's history, applying a retention window and deleting a site carry destructive with the event count.
4. An agent call that widens its own grant or its sponsor's role returns `self_escalation` and changes nothing.

**Evidence.** None.
**Gap.** No class declarations or classifier.

#### SURFACE-005 — Provider consent screens are gated

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006, BASE-AGENT-008

**Requirement.** Connecting a provider whose consent screen sits in a person's own account is gated, so the step goes to that person before the call runs.

**Acceptance.**
1. Connecting Search Console, property-based analytics or Slack carries gated with the provider and its consent step, and returns that step for the named person; no agent call completes it.
2. A connection made with a pasted key (Bing, reporting analytics, Teams or Nook) carries security, not gated.

**Evidence.** None.
**Gap.** No class declarations or classifier.

#### SURFACE-006 — Policy setup, Pause and the Agents page

Agent surface · target · **missing** · From new · Cites BASE-AGENT-007, BASE-AGENT-009, BASE-AGENT-011

**Requirement.** The company answers every class Vane uses before agents act, Pause stops them, and every agent call is audited with its classes and decision.

**Acceptance.**
1. Before setup is answered, an agent call returns `policy_unset` with the setup link, and setup lists every class Vane uses with no answer pre-selected.
2. Pause agents stops the next Vane call within 60 seconds.
3. The Agents page's counts by class and decision equal the audit rows for the seeded week.

**Evidence.** None.
**Gap.** No policy evaluator, setup questions or Agents page.

#### SURFACE-007 — An analytics week under two company policies

Agent surface · target · **missing** · From new · Cites BASE-AGENT-013

**Requirement.** A stranger agent runs a seeded analytics week through MCP alone, for a named sponsor with the Admin role, under two company policies.

**Acceptance.**
1. Given only the seed URL, the agent connects through MCP for the sponsor and lists the analytics tools.
2. Under the all-autonomous policy it explains a traffic drop, repairs a broken goal with a no-code event, shares a weekly link with a client and sets a spike alert with no person involved: nothing waits for approval, nothing is refused by policy and the review feed is empty.
3. Under the held policy (standard reviewed, every other class approved by the test person), the same week waits at the live, external and access calls, and each runs once approved.
4. Under the held policy with external blocked, the share returns `policy_blocked` and the rest of the week completes.
5. In both runs every agent act reads "<agent> for <person>" in the audit and the activity view, and each approval names the test person.

**Evidence.** None.
**Gap.** No Base MCP door, policy or harness run.

## Later

### Dashboards and analysis

#### DASH-015 — US metro areas by code

Later · target · **done** · From DASH-005 · Rules D-1

**Requirement.** A US page load stores its Nielsen DMA® metro code from Cloudflare, never a name. Vane ships no code-to-name table (RL-1): an unnamed code shows "Metro NNN (unnamed)" with the place most of its visitors came from, for display only. US metro areas have the columns, selected-goal figures, comparisons, filters, movers, live list and exports of the other location tables, and public pages fold small metros.

**Acceptance.**
1. Code 635 shows unnamed with Austin, Texas as its place.
2. CSV, the ZIP metros file, the warehouse export, the Stats API and MCP give an empty name and the dashboard's figures.
3. The saved filter, the mover and the live list key on the code.
4. A US load without a valid code counts as Unknown metro area, non-US loads are absent, and loads without geolocation stay Unknown location.
5. On shared and public pages the place shows, a 3-visitor metro folds into Other metro areas, a metro whose leading city is under 5 visitors names only its region, and nothing shows without the chosen report.

**Evidence.** `src/vane/locations.ts`; `src/vane/metro-names.ts`; `src/vane/collect.ts`; `src/vane/reports.ts`; `src/vane/realtime.ts`; `src/vane/segments.ts`; `src/vane/views/locations.ts`; `src/vane/views/metro-names.ts`; `src/vane/views/public.ts`; `migrations/core/0061_vane_metro_names.sql`; `tests/locations.journey.mjs`; `tests/vane.test.mjs`
**Gap.** None.

#### DASH-016 — Owner-supplied metro names

Later · target · **done** · From DASH-005 · Cites BASE-INPUT-003

**Requirement.** The site's owner or an administrator uploads the site's own metro-name table, a site setting holding no visitor data, and only the owner approves it (`APPROVE-001`). Approved names replace the unnamed labels on every signed-in surface, export and API answer, and on public pages only when the owner also approves public names, with a footnote naming their source. The table travels with the archive, restore and site transfer and survives erasure. The upload limits are in `docs/contract/rules.md`.

**Acceptance.**
1. An administrator uploads a table and it waits; after the owner approves, the name appears on every signed-in surface, export and API answer.
2. On public pages the name appears only after public names are approved, with the footnote; the audit records it and event rows are unchanged.
3. Uploads by a Viewer, an Analyst, a Stats API or provisioning key or from a web address, an upload through the command API, which offers no metro-name command, and approval by an administrator, are each refused with nothing changed.
4. Codes 63, 6355 and 6a5, a duplicate code, empty, overlong and formula-leading names, a control character, wrong, extra or missing columns, files over 1,000 rows or 256 KB and a missing label or statement are each refused with nothing changed.
5. Clearing reverts to unnamed, erasure leaves the table, and the archive, restore and a site transfer keep the names.

**Evidence.** `src/vane/locations.ts`; `src/vane/metro-names.ts`; `src/vane/collect.ts`; `src/vane/reports.ts`; `src/vane/realtime.ts`; `src/vane/segments.ts`; `src/vane/views/locations.ts`; `src/vane/views/metro-names.ts`; `src/vane/views/public.ts`; `migrations/core/0061_vane_metro_names.sql`; `tests/locations.journey.mjs`; `tests/vane.test.mjs`
**Gap.** None.

#### HEAT-002 — Heatmap over a live screenshot of the page

Later · target · **done**

**Requirement.** The owner explicitly shares the live tracked browser tab through native tab capture; its Capture Handle must match this site, approved path and geometry. Screenshots remain only in that owner tab’s memory, no screenshot service is called, no image is uploaded or persisted, and sharing stops after each frame.

**Acceptance.**
1. The owner captures the enabled fixture page natively and sees its click and scroll maps over that live screenshot at 1440 and 390 CSS pixels.

**Evidence.** `src/vane/heat/browser.ts`; `tests/heat.test.mjs` — “HEAT-001 real clicks aggregate at two buttons without text or identifiers; scroll reach is METRIC-006 and recorded geometry maps fit desktop and mobile”, explicit VANE_HEAT_CAPTURE=1 native mode. Harness exception approved ct 22 Oct 15:14Z: fresh throwaway user-data-dir in this run’s work directory, real HOME, current Playwright Chromium headless, mock keychain and basic password store, own process group, directory deleted on success or failure; never a real profile, fake stream or fake handle. Native journey passed at 1440 and 390 in the 22 October native run, proving genuine native frames behind click and scroll maps, wrong-site/path/geometry refusal, memory-only images and stopped tracks after success and refusal; request/custody assertions exclude uploaded images. Product capture code is unchanged.
**Gap.** None.

### Sharing, team and data access

#### TEAM-004 — SAML sign-in and SCIM provisioning

Later · target · **partial** · From TEAM-002 · Cites BASE-SIGNIN-001 · Register R-6

**Requirement.** Team members can sign in through SAML, and SCIM provisions and deprovisions them, through [Auth](https://github.com/just-every/run-auth), Okta or Entra ID. SCIM creates a native zero-site Viewer bound by issuer and subject, never merges by email or grants a site, never raises a role, reactivates a removed person, touches an owner or sends invitation mail, and its owner-issued credential is shown once, stored hashed, scoped, rotatable and revocable with audit (RL-3).

**Acceptance.**
1. Against a SAML fixture issuer, sign in and deprovision a member through SCIM; their access ends at once.
2. Prove owner-issued shown-once hashed SCIM credentials, scope, rotation, revocation and audit; issuer+subject creation without email merge or site grants; no privilege raise, reactivation, owner mutation or invitation mail; next-request session/API/push revocation; and idempotent and out-of-order requests.
3. Against run-auth as the standards provider, SAML sign-in and the SCIM lifecycle pass.

**Evidence.** `tests/security.test.mjs` — “organization OIDC signs in Google and Entra members, refuses altered proofs and replay, and fences existing sessions when SSO is required” proves Google/Entra fixture sign-in and SSO enforcement; “SAML fixture signs existing invited accounts into native sessions, enforces signed binding constraints and refuses response replay” proves SAML fixture sign-in and enforced SSO; “SCIM credentials are owner-issued once, hashed, isolated from native and API authority, rotatable and revocable with audit” proves credential custody; “SCIM provisions bound zero-site Viewers without mail or email merges and never grants sites or raises roles” proves immutable federation binding and provisioning scope; “SCIM deactivation ends native and federated sessions, API keys and push tokens on the next request; replays and owner removal never reactivate” proves revocation and replay/order safety; “authenticator sign-in refuses wrong and replayed codes, consumes a recovery code once, and excludes credentials from analytics archives” proves TOTP/recovery and archive exclusion; “owner enforcement holds every account without a factor at enrollment, refuses private mutations and enrolls it before authenticator sign-in” proves owner-proved enrollment and all existing private HTTP and bearer doors. `tests/security-browser.test.mjs` — “members enroll and challenge in a real browser; owner requirements and SAML sign-in render at 1440 and 390” proves sign-in, factor and SCIM-credential screens; “owner outage recovery requires a deployment-issued owner link, preserves the second step and audits one recovery at 1440 and 390” proves audited owner break-glass and its access limits.
**Gap.** Named external dependency `okta-scim-admin-console`: the held Okta Integrator tenant and administrator API token are available, but its SCIM test integration requires Admin Console provisioning configuration and no administrator console session is held (R-6). Still unproved: real-provider create and deactivate, next-request session, API and push revocation, and zero-site provisioning in that live journey. SAML and SCIM pass against fixture issuers.

### Privacy, compliance and administration

#### PRIVACY-004 — Data location choice

Later · target · **missing**

**Requirement.** At setup the owner chooses where analytics data is stored: the US (the default), or the EU jurisdiction for EU-facing sites, using Cloudflare D1 location and jurisdiction controls. The choice is shown in the data inventory.

**Acceptance.**
1. Deploy one installation with the EU jurisdiction.
2. The database reports EU jurisdiction, and the inventory says so.

**Evidence.** None.
**Gap.** No data location choice.

#### MOBILE-002 — Native iOS and Android apps

Later · target · **missing** · Register R-7

**Requirement.** Native apps show every site's overview, real-time visitors, reports with filters, and alerts with push notifications and follow-up actions (`FOLLOW-001`). They include home-screen widgets for visitors today. Apps sign in with the installation's sign-in, including SSO.

**Acceptance.**
1. On iOS and Android test builds, sign in, open real-time, filter a report, receive a drop alert as a push and acknowledge it.
2. The acknowledgment appears in the web app.

**Evidence.** None.
**Gap.** No native apps.

## Field proof register

| ID | Proof | Clauses | State | Date | Receipt |
| --- | --- | --- | --- | --- | --- |
| R-1 | The `COLLECT-004` load (twelve months of 10,000,000 pageviews with 500 events a second) run on a deployed Cloudflare account, with the stated cost within 10% of the account's usage; about USD 900 at the published rates | HOST-001 | not run | | |
| R-2 | The WordPress plugin listed in the WordPress.org plugin directory | INSTALL-002 | not run | | |
| R-3 | The Shopify app approved and listed in the Shopify App Store | INSTALL-003 | not run | | |
| R-4 | The Google Tag Manager template published in the Community Template Gallery | INSTALL-005 | not run | | |
| R-5 | A full green run of the blocker journey on its weekly schedule against the then-current default lists, re-read by ct | INSTALL-006 | not run | | |
| R-6 | SAML sign-in and the SCIM lifecycle against real Okta and Entra ID tenants: create, deactivate, next-request session, API and push revocation and zero-site provisioning | TEAM-004 | not run | | |
| R-7 | The iOS and Android apps approved and listed in the App Store and Google Play | MOBILE-002 | not run | | |
| R-8 | A human screen-reader pass with VoiceOver or NVDA over the dashboard, report, settings, approval and alert journeys | MOBILE-001 | not run | | |
| R-9 | A VPAT for the web app | MOBILE-001 | not run | | |
| R-10 | The independent visual gate comparing the built homepage at 1440 and 390 px with the approved specification and picks | HOME-001 | not run | | |
