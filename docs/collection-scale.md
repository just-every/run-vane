# Collection scale: implementation and proof

COLLECT-004 remains **NOT PROVEN**. The full 120-million-pageview journey has
not passed at an exact candidate SHA. Acceptance still requires genuine admitted
pageviews, the measured burst, complete dashboard latency and measured capacity.
The implementation and smaller runs do not establish those results.

## Lossless compact raw storage

The deployment uses the existing `DB` D1 binding. `vane_events` is a logical view
of compact physical tables, preserving every accepted pageview and goal with its
original ID, fields and timestamp. There is no occurrence multiplier or change
to sampling, identity scope or retention.

- `vane_raw_sites` maps each existing site UUID to a local integer.
- `vane_raw_identities` stores the full existing SHA-256 visitor digests as
  32-byte values, referenced by local integers. Historical non-hex values retain
  their exact text.
- `vane_raw_contexts` shares exact combinations of site, local date, event kind,
  declared dimensions, visitor references and consent issue/expiry times.
- `vane_raw_events` keeps one physical row per occurrence. Canonical UUIDs use
  their exact 16 bytes with any goal suffix preserved; historical noncanonical
  IDs retain exact text. Each event retains its timestamp as an exact offset
  from its context date and a derived visit reference.
- `vane_raw_details` holds optional engagement, scroll and performance values
  for the individual occurrence.

Sharing repeated context values reduces storage without merging occurrences.
Retention and erasure remove the actual rows and their analytical contributions;
unused contexts and dictionary entries disappear with their last supporting row.
Raw history remains authoritative.

## Exact analytical readers

Occurrence cells group native events by site, local date, event kind and declared
dimensions. Reference-counted identity sets keep range and dimension uniques
exact: a consented digest counts once per site across dates, and an unconsented
digest once per site/date. Repeated matching events increase counts rather than
add another identity. Maintenance shares the raw write's transaction, so a
rejected transaction changes neither raw history nor its derived results.

These readers supply native counts, dimension and goal groups, transport shares
and nonhourly occurrence series. Report readers combine the exact visible import
rows. Whole dates include events already admitted today. Occurrence source groups
alone are not visit attribution; visit readers supply that separately.

### Visits and performance

`vane_raw_events.visit_id` records visit membership without a second occurrence
table. `vane_visit_facts` stores visit endpoints, identity and additive counts.
Page frequencies preserve actual multiplicities by visit, raw context, exact time
on page and scroll depth. Duration frequencies and day totals support overview
metrics; performance value frequencies retain exact nearest-rank percentiles and
measured-page counts. Frequency counts represent real occurrences, not synthetic
weighted admissions.

These materializations answer unfiltered native whole-day visit, entry/source
attribution, page, duration, bounce, series and performance queries. Grouped page
rows deduplicate visits under the existing page-row definition. Selected goals
and report-currency revenue still read actual goal/custom occurrences, so late
goals and approved exchange-rate changes remain visible.

Ordinary append and late insertion update affected page contributions; a bridge
merges real visits and their membership. Deletion, sequence rewrites and dated
visit-timeout changes can invalidate a site/day/visitor chain. Before a
materialized visit reader returns, `refreshVisitFacts` rebuilds invalid chains
atomically. Clean chains do not scan raw page history during a read.

Hostname restrictions, partial historical cutoffs and kept-visit/segment/search
filters can change the event sequence. They keep reconstruction over the actual
restricted raw set. Arbitrary cohorts, funnels and journeys retain their existing
calculations. Hourly occurrence buckets still use timed raw events, while native visit buckets use materialized visit facts. No query error selects a
fallback or a stale result.

### Archives and privacy

History archives and site transfers carry logical events, not compact physical
tables, local raw row keys or derived `vane_visit_*` tables. Restore assigns fresh
physical keys from the original logical records and rebuilds derived facts.
History restore retains the logical view and physical maintenance triggers and
rebuilds both occurrence analytics and visits in its atomic batch. Older archives
remain rebuildable from their raw rows; copied analytical tables are not trusted
as authoritative history.

The inventory declares the physical fields and existing daily/site-scoped digest
semantics. Packing a digest adds no collected identifier. Identity references do
not enter anonymous aggregate CSV data, and history archives retain their
owner-only controls.

## Native batch admission

`POST /api/vane/collect-batch` accepts exactly `{"events":[PAGEVIEW,...]}` with
1–100 ordinary collector records, each with its normal `siteId` and event UUID.
The complete UTF-8 body is limited to 65,536 bytes (64 KiB); each serialized record
has the ordinary 8,192-character bound. Registered origins, collection settings,
consent and anonymous field rules apply to every record. The HTTP request supplies
the actual shared visitor metadata; payloads cannot supply trusted IP, user-agent
or Cloudflare fields.

Validation is all-or-nothing and identifies a refused record by its zero-based
`index`. Such failure creates no pageview, goal, property or visitor salt; existing
exclusion counters may record the refusal. DNT/GPC requests are refused, and
field-free signal/declined/ignored requests remain separate doors.

After validation, one D1 batch rechecks site versions and ID compatibility and
atomically commits admission and dependent writes. Each new raw row gates only
its own goals, properties and counters. Compatible concurrent replays and repeated
IDs within a batch admit one pageview and acknowledge the repeats. Database
failures remain failures.

Success is HTTP 202 with `atomic: true`, an `accepted` count of newly admitted
records and ordered `results`. A new result has status 202 and `accepted: true`;
a compatible duplicate has status 200, `accepted: true` and `duplicate: true`.
The ordinary `/api/vane/collect` payload and response stay unchanged. Batching
shares transport and transaction overhead; every pageview remains a real row with
its own UUID. Authenticated Events API budgets remain unchanged.

## Real-volume journey

The explicit `Collection scale` workflow builds the candidate SHA and runs
`tests/collection-scale.journey.mjs` outside push Verify. It creates sites through
owner approval, admits 10,000 ordinary records through native batching and crosses
the old daily ceiling with a new single-collector record. It races sixteen copies
of one ID and checks later replay. Native batches offer 510 genuine events/second
so actual dispatch and completion must each reach at least 500 events/second.
Each batch member retains its own UUID and raw row.
Monthly volume uses the native batch collector with ordinary individual UUIDs,
spread across 28 real dates in each requested month. Database inspection checks
custody; it never inserts raw rows, counters or rollups directly.

Default acceptance input is 10,000,000 pageviews in each of 12 months, plus the
daily-ceiling and burst probes. Both a complete public summary and dashboard HTML
response must arrive under two seconds, with known totals and breakdowns. The
journey checks actual stored rows and distinct IDs, and records the SHA, admission
count, burst timing, report timings and actual store size/limit. This uses the
real built Worker and local D1 runtime on the remote GitHub runner. Deployed
Cloudflare acceptance requires separate evidence.

Smaller explicit `monthly_pageviews` / `months` inputs are **SMOKE ONLY**. The
10,001-event and paced-burst probes still run. Run expensive journeys through the
committed-SHA remote workflow or the prescribed heavy-slot wrapper, never directly
on the shared Mac. The RETENTION-002 public journey in
`tests/vane-report-settings.mjs` covers the 80% warning threshold, both required
choices and continued admission.

## Capacity remains workload-dependent and unproven

The former estimate based on three repeated text values does not describe this
compact representation. It also cannot establish the new representation's
capacity. Distinct visitors, contexts, visits, durations and scroll/performance
values may share little; cells and identity sets have workload-dependent
cardinality. Measure all physical raw tables, both raw indexes and derived tables
with headroom against the declared D1 limit.

No successful exact-SHA 120M run is claimed here. Capacity, runner duration or
complete-report latency may still fail at full volume. Preserve that evidence;
do not lower acceptance counts, raise the published storage limit, shorten an
owner's 13-month or unlimited retention, prefill summaries or describe smoke
results as full-scale proof. Scheduled S3/R2 warehouse export remains an outbound
CSV path; export alone does not supply a warehouse-backed dashboard reader.
