# Collection scale: implementation and proof

COLLECT-004 is not established by the existence of this workflow or schema.
Its full acceptance needs an exact-SHA successful run with real admitted
pageviews, the measured burst, complete dashboard latency and capacity proof.

## Analytical foundation

`0085_analytics.sql` maintains native occurrence cells, grouped by site, local
date, event kind and the declared event dimensions. A separate reference-counted
identity set makes range and dimension uniques exact: a consented digest counts
once per site across dates, and an unconsented hash counts once per site/date.
Repeated events with the same dimensions and identity increase reference counts,
not the size of that identity set. The SQL INSERT/UPDATE/DELETE triggers share
the raw write's transaction. A rejected transaction changes neither table.
Retention deletes raw rows and therefore their analytical contribution; analytics
never replaces raw history or overrides the owner's retention choice.

Cells have bounded width, **not bounded cardinality**. A different path/source/
device/location combination creates a different cell. Unique identities remain
an exact set whose size depends on real visitors. This foundation cannot promise
constant storage or constant latency independently of that cardinality.

The functions exported by `src/vane/analytics/index.ts` answer only their stated
questions:

| Function | Exact native result |
| --- | --- |
| `analyticsTotals` | Pageviews, goal rows, timed pageviews, consented pageviews, range unique visitors and converting identities |
| `analyticsGroup` | Occurrence count and distinct identities by a stored dimension |
| `analyticsGoals` | Counts and converting identities by goal name |
| `analyticsTransport` | Direct/proxy/unknown native pageview counts and shares |
| `analyticsEventSeries` | Nonhourly pageviews, goal occurrences and bucket unique visitors |

These functions do not return a fabricated complete report. They do not compute
visits, bounce, visit attribution, durations/medians, journeys, filters that select
visits, performance percentiles, custom-event properties/revenue, cohorts or
import visibility. A source occurrence group is **not** the visit-attributed
`sourceVisits` table. A device occurrence group's identity count does not supply
the device table's visit/conversion/revenue fields. `browser_version` and
`os_version` are raw version dimensions, whereas the public dashboard combines
the product name and version; its caller must combine before grouping.

`createInsightsService(...).list()` now uses occurrence cells for native counts
and page/source/campaign/goal groups, combines the exact visible-import rows,
and reads native identities and device dimensions from the analytical sets.
Native transport shares also use cells. Whole dates include all events already
admitted today. A running comparison's historical cutoff keeps the timed raw
query; hostname and kept-visit/segment/search filtered sets keep their raw
semantics. No query error selects another implementation.

Nonhourly report series read native occurrence values from cells and combine
visible imports while retaining the existing visit and revenue computations.
Hourly complete-report series remain raw. Overview sparklines ask only for
visitor buckets: analytical identities for daily/weekly/monthly buckets and a
single timed-visitor query for hours. They do not reconstruct visits or money.
Remaining complete-report computations return their real results. Consequently
this integration does not establish a complete 12-month dashboard under two
seconds.

### Archive and privacy integration

`archive.ts` already suppresses maintenance triggers while restoring tables.
It calls `rebuildAnalyticsStatements(env)` to its existing atomic batch after
restoring native rows, before recreating the triggers. Rebuild even when an
archive includes cells: archives from earlier versions lack those tables, and
current raw rows remain authoritative. This avoids double counting and restores
old archives correctly. The migration itself backfills existing native history.

The inventory declares `vane_analytics_cells` and
`vane_analytics_identities`, their columns and the daily/site-scoped digest
semantics. Identity references never enter anonymous aggregate CSV data. It
contains the same protected derived identity material as native events. History
archives retain their existing owner-only controls.

## Real-volume journey

The explicit `Collection scale` workflow builds the candidate SHA and runs
`tests/collection-scale.journey.mjs` outside push Verify. It creates sites through
owner approval, submits every event through the real collector, admits more
than 10,000 on one site/day, races sixteen copies of one ID, checks later replay,
and offers a paced 500 events/second burst. It then submits the requested monthly
volume across 28 real dates in each requested month. DB inspection checks
custody; it never inserts raw rows, counters or rollups directly.

Default acceptance input is 10,000,000 pageviews in each of 12 months, plus the
daily-ceiling and burst probes. No row carries a multiplier. Both a complete
public summary and dashboard HTML response must arrive under two seconds, with
known totals and breakdowns. The run log records SHA, actual admission count,
burst timing, response timings and the store's actual reported size/limit.
This is not provider acceptance: this workflow uses the real built Worker
and local D1 runtime on the remote GitHub runner. A deployed Cloudflare run is
separate evidence.

Smaller explicit `monthly_pageviews` / `months` inputs exercise public behavior
and are labelled **SMOKE ONLY**. The public 10,001-event and paced-burst probes
still run. Run expensive journeys only through the committed-SHA remote workflow
or the prescribed heavy-slot wrapper; never on the shared Mac directly. The
existing RETENTION-002 public journey in `tests/vane-report-settings.mjs` proves
the actual 80% warning threshold, both required choices and continued admission.

## Raw capacity is still an implementation obligation

The current deployment declares one `DB` D1 binding. The current row stores a
site UUID, composite UUID ID and visitor digest before its many other columns
and indexes. Those three text values alone need about 173 bytes/pageview, or
over 19 GiB at 120 million events. A 10,240 MB D1 store cannot hold that raw
history, and these materializations add storage. A 13-month or unlimited owner
retention window cannot silently be shortened to get the scale test to fit.

The smallest additional-binding direction that preserves D1 semantics is a
declared bank of D1 raw partitions alongside the existing control `DB`, with
stable event routing and a control-store analytical reader. `deploy.json` already
declares D1 bindings as a list, so naming extra bindings does not itself require
a new Base resource kind. Keep all existing project/Worker/DB identities. Binding
and partition migration support, real capacity per partition, atomic admission
and replay routing, dependent page/custom/engagement access, raw retention,
archive portability and cross-partition reporting must be implemented and proved
before calling this an available architecture. Size the bank from measured bytes
per row plus indexes and derived sets with headroom; choosing a shard count from
the minimum 173-byte arithmetic would underprovision it.

The existing S3/R2 scheduled warehouse export is an outbound CSV path. There is
no warehouse query engine in that integration, so exporting alone does not make
the dashboard a warehouse-backed analytical reader. R2-only raw storage would
also require an ingestion/deduplication and indexed-read design, not just a
manifest binding. No such architecture is claimed by this foundation.

Until the raw architecture and remaining report aggregates ship, a full-volume
run can fail on capacity, runner duration or latency. Its failure must remain
visible; do not lower the acceptance count, increase the published D1 limit,
prefill summaries or report a smoke run as full scale.
