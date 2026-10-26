# Hosting cost and measurement

Vane deploys one Worker and its D1 binding, as declared in `deploy.json`.
The Cloudflare plan is named before setup: the setup questions, the Deploy
section of the README and this page say that Workers Free suits a trial or a
small site, and that a busier installation needs Workers Paid (USD 5 a month
minimum). Workers Free permits 100,000 Worker requests a day; pageviews,
engagement, configuration and dashboard requests are different counts. The
collection load-test volume requires Workers Paid. An owner sees Hosting cost
on History, which names the plan the stored volume needs and warns at 80% of
the Free daily request limit.

The panel is a **projection from measured usage**, not a read of your
Cloudflare bill. The usage per 100,000 pageviews comes from Cloudflare's own
account analytics for a deployed Worker and D1 database, as the next section
records. The tables after it keep the earlier local run as an independent
cross-check.

## Measured on a deployed Cloudflare account

The explicit journey `tests/host-cloudflare-cost.journey.mjs` deploys Vane with
the public `rer deploy` command into the held RunEditRun test account, claims
the owner with the setup token, approves a site and submits genuine pageviews
through the native batch door (`POST /api/vane/collect-batch`, 1,000 distinct
pageviews a request, the transport of the `COLLECT-004` load test) from one
machine. It then reads Cloudflare's own account analytics for that Worker and
database, prices them at the published rates below and compares the result with
the figures the panel states. Removal always runs afterwards.

Reconciliation before any load: the account inventory (Workers, D1 databases,
KV namespaces, R2 buckets and queues) gained exactly one Worker and one D1
database, and the Worker's bindings were exactly those `deploy.json` declares
(the D1 binding `DB`, the plain variables, the four secrets and the origin
variable) plus the four the rer deploy kit adds to every Worker: static assets
(`ASSETS`), version metadata (`RER_VERSION`) and the two deployment markers
(`RER_DEPLOY_FINGERPRINT`, `RER_DEPLOY_SOURCE`). After removal the account
inventory was identical to the one before.

| Per 100,000 pageviews | Calibration run | Verification run | Panel states |
| --- | ---: | ---: | ---: |
| Worker requests (all, incl. setup and schedule) | 102.6 | 100.5 | 102.6 |
| Worker CPU, milliseconds | 3,100 | 2,749 | 3,100 |
| D1 rows read | 3,962,652 | 3,967,468 | 3,962,652 |
| D1 rows written | 793,151 | 794,252 | 793,151 |
| Storage growth, bytes | 7,640,860 | 7,627,207 | 7,640,860 |
| Usage cost at list rates, no allowances (USD) | 0.803 | 0.804 | 0.803 |
| Monthly cost at 10,000,000 pageviews (USD) | 34.32 | 34.43 | 34.32 |

Each run loaded 1,000,000 pageviews into a fresh deployment, counted from
before deployment to the end of the load. Cloudflare's figures for the Worker
and database include setup, owner sign-in, dashboard reads and the five-minute
schedule, so this is complete usage, not only batch requests. The calibration
run (source commit e498027) produced the figures the panel states; a repeat
deployment between the two wrote 792,668 rows per 100,000 pageviews, within
0.1% of it, and Cloudflare's storage figure for that repeat, 78,544,900 bytes,
matched the 78,544,896 bytes the app showed. Receipts are kept with the campaign. The verification run, on
6e3124d34ceaa082d70db9285be6555ef33b825c on 26 October 2026, was a second fresh
deployment: its usage cost per 100,000 pageviews and its monthly cost at the
`COLLECT-004` volume of 10,000,000 monthly pageviews are within 0.4% of the
stated values, and every comparison the journey asserts is within 10%. Worker
analytics arrived about twenty minutes after the traffic, so the journey waits
for them; the verification run measured storage as the size D1 reports to the
app, because the account's daily storage figure had not yet arrived. At 1,000,000 pageviews a month the account minimum dominates: USD 5.00.

The load is 1,000,000 pageviews on one deployment, not the full twelve-month
120,000,000-pageview run of `COLLECT-004`. That run would bill roughly USD 850
of D1 writes beyond the included 50 million, take more than two days at the
measured rate and exceed what one D1 database holds on the way to its 10 GB
limit, so it stays an in-runtime proof (`tests/collection-scale.journey.mjs`).
The deployed run establishes the cost per 100,000 pageviews, and the monthly
figure at the stated volume follows from it by the published rates. The first
100,000 pageviews wrote about 4% fewer rows per 100,000 than the
1,000,000-pageview average the panel states, so a small installation costs no
more than stated.

Reproduce with the held test token (it needs Workers Scripts Write, D1 Write,
Account Analytics Read, Account Settings Read, Workers KV Storage Read and
Workers R2 Storage Read, and no zone permission):

```sh
VANE_HOST_COST_JOURNEY=1 CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
  node --test --test-concurrency=1 tests/host-cloudflare-cost.journey.mjs
```

The run takes about half an hour and costs a few cents.

## Local cross-check

On 23 October 2026 the committed public journey in
`tests/vane-report-settings.mjs`, “HOST-001 real collection measures requests,
D1 work and storage before projecting hosting cost”, admitted 100,000 distinct
pageviews through the real native collection batch endpoint. No rows were
inserted directly and no event represented more than one pageview. The summary
API independently returned all 100,000 pageviews.

| Measurement | Observed value |
| --- | ---: |
| Pageviews | 100,000 |
| Native batches, 1,000 pageviews each | 100 |
| D1 rows read by collection | 3,812,803 |
| D1 rows written by collection | 750,643 |
| Database size before collection | 2,265,088 bytes |
| Database size after collection | 9,777,152 bytes |
| Database growth | 7,512,064 bytes |
| Sum of request elapsed time | 5,396 milliseconds |

This was local Miniflare and workerd with Node 22.20.0, ten paths, one site,
one day and one synthetic visitor. UUIDs are distinct. D1 response metadata
counts the actual reads and writes, including index maintenance. Database size
comes from D1's `size_after`. Setup, migrations and report queries are excluded
from the collection counters. Repeated runs can differ because of index layout.
Elapsed time includes waiting and **is not Worker CPU time**. A single-event
browser workload, more distinct visitors and more dimensions can cost more.

At this local volume the Workers Paid minimum dominates: the local run alone
projects USD 5.00 a month. This run measured no Worker CPU and used no account;
the deployed measurement above supplies the figures the panel states, and
counted about 6% more rows written (793,151 against 750,643 per 100,000
pageviews); the local run does not isolate the difference, and the panel states
the larger deployed figure.

## Projection and warning

Published rates read on 23 October 2026 from Cloudflare's pricing documentation:

- Workers Paid: USD 5 monthly account minimum; 10 million included requests,
  then USD 0.30 per additional million; 30 million included CPU milliseconds,
  then USD 0.02 per additional million.
- D1: 25 billion included monthly reads, then USD 0.001 per million; 50 million
  included writes, then USD 1 per million; 5 GB included storage, then USD 0.75
  per GB-month.

The panel scales the measured request, CPU and D1 operation counts linearly to the
installation's stored native pageviews for the current calendar month. Each
site's stored reporting date is used. It prices the current database size as
though retained for one month; it does not forecast retention growth. This is
a batch collection scenario, not a claim that production costs scale exactly.
With no pageviews, the normalized amount is unavailable rather than dividing
by zero. Only the owner can see the installation projection.

For an independently measured account request count, the operator may supply
`VANE_WORKER_PLAN` (`free` or `paid`), `VANE_WORKER_USAGE_DAY` (UTC date) and
`VANE_WORKER_DAILY_REQUESTS`. Missing, invalid or stale counts are shown as not
supplied, never as zero. On a Workers Free fixture the current day's 80,000
requests raise the warning. Vane does not infer requests from pageviews.

The measurement is an explicit local run, outside push Verify:

```sh
VANE_HOST_COST_MEASURE=1 node --test --test-name-pattern='HOST-001' tests/vane-report-settings.mjs
```

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Offline runtime proof

The account-free runtime journey runs with only loopback networking in a Linux
network namespace. It proves real tracker collection, reports at 1440 and 390,
imported history and archive restoration without outside services:

```sh
VANE_HOST_OFFLINE_JOURNEY=1 node --test --test-name-pattern='network-denied runtime' tests/host-local.journey.mjs
```

It requires Linux user and network namespace support and the `ip` command.
Build and install Chromium first. This does not replace the separate one-line
installer acceptance. The complete-source journey uses pinned rer 0.2.79. Local installation journey
workflow 40050422780 passed on bdbcf6377f3a8c04f58b671fb01c321749dfd6a2 on 24 October 2026.
The installed journey in `tests/host-local.journey.mjs` starts from an empty
folder, signs in, approves a site, collects a real tracker pageview and reads its
report at 1440 and 390. It restarts the installed checkout to prove durability,
then restarts it again inside a Linux network namespace with only loopback and
no external routes. A real external connection fails before the complete
sign-in, site approval, collection and report journey passes again offline.
Both journeys use the same installed checkout and commit; the mobile menu
tooltip appears on keyboard focus and hover.
The separate hosted-transfer proof below uses the held RunEditRun test account.


## Hosted transfer sandbox proof

On 24 October 2026, the explicit live journey in `tests/host-cloudflare.journey.mjs`
passed on 91b226f5906b8828f4795b88b3c7637dc45cc3c8 (local run sx-vane-c45-r1.live-transfer-5). It installed a real
local fixture from an empty folder, collected one `/subscriptions` pageview,
exported it with `rer export`, and restored the complete archive with
`rer import --target remote` into a fresh deployment in the held RunEditRun
account. The owner used the normal sign-in grant and destination first-run form.
The hosted report still showed that one pageview at 1440 and 390. Missing
authority and an occupied destination were refused. The created Worker and
database were removed after the run. Private provider credentials never entered
the archive or output. This proves HOST-003. The separate installed offline acceptance of
HOST-002 is proved by workflow 40050422780 above.


## Weekly hosted transfer

The named **Cloudflare installation transfer** workflow in
`.github/workflows/host-cloudflare.yml` runs job `host-cloudflare` every Sunday
at 19:37 UTC, or by explicit manual dispatch. It requires the repository Actions
secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; missing authority
fails the run before installation. The token is limited to the RunEditRun
account, with Workers Scripts Write, D1 Write and Account Settings Read,
and no zone permissions.

The job runs `tests/host-cloudflare.journey.mjs` with
`VANE_HOST_CLOUDFLARE_JOURNEY=1`, including public `rer import --target remote`.
Its finally path removes only resources owned by this run, even if transfer
fails. Fresh account Worker and D1 listings independently assert their absence.
The retained artifact contains the journey log, reports at 1440 and 390, and
`cleanup.json` with the candidate SHA, run ID, result and final resource listings.
Credentials, private sign-in links, archives and deployment state are excluded.
Concurrency is serialized without automatic cancellation so cleanup can finish.
The single candidate dispatch, [run 40185411652](https://github.com/just-every/run-vane/actions/runs/40185411652), passed on
fdbb065e3796dea09720cdf306e375f3ecefe69b on 25 October 2026. Its
[retained artifact](https://github.com/just-every/run-vane/actions/runs/40185411652/artifacts/12595818007)
expires on 23 January 2027 and is also retained by the campaign outside the clone.
The cleanup receipt records transfer and cleanup passed: the final account
listings contain 242 Workers and 78 D1 databases, with the owned test Worker
and D1 absent. Both the installed local report and the hosted report show the
same one `/subscriptions` pageview at 1440 and 390, including mobile menu
focus and hover tooltips. HOST-003 is DONE.
