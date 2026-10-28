# Vane rulings

Each ruling below shaped a clause of CONTRACT.md. The clause states the outcome; the ruling states why. RL-1 to RL-9 were moved verbatim out of the contract text and its Status Gap cells in the 28 October 2026 contract cleanup; ct's own ruling pass numbers its entries from RL-101 and they are copied verbatim from ct's rulings file (read-only main `117e494724bb9b02f904f2f3892a69354fb9cd16`, 28 October 2026, no status changes).

### RL-1 — No bundled DMA metro names

*Date:* 20 October 2026 · *Ruled by:* ct · *Governs:* DASH-015, DASH-016

By ct ruling (20 October 2026) Vane ships no DMA code-to-name table, pinned or fetched, because no published source licenses one for this MIT repository (`SOURCES.md`): names come only from the site's own metro-name table, a site setting holding no visitor data.

### RL-2 — Heatmaps are off by default and owner-only

*Date:* 22 October 2026 · *Ruled by:* ct · *Governs:* HEAT-001

Approved defaults (ct 22 October 2026): heatmaps are off until the owner explicitly enables an audited exact primary-origin path; only the owner reads the maps.

### RL-3 — Sign-in, SSO and SCIM authority

*Date:* 22 October 2026, 12:30Z · *Ruled by:* ct · *Governs:* TEAM-002, TEAM-003, TEAM-004

The ct-approved authority rules (22 October 2026, 12:30Z) are: installation-owned provider bindings and explicit SAML/Entra subject associations admit native accounts. SCIM creates a native zero-site Viewer and a federation binding by issuer and subject, never an email merge or site grant; only an owner subsequently grants sites. SCIM never raises a role, reactivates an owner-removed or deactivated person, touches an owner or sends invitation mail. Its credential is owner-issued, shown once, stored hashed, scoped to SCIM only, rotatable and revocable with audit. Deactivation ends sessions, API keys and push tokens at the next request and is idempotent; replayed or out-of-order calls change nothing twice. SSO and TOTP are off by default, owner-proved, audited and enforced for owners and existing sessions at the next request. The documented owner break-glass uses a fresh deployment-issued `rer signin` link, preserves any enrolled or required second step, disables SSO explicitly with audit, and is never SCIM-reachable. Credentials and factor proofs are excluded from analytics archives.

Existing fixture proof remains valid; TEAM-002 stays PARTIAL under the ct ruling of 22 October 2026 12:30Z.

### RL-4 — GitHub authority for instrumentation fixes

*Date:* 22 October 2026 · *Ruled by:* ct · *Governs:* AGENT-001

Implemented conservative default for GitHub authority, ct approved as adopted with riders, 22 Oct: off until explicit audited owner consent; one repository/base and mapped templates; a GitHub App installation or fine-grained token restricted to contents and pull requests on the mapped repository (no administration, actions/workflows write or secrets), sealed with AES-GCM and excluded from archives; read-only source/diff bodies kept only in memory; normal version-bound approval of the exact diff hash (any diff change voids approval) plus a separate explicit owner action before any script-only HTML draft PR; one PR per approved fix on a namespaced Vane branch only, no force push, never a base/default-branch update, merge or deploy; revocation or an ownership change blocks further source reads/writes, a new owner reconnects explicitly, and uncertain outcomes reconcile read-only. CI/workflow files, deploy config, dependency manifests and secret-bearing paths require the owner to change them by hand and never enter an agent PR. `.env` and key-like paths are never read.

GitHub source authority: ct approved as adopted with riders, 22 Oct.

### RL-5 — Owner-only movement investigations and sender aggregates

*Date:* 22 October 2026 · *Ruled by:* ct · *Governs:* AGENT-002

Implemented conservative default, ct approved as adopted with riders, 22 Oct: investigations are explicit and owner-only; native aggregate figures, finalized search records and dated annotations stay in this installation and no model is called. Incoming anonymous daily order/attempt, checkout-error/request and availability-failure/check aggregates are off until the owner explicitly approves a site-scoped, shown-once SHA-256 sender credential. Only bounded daily aggregates are accepted, never anything finer; a sender credential writes only its own site's rows, and rotation or revocation stops new rows at once. Credentials grant no native/API/annotation authority and never travel in archives. These are sender-reported figures, labelled sender-reported in every explanation that uses them, not independently provider-verified outcomes or identity matches. Confidence is a qualitative evidence grade and scores only order hypotheses, never causal probabilities. Missing dates are unknown, never zero. Imported history is not treated as native arrivals; it stays source-labelled in ordinary reports and outside native-arrival hypotheses until its coverage is established. CONV-008, ADS-001, AGENT-003 and AGENT-005 inherit evidence provenance, missing-coverage and non-causality obligations before extending these sources or acting on a hypothesis.

Owner-only, local-only investigation and off-default incoming anonymous daily aggregates: ct approved as adopted with riders, 22 Oct.

### RL-6 — Plain-English questions landed with riders

*Date:* 22 October 2026 · *Ruled by:* ct · *Governs:* AGENT-007, AGENT-008

Approved as landed with riders (ct 22 October 2026): questions are off until the owner turns them on for a site (audited); only the question text, Vane's own metric, breakdown, filter and period names, the site's goal names, time zone and today's date go to the deployment's model provider (Base `ai` module, `AI_ENABLED`), never a stored Vane analytics figure, visitor field or page value; the model only proposes a Stats API query, which Vane validates against that API's vocabulary, refuses without repair when it does not fit and runs itself; Vane stores no question, model reply or answer; every question attempt, including refused email, over-limit and unrunnable-plan attempts, counts toward the 60-per-hour site limit and is audited by actor and time without text. Email addresses are refused before provider egress.

Ct approved as landed with riders 22 Oct.

### RL-7 — Owner-entered endpoints need resolved-address, pinned egress

*Date:* 19 October 2026, 20:44Z · *Ruled by:* ct · *Governs:* IMPORT-005, REPORT-002

required by ct 19 Oct 20:44Z for the owner-entered endpoint before DONE.

### RL-8 — The divergence alert waits for the outcome sources

*Date:* before 26 October 2026 (ct scope-review-51) · *Ruled by:* ct · *Governs:* ALERT-002, CONV-008

Future CONV-008 carries browser-versus-confirmed divergence before its outcome sources ship, under ct scope-review-51; the full acceptance remains unchanged.

### RL-9 — Cut-over dates and live days in imports

*Date:* 21 October 2026, 18:20Z · *Ruled by:* ct · *Governs:* IMPORT-007

(ct 21 Oct 18:20Z, following IMPORT-005)

### RL-101 — Propose and ship a site or campaign change under granted authority

Date: 2026-10-28 · Ruled by: ct · Governs: `AGENT-003`.

**Question.** May Vane keep the current agent surface local and draft-only until an exact current shipping grant exists?

**Proposed/adopted default.** Owner-only local expected-effect/guardrail/measurement drafts, no new outbound grant and all shipping refused; prior instrumentation GitHub grant unchanged.

**Outcome: adopt with rider.** Approve local owner-authorized proposals that create no outbound deployment or campaign authority; shipping requires an explicit current destination/action grant and the required exact human approval, with revocation checked before the effect.

**Why.** No common norm established for autonomous site changes, causal verdicts or follow-up closure. Current main replaces incumbent names with generic categories, so no identifiable first-named vendor can be asserted. The contract’s plausible()/fathom.trackEvent() compatibility names support comparing Plausible and Fathom: their documented analytics/annotations and configured reporting do not establish autonomous deployment, rollback or case closure. Conservative local work is therefore the chosen default while the full agent target remains required.

**Rider.** Retain the complete Pane edit, general title/redirect PR, actual deployed redirect and shipped annotation acceptance. A draft is never labelled shipped; spend and material copy need the stated human decision, and no launch or spending authorization is created by this ruling.

**Place once.** AGENT-003 owns its one agent-action acceptance point; shipping/revert uses the existing shared agent grant rule, and contact uses ALERT/FOLLOW duties.

**Incumbent/source behavior.**

- [Plausible documents analytics, comparisons, installation and annotations, without an autonomous website deploy/revert authority.](https://plausible.io/docs)
- [Fathom configures explicit report recipients and selected sites on a chosen cadence; this is not an autonomous remediation grant.](https://usefathom.com/docs/features/email-reports)

**Engineering/proof distinction.** Missing Pane edit/revert capability is a sibling engineering dependency; deployed effects and measured outcome/coverage proof remain required. Actual launch/spend decisions remain owner-reserved where applicable.

Main reference: `CONTRACT.md:303` at `117e494724bb9b02f904f2f3892a69354fb9cd16`; current Status Gap read in full. Route: `round`.

### RL-102 — Measure the result against coverage gaps

Date: 2026-10-28 · Ruled by: ct · Governs: `AGENT-004`.

**Question.** May result analysis withhold positive conclusions and all automatic reverts until coverage and current revert authority are proved?

**Proposed/adopted default.** No automatic revert and no new grant; verified deployed change, matched weekdays and existing intervals required; observed coverage changes withhold positive verdicts.

**Outcome: adopt with rider.** Approve evidence-bound result analysis with stated comparison/experiment intervals, explicit coverage and sample limitations, and no page revert without the exact current destination grant and human approval.

**Why.** No common norm established for autonomous site changes, causal verdicts or follow-up closure. Current main replaces incumbent names with generic categories, so no identifiable first-named vendor can be asserted. The contract’s plausible()/fathom.trackEvent() compatibility names support comparing Plausible and Fathom: their documented analytics/annotations and configured reporting do not establish autonomous deployment, rollback or case closure. Conservative local work is therefore the chosen default while the full agent target remains required.

**Rider.** Retain all four required verdicts, positive experiment lift, consent-drop/inconclusive assessment and actual approved revert. A local refusal test cannot substitute for these journeys; a prior shipping grant does not imply an unbounded revert capability.

**Place once.** AGENT-004 owns its one agent-action acceptance point; shipping/revert uses the existing shared agent grant rule, and contact uses ALERT/FOLLOW duties.

**Incumbent/source behavior.**

- [Plausible documents analytics, comparisons, installation and annotations, without an autonomous website deploy/revert authority.](https://plausible.io/docs)
- [Fathom configures explicit report recipients and selected sites on a chosen cadence; this is not an autonomous remediation grant.](https://usefathom.com/docs/features/email-reports)

**Engineering/proof distinction.** Missing Pane edit/revert capability is a sibling engineering dependency; deployed effects and measured outcome/coverage proof remain required. Actual launch/spend decisions remain owner-reserved where applicable.

Main reference: `CONTRACT.md:305` at `117e494724bb9b02f904f2f3892a69354fb9cd16`; current Status Gap read in full. Route: `round`.

### RL-103 — Pursue anomalies to resolution

Date: 2026-10-28 · Ruled by: ct · Governs: `AGENT-005`.

**Question.** May anomaly pursuit keep work open and make no autonomous contact or closure in the current local component?

**Proposed/adopted default.** Owner-requested movement investigation, evidence attached to existing follow-up, no new outbound contact or automatic closure, person resolves.

**Outcome: adopt with rider.** Approve local evidence-first anomaly pursuit with human-confirmed closure only; future bounded configured contact and verified-recovery closure must use explicit current authority and prove intact measurement coverage.

**Why.** No common norm established for autonomous site changes, causal verdicts or follow-up closure. Current main replaces incumbent names with generic categories, so no identifiable first-named vendor can be asserted. The contract’s plausible()/fathom.trackEvent() compatibility names support comparing Plausible and Fathom: their documented analytics/annotations and configured reporting do not establish autonomous deployment, rollback or case closure. Conservative local work is therefore the chosen default while the full agent target remains required.

**Rider.** Retain the required developer contact, due reminder and verified event-recovery closure under owner-selected channels/schedule. A new contact needs configured audience and cadence, not inferred marketing permission, and traffic reduction alone never proves repaired instrumentation.

**Place once.** AGENT-005 owns its one agent-action acceptance point; shipping/revert uses the existing shared agent grant rule, and contact uses ALERT/FOLLOW duties.

**Incumbent/source behavior.**

- [Plausible documents analytics, comparisons, installation and annotations, without an autonomous website deploy/revert authority.](https://plausible.io/docs)
- [Fathom configures explicit report recipients and selected sites on a chosen cadence; this is not an autonomous remediation grant.](https://usefathom.com/docs/features/email-reports)

**Engineering/proof distinction.** Missing Pane edit/revert capability is a sibling engineering dependency; deployed effects and measured outcome/coverage proof remain required. Actual launch/spend decisions remain owner-reserved where applicable.

Main reference: `CONTRACT.md:307` at `117e494724bb9b02f904f2f3892a69354fb9cd16`; current Status Gap read in full. Route: `round`.
