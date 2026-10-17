# Acceptance

Each clause in CONTRACT.md is accepted by the evidence below, run through a public door (route, command, built page or browser journey) on a built Worker with fakes only at paid or network edges. The status after each clause is the one recorded in CONTRACT.md's Status section at the judged commit; a build round moves a clause to done only when its evidence runs and passes.

## Existing guarantees

- `HTTP-001` One Worker with honest public and private doors (partial): Request `/health`, `/vane.js`, an unknown path and every private route signed out on a built Worker. Health answers, the script is served, unknown paths return 404, and private routes return 401 or redirect to sign-in (`tests/vane.test.mjs`).
- `ACCESS-001` Owners approve, administrators prepare, members read (done): Invite an administrator and a member. The member cannot prepare, the administrator cannot approve or import, export is owner-only, and revoking the administrator ends their session (`tests/vane.test.mjs`).
- `ACCESS-002` Private doors refuse signed-out and cross-origin requests (done): Call every private GET and POST door signed out, signed out after sign-out, and with a foreign Origin. Each is refused with no write (`tests/vane.test.mjs`).
- `APPROVE-001` Prepared changes apply only on the owner's recorded approval (done): Prepare as an administrator, approve as the owner, then approve again; the second approval gets 409. Inspect the proposal for distinct preparer and approver (`tests/vane.test.mjs`).
- `COLLECT-001` A cookie-free script that sends only declared anonymous fields (partial): Post an event from a foreign origin (403), with an extra personal field (400) and with a path carrying a query (400). A valid event is accepted (202) (`tests/vane.test.mjs`).
- `CONSENT-001` The site's consent mode is enforced at collection (done): On a consent-required site, an event without granted consent is refused with 403 and one with granted consent is accepted (`tests/vane.test.mjs`).
- `DEDUP-001` Each page load is admitted once (done): Send the same event twice (202, then 200 with nothing counted) and then a conflicting copy (409). The report counts one visit (`tests/vane.test.mjs`).
- `TRAFFIC-001` Page loads, sources, campaigns and goals with a comparison and stated limits (partial): Collect events in two adjacent periods and read the summary. Totals, breakdowns, the previous-period totals, the difference and the coverage-limit text match the seeded events.
- `IMPORT-001` Reviewed, journalled and undoable Umami import (done): Preview the import (no writes, no raw identifiers), apply it with a changed fingerprint (409), apply it twice (one job), read the journal and undo it (`tests/vane.test.mjs`).
- `ARCHIVE-001` Complete history export and atomic restore (done): Export, corrupt the archive and restore it (400, no writes). Restore the real archive into an empty installation, check that the tables are identical, restore it again (409) and undo the restored import (`tests/vane.test.mjs`).
- `ERASURE-001` Owner-approved erasure, fenced against old backups (done): Erase a site with live and imported history. Both are gone, the deletion and erasure journals exist, and restoring the old archive with the later journal is refused (`tests/vane.test.mjs`).
- `RETENTION-001` The declared retention window erases older history (done): Import old history, collect a recent event and apply retention until it completes. The old history is gone, the recent event remains, and one deletion is journalled (`tests/vane.test.mjs`).
- `RUNSITE-001` The public run site reaches installation and every guide (done): `rer build --site`, then follow every local link from the built homepage and guides (`tests/site.test.mjs`).
- `DOCS-001` Documentation built from repository Markdown (partial): Build the site and open each guide. Code blocks, tables and heading anchors render, and the clipboard control copies the block.
- `HOME-001` The approved homepage in the shared theme (partial): The independent visual gate compares the built homepage at 1440 and 390 px with the approved specification and picks.
- `LOBBY-001` The installed Lobby and real sign-in stay intact (partial): On a fresh installation, bootstrap the owner, complete `/setup`, sign in by email link and open `/app`. No landing-drawing numbers appear in analytics.
- `DEPLOY-001` Run-site deployment stays behind its switch (done): With the variable unset, the run-site workflow skips deployment. The identifiers in `wrangler.jsonc`, `package.json` and `edition.json` are unchanged.

## Install and collection

- `INSTALL-001` One script tag with live install verification (partial): Point a fixture site at Vane without the script, then with the wrong site ID, then with a CSP that blocks it, then correctly. Each check names its cause; the correct one turns verified when the first event arrives.
- `INSTALL-002` WordPress and WooCommerce plugin (missing): Install the plugin on a WordPress + WooCommerce test site, connect it and place a test order. Pageviews, automatic events and a purchase with the correct USD revenue appear in Vane, and admin visits are excluded when that option is set.
- `INSTALL-003` Shopify app with checkout tracking (missing): Install the app on a Shopify development store and complete a test checkout. Storefront pageviews, the checkout funnel steps and a reconciled purchase with its revenue appear.
- `INSTALL-004` Webflow, Squarespace, Wix, Pane and static-site paths (missing): Follow each guide against its platform's test site and pass verification. Turn on Vane in a Pane site and see the page's visitors in the Pane editor.
- `INSTALL-005` Google Tag Manager template (missing): Import the template into a GTM container, publish it and fire a dataLayer purchase. A Vane event with the mapped properties arrives, and denied consent sends nothing in a consent-required mode.
- `INSTALL-006` First-party proxy so blockers do not erase data (missing): Configure the Cloudflare route and the Next.js rewrite and load the site with a common blocker list active. Events still arrive, the proxy share is reported, and the forwarded values are never stored raw.
- `INSTALL-007` Single-page applications and hash routing (missing): Navigate a React Router and a hash-routed fixture through four views. Four pageviews arrive with the right paths and no duplicates.
- `INSTALL-008` Server-side and mobile Events API (missing): Send events from a server with a site token, with a duplicate idempotency key and with a token for another site. Events count once, the foreign token is refused, and no raw IP or user agent is stored.
- `COLLECT-002` Open path collection with automatic redaction (missing): Load pages with emails, tokens, order numbers and UTM and click-ID queries in the URL. Stored paths are redacted, UTM values and the paid-click flag are kept, and a rewrite rule groups the order pages.
- `COLLECT-003` Bot, referrer-spam and internal-traffic exclusion (missing): Send traffic from a headless browser, a spam referrer, an excluded IP and an opted-out browser beside real visits. Only the real visits count, and the exclusion report shows each reason and its count.
- `COLLECT-004` Collection at small-business scale (partial): A load test at the stated volume and burst rate admits every valid event exactly once. The 12-month dashboard query is timed, and the limit warning appears at the published threshold.
- `COVERAGE-001` Coverage shown beside every number (partial): Combine declined consent, sampling, exclusions, an import and a zone comparison on one site. The report shows each share with its denominator and labels the totals as partial.

## Visitors and engagement

- `METRIC-001` Cookie-free unique visitors from daily-rotating salted hashes (missing): Send pageviews from two simulated visitors over two days. Unique visitors are 2 per day and the range shows 4 under the stated method. Show that the database, logs and archive hold no IP, no user agent and no salt older than 24 hours, and that the same visitor hashes differently on another site.
- `METRIC-002` Visits and pages per visit (missing): Send one visitor's pageviews with gaps of 10, 40 and 5 minutes. The report shows 2 visits, 4 pageviews and 2 pages per visit.
- `METRIC-003` Bounce rate and visit duration (missing): Simulate a quick bounce, a single-page visit with 45 seconds of engagement, and a three-page visit. The bounce rate, visit durations and per-page time match the definitions.
- `METRIC-004` Methodology disclosed and versioned (partial): Open the methodology page signed out and follow each metric's definition link from the dashboard. Change the visit timeout and see a definition annotation dated on the charts.
- `METRIC-005` Consented visitor mode: returning visitors and retention (missing): With consent granted, visit on day 1 and day 8 and see one returning visitor in the week-2 cohort. Without consent, the same visits count as cookie-free daily visitors. A revoke deletes the identifier.
- `METRIC-006` Scroll depth and time on page (missing): Scroll a long fixture page to 50% and to 100% in separate visits. The page shows the average depth and the 75% share as expected.

## Dashboards and analysis

- `DASH-001` Real-time dashboard (missing): Send events while the real-time view is open. Current visitors and the live lists update within 15 seconds and drop once the visitors go idle for 5 minutes.
- `DASH-002` Historical time series in the site's time zone (partial): Seed events either side of a US daylight-saving change and midnight in America/Chicago. The daily buckets follow local days, each preset range returns the expected totals, and the data table matches the chart.
- `DASH-003` Page, entry and exit reports (partial): Seed visits with known entry and exit pages. The three tables match, and grouping by `/blog/*` sums the posts correctly.
- `DASH-004` Channels, referrers and UTM campaigns (partial): Send visits with Google organic, Google paid (gclid flag), Facebook, an email UTM, a chatgpt.com referrer and five-field UTMs. Each lands in its documented channel and every UTM field is reportable.
- `DASH-005` Country, region and city (missing): Send events with Cloudflare geo for Texas, Ontario and London. Reports show the country, region and city, and no IP appears anywhere in storage.
- `DASH-006` Devices, browsers and operating systems (missing): Send events from iPhone Safari, Android Chrome, Windows Edge and an iPad. The device, browser and OS tables match, and no raw user agent is stored.
- `DASH-007` Filters, segments and saved views (missing): Filter by Organic Search and mobile and not `/blog/*`, save the segment and reopen it in a report and an alert. Each total equals a hand-computed count of the seeded events.
- `DASH-008` Period comparisons (partial): Compare the last 30 days with the previous period and with last year. The chart overlays and the per-row changes match the seeded data.
- `DASH-009` Annotations, manual and automatic (missing): Add a manual note, approve a settings change, post a deploy webhook and receive an Uptime incident. All four annotations appear on the chart at the right time.
- `DASH-010` Multi-site overview and roll-up (partial): With three sites, open the overview, sort it by change and create a roll-up of two of them. The roll-up totals equal the sum of the two sites.
- `DASH-011` Journeys and paths (missing): Seed visits through home → pricing → signup and home → blog → exit. The journey from home shows both paths with the right counts.
- `DASH-012` Site-search analytics (missing): Search `?q=returns` from two visitors and `?q=alice@example.com` from one. The returns term appears and the email-like term never does.
- `PERF-001` Page performance (missing): Load a fixture page with an artificially slow image and see its LCP p75 above 2.5 s on that page only.
- `HEAT-001` Aggregate click and scroll maps (missing): Click two buttons repeatedly on a fixture page. The heatmap concentrates on them, no event holds text or identifiers, and the scroll map matches `METRIC-006`.

## Conversions and revenue

- `CONV-001` Pageview goals with patterns and conversion rates (partial): Define `/thanks*` and visit `/thanks` and `/thanks/pro`. Both convert, and the conversion rate equals converting visitors divided by visitors.
- `CONV-002` Custom events with properties (missing): Fire Signup with plan=pro and plan=free through JavaScript and CSS classes. The breakdown by plan matches, and a property holding an email address is refused.
- `CONV-003` Automatic outbound-link, file-download, 404 and form-submission events (missing): Click an outbound link and a PDF link, open a 404 page and submit a form on a fixture site. Four events arrive with the right properties and no form contents.
- `CONV-004` Conversion rates by source, campaign, landing page and audience (missing): Seed conversions from Google and from email. The channel table shows each channel's conversion rate and revenue for the selected goal.
- `CONV-005` Funnels (missing): Define the funnel product → cart → checkout → purchase and seed visits that drop at each step. The step counts and rates match, and the segment filter recomputes them.
- `CONV-006` Revenue goals (missing): Record USD and CAD purchases with a Stripe Checkout return referrer. Revenue totals in USD with the stated rate, and attribution goes to the original source rather than Stripe.
- `CONV-007` Ecommerce events (missing): Run a test purchase through each of the three platforms. The ecommerce funnel and the product report show the product, quantity and revenue.
- `CONV-008` Conversions reconciled with real orders and leads (missing): Complete three Stripe test payments, one with the browser event blocked and one refunded, and two HubSpot form submissions, one later marked qualified. The report shows each outcome in its correct confirmed or unconfirmed column, with net revenue.
- `CONV-009` No-code event definitions (missing): Define a click event for `#book-demo`, preview the matched element and approve it. Clicks on the live fixture arrive as the event, with no site code change.
- `EXPERIMENT-001` A/B tests with honest results (missing): Run a fixture test with a seeded 20% lift and a null test. The first reaches significance with the expected interval, the null test never does, and a skewed split triggers the mismatch warning.

## Search and advertising

- `SEARCH-001` Google Search Console keywords (missing): Against a Search Console API fixture, connect, read the queries, filter by a query and disconnect. The query and page figures match the fixture, and the tokens are removed after disconnect.
- `SEARCH-002` Bing Webmaster Tools keywords (missing): Against a Bing API fixture, connect and see Bing queries beside Google's with matching figures.
- `ADS-001` Ad spend matched to campaigns (missing): Against ad API fixtures, connect two platforms and map one campaign by hand. Spend, CPA and ROAS per campaign match the fixtures and the confirmed revenue.

## Import and migration

- `IMPORT-002` Google Analytics 4 history import (missing): Against a GA4 Data API fixture, preview, apply, read the journal and undo a 13-month import. Imported totals match the fixture per dimension, and the definition-difference notes are shown.
- `IMPORT-003` Plausible import (missing): Import a Plausible export fixture and an API fixture. Each dimension's totals match the source, and undo removes them.
- `IMPORT-004` Fathom import (missing): Import a Fathom export fixture; the totals match and undo works.
- `IMPORT-005` Matomo import (missing): Import from a Matomo Reporting API fixture. The aggregates match, no visitor-log rows are stored, and undo works.
- `IMPORT-006` Umami, Simple Analytics and PostHog at full scale (partial): Import a 2-million-row Umami export, a Simple Analytics export and a PostHog export fixture, with an interruption mid-way. Each resumes, totals match, and no identifiers are kept.
- `IMPORT-007` Imported history merges without double counting (partial): Import GA4 history that overlaps two days of live collection. Charts show the overlap once using live data, label the imported range and count it as unknown coverage.

## Reports, alerts and follow-up

- `REPORT-001` Scheduled email reports (missing): Subscribe two recipients to the weekly report at 8:00 America/New_York and run the schedule across a daylight-saving change. Each email arrives once at the local hour with figures that match the dashboard, unsubscribe stops it, and a bounced delivery shows in the app.
- `REPORT-002` Slack, Microsoft Teams and Nook delivery (missing): Against fixture endpoints for all three, send a weekly report and an alert. Each payload carries the right figures and a working deep link, and a revoked token surfaces as a delivery failure.
- `REPORT-003` A readable explanation of what changed (partial): Seed a week where organic search falls 40% on one page while other channels are stable. The explanation names that page and channel with its denominators, lists the overlapping annotation, and labels a small fluctuation as normal variation.
- `ALERT-001` Traffic spike and drop alerts (missing): Seed eight weeks of baseline traffic, then inject a 4× spike, a 70% drop and a Thanksgiving-day dip. The spike and drop alert once each, the holiday dip does not, and the cool-down suppresses a repeat.
- `ALERT-002` Conversion, revenue and tracking-health alerts (missing): Remove the script from a fixture site, break a goal's event name and block browser purchase events while Stripe confirms orders. Each condition raises its own named alert.
- `FOLLOW-001` Alerts are followed through until a person resolves them (missing): Fire a drop alert, leave it unacknowledged past the reminder time, then the escalation time. One reminder and one escalation arrive. Acknowledge and resolve it as a tracking fault. Reminders stop and the item records who resolved it, when and with what outcome.

## Sharing, team and data access

- `SHARE-001` Shared links and embedded dashboards (missing): Create a password-protected link that hides revenue, open it signed out and embed it. The figures match the dashboard with no revenue shown, the wrong password is refused, and a revoked link returns 404.
- `SHARE-002` Public dashboards (missing): Make a site public with two reports chosen and open its URL signed out. Only those reports appear, and turning it off returns 404.
- `TEAM-001` Per-site roles and invitations (partial): Invite an analyst to one site and a viewer to two sites. Exercise every action through its public route as each role: every out-of-role or out-of-scope call is refused with no write, and a transfer of ownership works only with the current owner's confirmation.
- `TEAM-002` Single sign-on and two-step sign-in (missing): Against OIDC and SAML fixture issuers, sign in, enforce SSO and deprovision a member through SCIM. Their access ends at once.
- `AGENCY-001` Agency client workspaces and branded reports (missing): Create two clients, each with a site and a client user. Each client user sees only their own site, the branded weekly email shows the agency logo, and the agency overview lists both.
- `API-001` Stats API (partial): With a scoped key, query visitors by channel with a filter and a comparison; the figures equal the dashboard's. A key for another site, a revoked key and a burst over the rate limit are each refused.
- `API-002` CSV, Looker Studio and warehouse export (missing): Download a breakdown as CSV and a site ZIP, run the Looker Studio connector against the API, and run a scheduled export to an R2 fixture. Each matches the dashboard and the declared schema.
- `API-003` Webhooks for goals, alerts and reports (missing): Subscribe a webhook endpoint, fire an alert and a goal burst, and fail the first delivery. Signed payloads arrive once each after the retry, and the delivery log shows the failure and the success.
- `API-004` MCP endpoint for assistants (missing): Connect an MCP client with a scoped key and ask for last week's top sources; the result equals the Stats API answer, and a write tool is refused without a grant.

## Privacy, compliance and administration

- `PRIVACY-001` Data inventory and privacy-policy text (partial): Toggle consented mode, automatic events and a Search Console connection. The inventory and the generated text change to match, and the stored data matches the inventory.
- `PRIVACY-002` US state privacy signals honoured (partial): Load a fixture page with GPC set and with DNT set. Nothing is collected, the signal share is counted in a field-free counter if the owner enables it, and the stance shows on the methodology page.
- `PRIVACY-003` Consent managers and regional consent modes (partial): With each adapter on a fixture page, deny and then grant consent from a California, a German and a Texas location. Collection follows each region's rule.
- `PRIVACY-004` Data location choice (missing): Deploy one installation with the EU jurisdiction. The database reports EU jurisdiction, and the inventory says so.
- `AUDIT-001` Durable audit of settings, data and agent actions (partial): Perform each audited action and read the audit view and export. Each entry is present, and erasing a site's history leaves the audit entries without the erased data.
- `SITE-001` Site management (partial): Add a site with a `www` and an apex hostname, change its time zone and currency through approval, and delete it. Events from both hostnames count, and deletion leaves no history.
- `HOST-001` Owner-run hosting with measured cost (partial): Deploy to a Cloudflare test account, run the `COLLECT-004` load test and read the cost panel. The stated cost per 100,000 pageviews matches the measured account usage within 10%.
- `DEMO-001` Try Vane on realistic data (partial): Start `rer demo`, open each example site and approve the pending change. Stop the demo; its data is removed.
- `MOBILE-001` Phone-ready, accessible dashboard (partial): At 390 and 1440 px, complete the site, report, filter, approval and alert journeys by keyboard with an automated accessibility scan clean. Install the PWA and receive a push alert.
- `MOBILE-002` Native iOS and Android apps (missing): On iOS and Android test builds, sign in, open real-time, filter a report, receive a drop alert as a push and acknowledge it. The acknowledgement appears in the web app.

## Push further with agents

- `AGENT-001` Maintain trustworthy instrumentation (missing): Deploy a fixture site change that renames the signup button and drops the script from one template. The agent reports both with evidence and drafts a PR and a no-code event. After the owner approves and the change deploys, the agent confirms the events arrive again and annotates the fix.
- `AGENT-002` Explain why traffic or conversions moved (missing): Seed three fixture weeks: a tracking break, an organic ranking drop, and a real checkout failure that confirmed orders corroborate. For each, the agent ranks the true cause first with cited evidence and names what is unknown.
- `AGENT-003` Propose and ship a site or campaign change under granted authority (missing): Grant Pane page-edit and GitHub PR access but no ad access. The agent ships an approved CTA change in Pane and opens a PR for a title change. Its proposed budget change waits for approval and cannot be shipped without the ad grant, and revoking the Pane grant blocks the next edit.
- `AGENT-004` Measure the result against coverage gaps (missing): Ship two fixture changes: one with a real lift under an experiment, and one before-and-after change during a consent-rate drop. The first is reported as a measured improvement with its interval, the second as inconclusive because of coverage, and an approved revert restores the prior page.
- `AGENT-005` Pursue anomalies to resolution (missing): Fire a silent-site alert caused by a deploy. The agent attaches its evidence, messages the configured developer once, reminds them after the due time, and after the fix verifies events and closes the item with that evidence. A real traffic dip with no fault is closed as expected after the owner confirms.
- `AGENT-006` Weekly growth brief with opportunities (missing): On a fixture site with seeded opportunities, the brief names each with correct figures and a linked draft. A dismissed type does not return the next week.
- `AGENT-007` Answer questions in plain English, with the query shown (missing): Ask ten fixture questions, including an ambiguous one and an unanswerable one. Every numeric answer equals the Stats API result for the shown query, the ambiguous question gets a choice and the unanswerable one says why.

## Not required

Cross-site tracking, fingerprinting, identity graphs, ad-exchange attribution, individual session replay and per-user product analytics with person profiles are outside Vane (see CONTRACT.md's Honest boundaries). Domain purchase and fleet rollout are separate lanes; independent release review is a later stage.

## Checks

Functional site check: `rer build --site`, then `node --test tests/site.test.mjs`.
Product journeys: `pnpm run test:vane` (built Worker under Miniflare).
Shared type check: `pnpm typecheck`. The independent visual gate compares the
built homepage at 1440 and 390 with the approved SPEC and picks.
