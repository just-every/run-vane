# Hosting cost and local measurement

Vane deploys one Worker and its D1 binding, as declared in `deploy.json`.
Workers Free permits 100,000 Worker requests a day; pageviews, engagement,
configuration and dashboard requests are different counts. The collection
load-test volume requires Workers Paid. An owner sees Hosting cost on History.

The panel is a **known component estimate**, not a measured Cloudflare bill.
HOST-001 remains partial. A Cloudflare test account, the full COLLECT-004 run,
resource reconciliation and a billing comparison within 10% are still required.
The plan notice before setup is also pending.

## Measured local collection

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

At this measured volume, the published Workers Paid minimum and known D1 and
request components project to **USD 5.00 per month, or USD 5.00 per 100,000
pageviews**. This assumes this is the account's only workload and its included
allowances are available. It excludes Worker CPU, engagement, dashboard reads,
mail, other services and taxes; it is not an observed provider charge. No paid
account or provider billing measurement was used.

## Projection and warning

Published rates read on 23 October 2026 from Cloudflare's pricing documentation:

- Workers Paid: USD 5 monthly account minimum; 10 million included requests,
  then USD 0.30 per additional million. CPU is excluded from this projection.
- D1: 25 billion included monthly reads, then USD 0.001 per million; 50 million
  included writes, then USD 1 per million; 5 GB included storage, then USD 0.75
  per GB-month.

The panel scales the measured request and D1 operation counts linearly to the
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
