# Vane Agent surface (draft)

Draft Agent surface for Vane, written by ct on 28 October 2026 to the contract standard's section 13. It maps every Core clause of `CONTRACT.md` at main `7d02f5807e148660e634f62b713d1fa39e468d4c` (110 Core clauses). It is not part of CONTRACT.md yet: the seed's contract cleanup folds the `### Agent surface` area below into CONTRACT.md as the last area under Target clauses, and the rows under "Status rows" into its Status table. Old clauses whose text fixes what happens to an agent's step: ACCESS-001, APPROVE-001, DASH-005, IMPORT-008, IMPORT-009, FOLLOW-001, TEAM-001, API-001, API-004, AGENT-001, AGENT-002, AGENT-003, AGENT-004, AGENT-005, AGENT-006; the cleanup rewords them as the class the step carries.

### Agent surface

**Specialist: Website measurement analyst.** It keeps website instrumentation trustworthy, explains traffic and conversion movements, follows anomalies, prepares and ships granted improvements, and measures their results for the business.

Inherits BASE-AGENT-001 to BASE-AGENT-013. The company's policy decides every call.

**How Vane computes each class.** Vane derives the following facts from typed arguments, native records, current recipients, provider responses and deployment targets; caller labels, confirmation flags and imported or fetched text cannot lower a class.

- *standard:* reversible internal analysis, drafts, notes, schedules and settings that do not match another class; facts identify the site and item count. A note or draft on this surface retains its prior revision for Undo.
- *external:* a request exposing data to an outside provider or website, an outside message, or publication/exposure of report or brand content to someone outside the business; facts carry recipient count and counterparty known, new or public. Known means a trusted business domain or customer/vendor on record; public means an open or bearer shared link; otherwise new. Delivery confined to business-owned in-product channels or the local outbox is standard; an outside transport or audience makes it external. Credential handling remains security even for a business-owned bucket.
- *money:* a shipped or reverted ad budget, bid or campaign spending schedule changes what the business pays; facts carry currency, amount/delta, billing interval and counterparty. Reading spend, recording revenue/refunds, forecasting hosting cost or drafting a budget changes no charge and is not money.
- *gated:* an outside provider answers that it keeps consent, hosted checkout/card entry, identity/business verification or personal terms acceptance for a person; facts name provider and step. The same connection or publish call without that response carries no gated class; the interactive ceremony is outside the tool.
- *access:* staff/client membership, roles, ownership and site scope, API/SCIM keys, repository, proxy, channel, source, warehouse and webhook grants change standing authority; facts identify people or principals, native target scope, and widens or narrows. Report links confer item visibility, not standing authority.
- *security:* SSO/second-step settings and handling, issuing, rotating or revoking provider or integration credentials; facts name the setting or credential kind without its value. Source reads and publishes add security only when the native connection requires credential use; public page reads do not.
- *destructive:* site/history erasure, retention execution, and permanent saved-segment or annotation removal have no product Undo; facts carry affected item counts and cutoff. Reversible notes/drafts and a retention-window setting are standard; applying the erasure is destructive.
- *sensitive:* question text actually sent to the model contains health, ID, bank, card or payroll numbers; facts carry records and kind. Ordinary private aggregates and revenue totals do not qualify. Vane's question boundary still refuses email and sends no stored analytics figures; classification adds no collection field or permission to disclose one.
- *live:* site/collection/visitor/goal/funnel/event/experiment settings, site creation/deletion, proxy routing or a deployed website/campaign change alter a running service for its users; facts name the service and affected sites/paths. A draft PR without deployment is not live.

Vane uses no accounts or commitment class: these jobs connect existing accounts/resources and do not create paid resources, sign terms, make offers or provide business sign-offs. A provider requiring such an additional operation exposes a separate job with its actual class before it is offered. In the table, `a or b` is computed per call, `a · b` means both, and `(+ c)` adds c when its condition holds. Today names the existing native action or route, not a claim that the new registry or policy door exists.

| Tool | Does | Core clauses | Risk class | Today |
| --- | --- | --- | --- | --- |
| `vane.sites.list` | List sites and the compared overview | DASH-010 | standard | MCP `list_sites`; `GET /api/vane/sites` |
| `vane.sites.get` | Read one site and its collection configuration | SITE-001 | standard | `GET /api/vane/sites` |
| `vane.sites.create` | Create a site with its origins and reporting definitions | SITE-001 | live | `site.prepare`; provisioning `POST /api/v1/sites` |
| `vane.sites.update` | Change site origins, time zone and currency | SITE-001, DASH-013 | live | `config.prepare` with site fields |
| `vane.sites.delete` | Delete a site and its history, retaining the deletion fence | SITE-001, ERASURE-001 | destructive · live | `site.delete.prepare` and native proposal application |
| `vane.stats.query` | Query totals, all breakdowns, periods, filters and comparisons | TRAFFIC-001, METRIC-001, METRIC-002, METRIC-003, METRIC-005, METRIC-006, DASH-002, DASH-003, DASH-004, DASH-005, DASH-006, DASH-007, DASH-008, DASH-012, DASH-013, DASH-014, CONV-002, CONV-004, CONV-006, CONV-007, API-001 | standard | MCP `query_stats`; `GET /api/v1/stats` |
| `vane.realtime.get` | Read current visitors, live lists and compared minute buckets | DASH-001 | standard | `GET /api/vane/realtime` |
| `vane.journeys.get` | Read aggregate paths and drop-offs from a page | DASH-011 | standard | `GET /api/vane/summary` journey fields |
| `vane.performance.get` | Read page/device p75 timing and measured denominators | PERF-001 | standard | `GET /api/vane/summary` performance fields |
| `vane.heatmaps.get` | Read aggregate width-specific click and scroll grids | HEAT-001 | standard | `GET /api/vane/heat` |
| `vane.heatmaps.configure` | Enable or disable collection on an exact page | HEAT-001 | live | `POST /api/vane/heat-settings` |
| `vane.coverage.get` | Read coverage denominators, exclusions and unknown periods | COVERAGE-001 | standard | `GET /api/vane/summary` coverage fields |
| `vane.methodology.get` | Read versioned metric definitions and source lists | METRIC-004 | standard | `GET /methodology` |
| `vane.collection.configure` | Change paths, redaction, exclusions, compatibility and consent adapters | CONSENT-001, COLLECT-002, COLLECT-003, IMPORT-008, PRIVACY-002, PRIVACY-003 | live | `config.prepare` with collection fields |
| `vane.visitors.configure` | Change visit timeout and consented-mode lifetime | METRIC-002, METRIC-004, METRIC-005 | live | `config.prepare` with visitor fields |
| `vane.events.collect` | Submit site-scoped pageviews and custom/ecommerce events with native redaction and deduplication | INSTALL-008, COLLECT-001, DEDUP-001, CONV-002, CONV-003, CONV-006, CONV-007 | standard | `POST /api/v1/events` |
| `vane.installations.snippet` | Read the site-specific install snippet and routing options | INSTALL-001 | standard | site Settings snippet |
| `vane.installations.verify` | Check the registered homepage and first-event evidence | INSTALL-001 | external | `POST /api/vane/install-check` |
| `vane.cutovers.scan` | Inventory same-origin call sites and draft native rewrites | IMPORT-008 | external | `POST /api/vane/cutover-scan` |
| `vane.cutovers.get` | Read scan findings and unsupported compatibility options | IMPORT-008 | standard | `GET /api/vane/cutover-scans` |
| `vane.proxies.list` | Read proxy connections and platform setup instructions | INSTALL-006 | standard | `GET /api/vane/proxy-connections`; `/api/vane/proxy-setup` |
| `vane.proxies.connect` | Connect an external server proxy or Cloudflare route | INSTALL-006 | access · security · live (+ external) (+ gated) | `POST /api/vane/proxy-connections` |
| `vane.proxies.rotate` | Rotate a proxy credential | INSTALL-006 | access · security | native proxy command |
| `vane.proxies.disconnect` | Revoke a proxy connection | INSTALL-006 | access · security · live (+ external) | native proxy command |
| `vane.segments.list` | Read saved filter sets | DASH-007 | standard | site report/Settings segments |
| `vane.segments.save` | Save a named filter set | DASH-007 | standard | `segment.save` |
| `vane.segments.delete` | Delete a saved filter set | DASH-007 | destructive | `segment.delete` |
| `vane.rollups.create` | Create an internal multi-site roll-up | DASH-010 | standard | native roll-up form |
| `vane.annotations.list` | Read dated notes and integration/definition annotations | DASH-009 | standard | `GET /api/vane/summary` annotations |
| `vane.annotations.add` | Add an internal dated chart note | DASH-009 | standard | `annotation.add`; MCP `add_annotation` currently refuses writes |
| `vane.annotations.delete` | Remove a manual chart note | DASH-009 | destructive | `annotation.delete` |
| `vane.annotations.issue` | Issue an integration annotation credential or release-signing key | DASH-009 | access · security | `annotation-hook.create`; `annotation-github.create` |
| `vane.annotations.revoke` | Revoke an integration annotation credential | DASH-009 | access · security | `annotation-hook.revoke`; `annotation-github.revoke` |
| `vane.metros.replace` | Replace or clear the site-supplied metro-name table and publication choice | DASH-005 | standard or external | `metro.prepare`; `metro.clear`; native proposal application |
| `vane.goals.list` | Read goal patterns, thresholds and currency definitions | CONV-001, CONV-006 | standard | site Settings goals |
| `vane.goals.save` | Set pageview, scroll, custom-event or revenue goal definitions | CONV-001, CONV-006 | live | `config.prepare`; provisioning goal route |
| `vane.funnels.get` | Read step definitions, compared reach and median transitions | CONV-005 | standard | `GET /api/vane/summary` funnels |
| `vane.funnels.save` | Set ordered funnel steps and conditions | CONV-005 | live | `config.prepare` with funnels |
| `vane.definitions.preview` | Preview a no-code selector against a registered page | CONV-009 | external | `event.preview` |
| `vane.definitions.save` | Set no-code and automatic-event definitions | CONV-003, CONV-009 | live | `config.prepare` with event definitions |
| `vane.experiments.get` | Read variants, intervals, power and sample-ratio warnings | EXPERIMENT-001 | standard | `GET /api/vane/summary` experiments |
| `vane.experiments.save` | Set the live experiment and assignment configuration | EXPERIMENT-001 | live | `config.prepare` with experiments |
| `vane.search.get` | Read Google/Bing query, page and pending-source figures | SEARCH-001, SEARCH-002 | standard | `GET /api/vane/search-console/report`; `/api/vane/bing/report` |
| `vane.search.connect` | Connect a verified Google or Bing property | SEARCH-001, SEARCH-002 | external · access · security (+ gated) | `search.google.begin`; `search.google.property`; `search.bing.connect` |
| `vane.search.sync` | Fetch the selected property range with read-only provider scope | SEARCH-001, SEARCH-002 | external · security | `search.google.sync`; `search.bing.sync` |
| `vane.search.disconnect` | Remove provider authority while retaining source aggregates | SEARCH-001, SEARCH-002 | access · security (+ external) | `search.google.disconnect`; `search.bing.disconnect` |
| `vane.advertising.get` | Read daily campaign spend, mappings and confirmed-outcome ratios | ADS-001 | standard | none |
| `vane.advertising.connect` | Connect an existing read-only advertising source | ADS-001 | external · access · security (+ gated) | none |
| `vane.advertising.sync` | Fetch daily source aggregates without visitor records | ADS-001 | external · security | none |
| `vane.advertising.map` | Save a campaign-to-UTM mapping | ADS-001 | standard | none |
| `vane.outcomes.get` | Read browser, confirmed, unconfirmed and server-only outcomes | CONV-008 | standard | none |
| `vane.outcomes.connect` | Connect an existing order/lead source with aggregate-only custody | CONV-008 | external · access · security (+ gated) | none |
| `vane.outcomes.reconcile` | Reconcile opaque outcome IDs and refunds without moving money | CONV-008 | external · security | none |
| `vane.reports.get` | Read generated explanations, periods and delivery receipts | REPORT-001, REPORT-002, REPORT-003 | standard | site Settings sends/chat delivery log; summary explanation |
| `vane.reports.schedule` | Save a report schedule and destinations | REPORT-001, REPORT-002 | standard | `report.subscribe`; `chat.schedule` |
| `vane.reports.unsubscribe` | End a report subscription | REPORT-001, REPORT-002 | standard | native unsubscribe; `chat.unschedule` |
| `vane.reports.send` | Deliver an email or connected-channel report | REPORT-001, REPORT-002 | standard or external | native report dispatch; `chat.test` |
| `vane.channels.connect` | Connect an existing Slack, Teams or Nook destination | REPORT-002 | external · access · security (+ gated) | `chat.slack.begin`; `chat.teams.connect`; `chat.nook.connect` |
| `vane.channels.disconnect` | Erase local channel credentials and request provider revocation where supported | REPORT-002 | access · security (+ external) | `chat.disconnect` |
| `vane.alerts.list` | Read rules, crossings, holds and tracking-health results | ALERT-001, ALERT-002 | standard | site Settings alerts |
| `vane.alerts.save` | Set a traffic, conversion, revenue or tracking-health rule | ALERT-001, ALERT-002 | standard | `alert.create`; `health.time` |
| `vane.alerts.send` | Deliver a crossing or tracking-health notification | ALERT-001, ALERT-002 | standard or external | native traffic/health dispatch |
| `vane.followups.get` | Read an item, responsible person, next action and history | FOLLOW-001 | standard | site Settings follow-up items |
| `vane.followups.acknowledge` | Acknowledge a follow-up item | FOLLOW-001 | standard | `follow.ack` |
| `vane.followups.assign` | Assign an item to a person in site scope | FOLLOW-001 | standard | `follow.assign` |
| `vane.followups.comment` | Add a comment and attach investigation evidence | FOLLOW-001 | standard | `follow.comment` |
| `vane.followups.resolve` | Record an outcome and recovery evidence | FOLLOW-001, AGENT-005 | standard | `follow.resolve`; agent pursuit currently leaves resolution to native action |
| `vane.followups.remind` | Send the next due reminder or escalation | FOLLOW-001, AGENT-005 | standard or external | native follow-up scheduler |
| `vane.shares.create` | Create a scoped shared/embed link without sending it | SHARE-001 | external | `share.create`; provisioning shared-link route |
| `vane.shares.revoke` | Revoke a shared link | SHARE-001 | standard | `share.revoke` |
| `vane.publications.set` | Choose public reports or withdraw the public page | SHARE-002 | standard or external | `config.prepare` with public-report fields |
| `vane.members.list` | Read team roles and site scopes | TEAM-001 | standard | native team view |
| `vane.members.invite` | Invite a person to named sites and a role | TEAM-001 | access (+ external) | `team.invite` |
| `vane.members.update` | Change a person’s role or sites, including ownership transfer | TEAM-001 | access | `team.grant`; `team.transfer` |
| `vane.members.remove` | Deactivate a member and end their sessions | TEAM-001 | access | `team.remove` |
| `vane.security.configure` | Change SSO and required second-step protection | TEAM-002 | security | `POST /auth/security/policy`; `/auth/security/identity` |
| `vane.scim.issue` | Issue a scoped SCIM credential | TEAM-002 | access · security | `POST /auth/security/scim/issue` |
| `vane.scim.revoke` | Revoke a SCIM credential | TEAM-002 | access · security | `POST /auth/security/scim/revoke` |
| `vane.clients.list` | Read clients and the scoped cross-client overview | AGENCY-001 | standard | `GET /api/vane/agency` |
| `vane.clients.save` | Create or update a client record | AGENCY-001 | standard | native `agencyAction` client action |
| `vane.clients.assign` | Assign sites and client memberships | AGENCY-001 | access (+ external) | native `agencyAction` membership/site actions |
| `vane.brands.set` | Set branding on existing private or public report scopes | AGENCY-001 | standard or external | native `agencyAction` branding action |
| `vane.keys.issue` | Issue a site-scoped Stats, Events or provisioning credential | API-001, INSTALL-008 | access · security | `apikey.create` |
| `vane.keys.revoke` | Revoke an API credential | API-001, INSTALL-008 | access · security | `apikey.revoke` |
| `vane.exports.download` | Download the report CSV or site ZIP | API-002 | standard | `GET /api/vane/csv`; `/api/vane/site-zip` |
| `vane.warehouses.connect` | Set credentials for an existing bucket and schedule export | API-002 | access · security | `saveExport` |
| `vane.warehouses.send` | Send ended-day anonymous CSV objects to the configured warehouse | API-002 | external · security | `runExportNow`; `runExports` |
| `vane.warehouses.disconnect` | Stop export and erase the bucket credential | API-002 | access · security | `deleteExport` |
| `vane.webhooks.create` | Set an endpoint, event selection and signing secret | API-003 | access · security | native webhook creation |
| `vane.webhooks.deliver` | Deliver the next signed aggregate event | API-003 | external · security | native webhook dispatcher |
| `vane.webhooks.revoke` | Remove an endpoint and signing secret | API-003 | access · security | native webhook deletion |
| `vane.privacy.get` | Read field inventory, processors and generated policy text | PRIVACY-001, PRIVACY-005 | standard | `GET /api/vane/inventory` |
| `vane.retention.set` | Set a site’s retention window | RETENTION-002 | standard | `config.prepare` with retention |
| `vane.retention.apply` | Erase events before the current retention cutoff | RETENTION-001, RETENTION-002 | destructive | `history.retention` |
| `vane.erasures.prepare` | Preview history erasure and its deletion fence | ERASURE-001 | standard | `history.erase.prepare` |
| `vane.erasures.apply` | Erase live/imported history and retire custody | ERASURE-001 | destructive | native history-erasure proposal application |
| `vane.audit.list` | Read the authorized installation audit and export | AUDIT-001 | standard | `GET /api/vane/audit` |
| `vane.events.list` | Read typed changes after a cursor | AUDIT-001 | standard | none; current signed webhooks cover a subset |
| `vane.costs.get` | Read measured hosting use, projections and plan/capacity warnings | HOST-001 | standard | native hosting cost panel |
| `vane.instrumentation.inspect` | Compare declared measurement with sitemap, source diffs and arrivals | AGENT-001 | standard or external (+ security) | `POST /api/vane/instrumentation/run` |
| `vane.instrumentation.prepare` | Draft an evidence-linked no-code or source fix | AGENT-001 | standard | `POST /api/vane/instrumentation/prepare` |
| `vane.instrumentation.verify` | Check deployed pages and real payload recovery | AGENT-001 | external | `POST /api/vane/instrumentation/verify` |
| `vane.sources.connect` | Connect existing repository/deploy/evidence authority | AGENT-001, AGENT-002 | access · security (+ external) (+ gated) | `POST /api/vane/instrumentation/github`; `/api/vane/movement-evidence/settings` |
| `vane.sources.revoke` | Revoke repository or evidence-sender authority | AGENT-001, AGENT-002 | access · security (+ external) | native GitHub/evidence disconnect actions |
| `vane.movement.explain` | Rank hypotheses with denominators, provenance and unknowns | AGENT-002 | standard | `POST /api/vane/movement` |
| `vane.changes.draft` | Draft copy, CTA, metadata, redirect or campaign changes with guardrails | AGENT-003 | standard | `POST /api/vane/agent/draft` |
| `vane.changes.publish` | Open a source PR or publish a granted site/campaign change | AGENT-001, AGENT-003 | external (+ live) (+ money) (+ security) (+ gated) | `POST /api/vane/instrumentation/github-pr` for mapped HTML draft PR only; general `/api/vane/agent/ship` refuses |
| `vane.changes.revert` | Restore a deployed site/campaign revision under current authority | AGENT-004 | external · live (+ money) (+ security) (+ gated) | none |
| `vane.changes.measure` | Assess a deployed change against experiment or matched weekdays and coverage | AGENT-004 | standard | `POST /api/vane/agent/measure` foundation; positive verdicts incomplete |
| `vane.anomalies.pursue` | Investigate an alert and attach findings to its follow-up | AGENT-005 | standard | `POST /api/vane/agent/pursue` foundation |
| `vane.contacts.send` | Send a configured developer/marketer the evidence and due action | AGENT-005 | standard or external | none |
| `vane.briefs.generate` | Produce a weekly brief with exact figures and linked change drafts | AGENT-006 | standard | `POST /api/vane/agent/brief`; scheduled growth brief |
| `vane.briefs.dismiss` | Suppress an opportunity type while preserving evidence | AGENT-006 | standard | `POST /api/vane/agent/dismiss` |
| `vane.questions.ask` | Translate a question through the provider and return a validated query with exact figures | AGENT-007 | external (+ sensitive) | MCP `ask_question`; `POST /api/vane/ask` |
| `vane.questions.configure` | Change the site’s model-provider question setting | AGENT-007 | security | `POST /api/vane/ask-settings` |

**Resources.** `vane://site/{id}`, `vane://segment/{id}`, `vane://rollup/{id}`, `vane://goal/{id}`, `vane://funnel/{id}`, `vane://experiment/{id}`, `vane://annotation/{id}`, `vane://metro_table/{id}`, `vane://cutover_scan/{id}`, `vane://proxy/{id}`, `vane://search_connection/{id}`, `vane://outcome/{id}`, `vane://report/{id}`, `vane://delivery/{id}`, `vane://alert/{id}`, `vane://followup/{id}`, `vane://share/{id}`, `vane://client/{id}`, `vane://member/{id}`, `vane://key/{id}`, `vane://webhook/{id}`, `vane://export/{id}`, `vane://import/{id}`, `vane://proposal/{id}`, `vane://investigation/{id}`, `vane://change/{id}`, `vane://brief/{id}`, `vane://audit/{id}`. Primary records retain native site, client and role visibility; external, customer, imported, source and log text is marked untrusted. Resource links expose no credential and cannot extend record access.

**Events.** `site.changed`, `collection.changed`, `definition.changed`, `annotation.added`, `annotation.removed`, `import.changed`, `goal.conversions`, `traffic.alert`, `tracking.alert`, `follow.change`, `report.generated`, `delivery.changed`, `share.changed`, `membership.changed`, `credential.changed`, `source.synced`, `instrumentation.finding`, `change.published`, `change.measured`, `brief.generated`, `history.erased`. Record IDs and revision/cursor facts connect native actions, replay and webhook receipts; no event contains a visitor identity or secret.

**Prompts.** Check instrumentation (AGENT-001, IMPORT-008, CONV-009); explain a movement with disproof and unknowns (AGENT-002, REPORT-003); draft a growth change and assess its result (AGENT-003, AGENT-004, EXPERIMENT-001); pursue a silent-site alert (AGENT-005, FOLLOW-001); produce the weekly opportunities brief (AGENT-006); answer an aggregate analytics question with its exact query (AGENT-007, API-001).

**Not tools, and why.**

- An operation or installation fact: Worker ownership, scale, run-site publishing, licensing and local installation are deployment properties, not analytics jobs: HTTP-001, COLLECT-004, DEPLOY-001, HOST-002, OPEN-001, PRIVACY-004.

- A person’s interactive screen: public homepage/guides, Lobby sign-in, setup, demo and responsive/PWA presentation remain their native screens: RUNSITE-001, DOCS-001, HOME-001, LOBBY-001, DEMO-001, MOBILE-001.

- Device-only: script navigation/SPA instrumentation, live tab capture and native application/widget presentation execute on the device: INSTALL-007, HEAT-002, MOBILE-002.

- A connector: platform plugin/app/template installation stays with WordPress/WooCommerce, Shopify, Webflow/Squarespace/Wix/Pane/Stall and GTM respectively: INSTALL-002, INSTALL-003, INSTALL-004, INSTALL-005.

- The import door: history preview/apply/undo, full archives and restore, source-definition recovery, overlap/cut-over custody and local-to-Cloudflare move-in stay on that door: IMPORT-001, ARCHIVE-001, IMPORT-002, IMPORT-003, IMPORT-004, IMPORT-005, IMPORT-006, IMPORT-007, IMPORT-009, HOST-003.

- Served by the surface itself: role-exact native actions and transport boundaries are covered by SURFACE-001 and SURFACE-009; proposal preparation/application uses the typed job tools, with truthful person decisions covered by SURFACE-009: ACCESS-001, ACCESS-002, APPROVE-001, API-004.

Sign-in, a person's password/2FA entry, browser factor enrollment, explicit source-licence statements and outside provider consent/checkout ceremonies stay on their person's interactive screen; tools may carry a prepared payload and continuation reference, never fabricate those personal acts. CSV metro-name content is a typed setting payload, not a history import. Site archives, restore and recovered-definition move-in remain the import door even when status is readable as a resource. The Looker Studio application remains a connector over the query/export jobs.

**Limits.** Capacity limits include 100 Events API events/request, 30 event properties, 50 ecommerce lines, 2–8 funnel steps, 10 funnels and experiments/site, 50 saved segments/site, 500 sitemap pages/scan, and a 256 KB/1,000-row metro table. Existing Stats API limits are 30 requests/10 seconds and 600/hour/key; Events API limits are 100 requests/10 seconds and 10,000 events/hour/token; questions allow 60 attempts/site/hour. D1 capacity and the 80% warning remain disclosed. `/docs/agents` states registry request/response and cursor limits alongside these native limits. Business limits and spend caps are the company's policy.

**Handoffs.** Listen for connected deploy/release, Uptime maintenance/incident, Spool error and Mango campaign events as dated evidence; accept aggregate order/lead outcomes from configured Stripe, Shopify, WooCommerce, Stall, HubSpot, Orbit, Pencil and Dial connectors. Incoming sender names do not establish provider verification. Emit findings and change drafts to the configured website/repository tools, and report/alert/follow-up events to connected Nook, Slack, Teams and webhook consumers such as Crank. Adapter event names are translated to the typed events above; no neighboring product's unpublished event schema is assumed. A provider receipt proves only its stated acceptance, not deployment, delivery to a channel or causal improvement.

#### SURFACE-001 — The registry equals Vane's Agent surface

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-013

**Requirement.** Vane's registry contains exactly this table and these resource templates, events and specialist prompts. Typed jobs invoke the browser's native action services; legacy `/api/v1/mcp` is an alias of the inherited door, not a second authority path.

**Acceptance.**
1. Listing tools and resource templates returns exactly this area’s names, with Core mappings and class expressions equal to the table.
2. Discovery accounts for all 110 mapped Core clauses, including the non-tool reasons; native devices and the import door remain identifiable.
3. The browser and corresponding tools on one fixture produce equal site, segment, goal, annotation and follow-up records and native audit types.
4. Current and previous protocol clients discover the same registry through `/mcp` and the legacy alias.
5. On Vane’s fixtures the Base harness passes under the named All-autonomous company policy and the named Held company policy defined in SURFACE-013.

#### SURFACE-002 — Read analytics without inventing precision

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-006

**Requirement.** The measurement analyst queries the native report service with site-local dates, filters, imported-data choice and disclosed definitions. Aggregate resources preserve Vane’s no-person-history boundary.

**Acceptance.**
1. The same seeded DST week queried through stats, realtime and resource reads equals the native totals, bucket tables and comparison figures.
2. Consented and cookie-free figures, multi-site sums, revenue currency/rate gaps, source dates and unknown coverage retain the dashboard’s exact qualifications.
3. City/metro folding and owner-supplied names follow the selected visibility; no observed-place fallback or identifier leaks through the MCP result.
4. Performance, heat grids, journeys, funnels, experiment intervals and power warnings match their native report tables.
5. Internal stats reads declare standard with site and item count; reading recorded revenue and hosting estimates declares neither money nor sensitive.

#### SURFACE-003 — Collection and definition changes name the running service

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-012

**Requirement.** Collection, visitor, metric, goal, funnel, event, experiment and site tools change the same versioned native settings and annotate definition changes on their affected charts. Events use native ingestion semantics.

**Acceptance.**
1. Each site create/update, collection configure, visitor configure, goal/funnel/definition save, experiment save and heatmap configure call declares live with the affected service and path/site facts.
2. A replayed Events API batch counts each admitted event once, refuses undeclared personal fields and preserves consent, bot and exclusion reasons; the tool declares standard.
3. A visit-timeout change keeps earlier local days under their earlier definition and creates one dated annotation, including in a roll-up.
4. A stale configuration revision changes nothing; a repeated successful write returns its original receipt without a second annotation.
5. Changing the same metro table with public names off declares standard; publishing those names on the fixture’s public report declares external, public, with the exposure count. The typed payload cannot invent the owner’s source-licence statement.

#### SURFACE-004 — Inspect instrumentation and preserve source custody

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-009, BASE-AGENT-012

**Requirement.** Instrumentation tools compare declared goals and funnels with actual accepted payloads, sitemap findings and connected source diffs. Drafts preserve evidence; verification uses deployed pages and arriving events.

**Acceptance.**
1. Inspecting the fixture’s stored findings declares standard; requesting its registered public page adds external, known, and the contacted-host count; reading its authenticated repository adds security with credential kind. Public page inspection has no security class.
2. Install verification, cut-over scan, selector preview and deployed instrumentation verification each declare fixed external and name the destination and page count; redirects and body custody follow native boundaries.
3. A renamed signup control and missing script produce evidence-linked fix drafts; a complete site scan still cannot claim observed JavaScript execution or visitor coverage it did not measure.
4. After the fixture deploy, verification observes new real accepted events, adds exactly one recovery annotation and does not call an unconfirmed draft PR deployed.
5. An uncertain GitHub mutation is reconciled by receipt/source reads and is not replayed as a second PR.

#### SURFACE-005 — Connect sources without confusing access with evidence

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-004, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-009

**Requirement.** Connections use existing provider accounts and native scoped credentials. Search, advertising and outcome sync keep independently labelled aggregates and the minimum permitted outbound payload.

**Acceptance.**
1. For search and advertising connect, outcomes connect, channels connect and proxy connect, the fixture without a provider ceremony has no gated class; the same call receiving provider-required consent carries gated with provider and step and a continuation reference.
2. Source connect on a local evidence sender declares access and security without external; connecting the fixture repository adds external, known, and a required provider consent response adds gated. No personal secret or code is an argument.
3. Search, advertising and outcome sync declare external and security; refunds received as evidence change no charge and do not add money.
4. On the same connected fixture, search/channel/source/proxy disconnect with local credential deletion has no external class; requesting remote revocation adds external and its provider recipient facts.
5. Connect, rotate and disconnect in each of the proxy, search, advertising, outcome, channel and source families declare access direction and security setting. A call in any such family widening its sponsor’s or agent’s own authority is refused under every company policy.
6. Provider snapshots remain source-labelled, missing dates remain unknown, disconnected credentials vanish from custody, and no source claim establishes independently confirmed orders without a real outcome receipt.

#### SURFACE-006 — Deliver reports and follow anomalies to outcomes

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-008, BASE-AGENT-010, BASE-AGENT-012

**Requirement.** The analyst schedules period-correct reports, sends through native delivery services, investigates alerts and records follow-up evidence. Recipient identity, quiet hours, cooldowns and uncertain receipts remain native facts.

**Acceptance.**
1. On one report fixture, local-outbox delivery to the business team declares standard; replacing the recipient with its recorded outside client declares external, known, one recipient; an unseen address declares external, new, one recipient.
2. The same local-outbox-versus-client fixture for alerts, follow-up reminders and contact messages gives the same class split and recipient facts, including an outside developer contact.
3. Across the DST boundary, a weekly report matches the native saved segment and explanation and has one period receipt with the configured local send hour.
4. A silent-template alert creates an item, pursuit attaches movement evidence, and explicit acknowledge/assign/comment/resolve jobs retain actor, outcome, due times and history.
5. A failed delivery stays uncertain or failed as its native receipt states; it cannot close a follow-up or assert that a person read a report.

#### SURFACE-007 — Expose only the selected reports and branding

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-003, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-012

**Requirement.** Shared links, public reports, branding and warehouse/webhook deliveries retain their native content scopes. Public exposure is computed from current visibility and the proposed difference.

**Acceptance.**
1. Creating a bearer shared link declares fixed external with public counterparty and the exposure count; link revocation declares standard and ends access without changing membership.
2. On the same publication fixture, withdrawing a public report declares standard, and publishing selected reports declares external, public, with its audience facts; no unselected report becomes visible.
3. Applying the same client logo privately declares standard; exposing it on the fixture’s existing public report declares external, public. The logo conveys no additional report access.
4. Warehouse send and signed webhook deliver declare fixed external and security; their payloads match the native anonymous schema and omit visitor hashes, secrets and raw source bodies.
5. An expired or revoked share cannot read reports, and an internal reader never receives another client’s resource or private source report through an embed.

#### SURFACE-008 — Erase with the same custody and deletion fences

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-009, BASE-AGENT-012

**Requirement.** History, site deletion and retention apply Vane’s native deletion journal and archive fence. A prepared erasure and a retention-window choice do not erase anything.

**Acceptance.**
1. Erasure prepare and retention set declare standard and leave event counts unchanged; erasure apply, retention apply, segment delete and annotation delete declare fixed destructive with exact affected-item counts.
2. Site delete declares destructive and live, removes history and site routing and retains the native deletion fence and audit without the erased payload.
3. After erasure, an older archive is refused by the import door; agent-origin deletion cannot bypass the same fence.
4. The same erasure idempotency key yields one journal receipt, and a stale expected revision erases nothing.
5. Keep-forever retention erases zero items, while the configured bounded cutoff deletes only older custody and records that cutoff.

#### SURFACE-009 — Authority mutations stay within the sponsor’s native role

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-004, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-008, BASE-AGENT-009

**Requirement.** Vane’s roles, site scopes, client membership and integration credentials are native targets of access/security jobs. Typed job application records any actual person decision separately from agent preparation; no tool manufactures the source-licence statement or an ownership-transfer confirmation.

**Acceptance.**
1. Member invite/update/remove and client assignment declare access with people, sites and widening/narrowing direction; on one invitation/client fixture an internal member has no external class, while adding an outside client adds external, known, one recipient.
2. Key issue/revoke, SCIM issue/revoke, annotation credential issue/revoke, warehouse connect/disconnect and webhook create/revoke declare both access and security with target scope and credential kind.
3. In each member, client, key, SCIM, annotation credential, warehouse and webhook family, a call widening the sponsor’s or agent’s own authority is refused under every company policy, including ownership transfer to either of them.
4. Security configure and question configure declare fixed security with the changed setting; attempts to use either to widen sponsor/agent authority are refused under every company policy.
5. Removal or site-scope narrowing ends resource, event and API access at the next request; a client-assignment tool cannot confer visibility beyond the sponsor’s sites.
6. When a person records a proposal decision or ownership confirmation on the native screen, the receipt names that person and the agent as preparer only where it prepared the payload.

#### SURFACE-010 — Publish improvements with measured spending facts

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-009, BASE-AGENT-012

**Requirement.** Change tools keep expected effect, measurement and guardrails beside the exact revision shipped. A repository draft PR, deployed website change and actual advertising spend change are distinct typed targets of publication, not equivalent success states.

**Acceptance.**
1. Publishing the fixture’s draft PR declares external and security without live or money; publishing its website CTA declares external and live; publishing its ad-budget change adds money with USD amount/delta, period and provider.
2. Reverting that fixture’s CTA declares external and live without money; reverting its ad-budget revision also declares money with the resulting amount and counterparty.
3. On the same publish/revert fixture, a public unauthenticated target adds no security; its credentialed target adds security. A provider-required personal terms/verification response adds gated with provider and step; the same completed-provider operation has no gated class.
4. Drafting a proposed budget remains standard; reading its projected return cannot convert it into a charge or confirmed lift.
5. A publication or revert targeting authority beyond the sponsor’s role changes nothing; it cannot widen its own connection, deploy grant or provider scope under any company policy.
6. Measurement reads a confirmed deployment, compares matched weekdays or experiment intervals and coverage, and returns inconclusive where consent or sample changes preclude a verdict; each actual shipped change has one dated annotation.

#### SURFACE-011 — Questions and briefs retain exact native evidence

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-006, BASE-AGENT-009

**Requirement.** Plain-English questions use the deployment Base AI query-plan path, while movement explanations and weekly opportunities remain grounded in native figures. None invents a causal claim from a correlation.

**Acceptance.**
1. On one question fixture, ordinary aggregate question text sent to the model declares external without sensitive; substituting a health fact or bank number adds sensitive with its actual kind and record count before egress. An email address remains a native refusal, not an extra collection permission.
2. Numeric answers equal the exact validated Stats API query returned beside them; ambiguous input returns a choice and unsupported coverage returns its honest reason.
3. Movement hypotheses carry denominators, source provenance, confidence, disproof and unknown dates, and list every dated annotation in the window.
4. A seeded weekly brief produces three to five evidenced opportunities and linked local change drafts; dismissing one type suppresses it next week while preserving the historical evidence.
5. Question attempts follow the native shared rate limit and text-free audit; no raw question or model response becomes an audit resource.

#### SURFACE-012 — Follow native changes with durable record links

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-003, BASE-AGENT-009, BASE-AGENT-010, BASE-AGENT-012, BASE-AGENT-013

**Requirement.** Vane’s typed event records connect site revisions, investigations, reports, delivery receipts, follow-up work and changes without leaking visitor identities or treating untrusted evidence as instructions.

**Acceptance.**
1. An event-list cursor and signed webhook on the same fixture identify the same report, alert and follow-up changes; replay preserves IDs and order without redelivering a mutation.
2. Revoking site/client access removes the corresponding events and resource links on the next read, including links inside older investigation results.
3. Imported notes, customer messages, repository content and delivery-log text are marked untrusted; injected instructions cannot change recipients, settings or class facts.
4. All primary resource templates return the sponsor’s native fields; a restricted record is indistinguishable from a missing record.
5. The generated `/docs/agents` describes these fixture journeys, resource/event payloads and capacity limits from the registry without claiming an absent provider integration exists.

#### SURFACE-013 — The measurement analyst completes a seeded business week

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-AGENT-011, BASE-AGENT-013

**Requirement.** A stranger agent discovers Vane through MCP with no installation knowledge and runs a seeded week for a named, appropriately scoped marketing lead under two complete company policies.

**Acceptance.**
1. The agent discovers sites, diagnoses broken instrumentation, explains movement with unknowns, drafts a CTA and budget, sends the report, pursues the alert, verifies recovery and measures the result.
2. Under the named All-autonomous company policy, every class is autonomous; the seeded week completes without a person, including credentialed provider fixtures with no outstanding personal ceremony, public reporting, the spending change and retention.
3. Under the named Held company policy, standard is review and every other class is approval. Standard work produces its review record; each other call waits for the policy’s person decision, a denied call changes nothing, and an approved call executes exactly once.
4. The Held run denies the ad-budget proposal and permits the instrumentation fix and client report; the week’s brief records the unshipped budget, confirmed fix, delivery receipt and coverage-qualified result with distinct shipped outcomes.
5. Both runs exercise internal/external recipients and publication, authenticated/public source and publish targets, provider continuation present/absent, question text with/without regulated data, and draft PR versus website/ad spending changes; the reported class facts match SURFACE-003 to SURFACE-011.
6. Both runs preserve truthful attribution and refuse own-authority widening; a person sets policy and Pause, and Pause stops queued and in-flight work before its next effect.

## Status rows

| Clause | Title | Kind | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| `SURFACE-001` | The registry equals Vane's Agent surface | target | missing | | The registry and Vane fixture conformance are not built. |
| `SURFACE-002` | Read analytics without inventing precision | target | missing | | Role-exact analytics resources through the new registry are not built. |
| `SURFACE-003` | Collection and definition changes name the running service | target | missing | | Typed collection and definition tools under company policy are not built. |
| `SURFACE-004` | Inspect instrumentation and preserve source custody | target | missing | | Instrumentation jobs on the shared agent registry are not built. |
| `SURFACE-005` | Connect sources without confusing access with evidence | target | missing | | Classified connection and sync tools are not built. |
| `SURFACE-006` | Deliver reports and follow anomalies to outcomes | target | missing | | Policy-governed report and follow-up tools are not built. |
| `SURFACE-007` | Expose only the selected reports and branding | target | missing | | Computed exposure and typed publication tools are not built. |
| `SURFACE-008` | Erase with the same custody and deletion fences | target | missing | | Idempotent erasure tools on the new registry are not built. |
| `SURFACE-009` | Authority mutations stay within the sponsor’s native role | target | missing | | Native authority tools with self-widening checks are not built. |
| `SURFACE-010` | Publish improvements with measured spending facts | target | missing | | Classified publication, revert and spend facts are not built. |
| `SURFACE-011` | Questions and briefs retain exact native evidence | target | missing | | Classified question and brief tools are not built. |
| `SURFACE-012` | Follow native changes with durable record links | target | missing | | The complete typed change feed and resource links are not built. |
| `SURFACE-013` | The measurement analyst completes a seeded business week | target | missing | | The two-policy stranger-agent business week is not built. |
