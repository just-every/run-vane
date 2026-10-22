# Investigate why numbers moved

Open **Coverage** in a site's report and use **Investigate why numbers moved**. Only the owner can run or read an investigation. Choose two non-overlapping windows of equal length, from 1 to 31 ended local days. Today is incomplete and is refused. Investigations use stored aggregate reports and make no model or provider request. No figure, annotation or visitor field leaves this installation.

The result separates tracking coverage, channel mix, page behavior and external events. Every supported hypothesis names its evidence, the current and compared numerator and denominator, qualitative confidence, limitations and the observation that would weaken or disprove it. Unknown prior figures display as **unknown**, never zero. All dated annotations in the investigated window are included. US observed federal holidays are calendar context; they do not establish seasonality for this site's audience.

Ranking is deterministic evidence ordering, not a causal model or a probability. Direct in-window instrumentation observations score 100, corroborating reported checkout-error/completion-rate changes 98, consent/refusal coverage changes 95, finalized query ranking/click changes 85, native loss with steady reported order rates 80, tracked funnel completion changes 60, reported availability failures 50, source contributions 35, slow measured LCP 20 and dated incident/campaign overlap 10. A score is not shown as a confidence percentage. Evidence can support several competing hypotheses. Correlation never proves causality.

A Google query candidate requires finalized dates in both windows, fewer clicks and an impression-weighted position more than two places worse. Google uses Pacific dates and source-limited query rows; native reports use the site's zone. Funnel candidates compare reached-final / entered visits and need a drop greater than 15 percentage points. Slow LCP is a current p75 above 2500 ms over measured page loads, with its prior value explicitly unknown. A collection-refusal candidate needs at least 10 refusals and more than twice the comparison count; these are server refusals, not browser execution errors. A consent candidate requires unsampled required-consent collection and the enabled declined counter, with accepted / (accepted + declined) less than half the compared share. Current settings do not prove historical settings.

## Optional incoming aggregate evidence

In Settings, explicitly approve **Incoming aggregate evidence**. The credential is generated once, shown only in that response and stored only as SHA-256. It grants only receipt of this site's anonymous daily aggregates, never native sign-in, Stats API, annotations or changes to any site. Rotate it to revoke the old credential immediately; revoke it to stop receipt. No credential is in an archive or site transfer.

Your sender posts JSON to `POST /api/vane/agent-evidence`, using this credential as a Bearer token. This is an inbound-only flow: Vane never calls the sender or fetches an evidence URL. The fixed fields are:

| Field | Meaning |
| --- | --- |
| `siteId`, `day` | This site and its ended/local date (ISO date; today may be updated, future dates refused) |
| `metric` | `orders`, `checkout-errors` or `uptime-failures` |
| `numerator` | Completed orders, failed checkout requests or failed availability checks |
| `denominator` | Checkout attempts, total checkout requests or completed availability checks |
| `revision` | Positive integer increasing when correcting that metric/date |
| `url` | Optional https evidence link; credentials refused, query/fragment removed and personal path segments redacted |

Counts are whole numbers from 0 through 1,000,000,000 with numerator no larger than denominator. No order, customer, event or visitor ID is accepted. Each metric/day has one current revision: equal repeats do not add counts, conflicting equal revisions are refused and older revisions never replace newer ones. At most 60 changed aggregates are accepted per site/hour. Erased dates and dates outside the site's retention cannot be reintroduced.

The credential authenticates **your sender**, not the provider or truth of its figures. Vane labels these as sender-reported aggregates, not independently verified Stripe, Shopify, CRM, Spool or Uptime evidence. Each compared metric needs every daily aggregate in both windows; missing dates remain unknown rather than zero. An order-completion rate and a checkout-error rate moving in opposite directions corroborate a checkout-failure hypothesis, with those provenance limits stated.

The owner-only native doors are `POST /api/vane/movement` with `siteId`, `from`, `to`, `comparedFrom`, `comparedTo`; `GET /api/vane/movement?siteId=…` for ten recent investigations; `POST /api/vane/movement-evidence/settings` with `siteId`, `enabled` and explicit `confirm: "on"` to enable; and `GET /api/vane/movement-evidence?siteId=…&from=…&to=…` to inspect aggregate source receipts. Native POSTs require a same-origin owner session. These are separate from the inbound sender door.

Investigations and evidence travel in whole-installation archives; credentials and pending authority do not travel in per-site transfers. History erasure removes derived reports and source rows, and retention removes reports overlapping erased current or compared dates. Audit rows keep action/actor/time and record references only.

AGENT-002 remains PARTIAL. The owner-only local investigation and incoming aggregate authority are conservative defaults adopted pending ct. CONV-008 independently verified outcome reconciliation, ADS-001 ad-spend reads, numeric Mango sends, measured blockers/browser errors, comparable historical consent settings and established seasonality remain unproved. Missing coverage is never ranked as a cause, and these reports never authorize an outbound or destructive action.
