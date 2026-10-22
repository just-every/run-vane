# Collection and coverage

Vane records accepted page loads for the paths you approve. A goal is a load of its configured path. Reports show recorded counts, with the previous period alongside them.

## What is collected

The script sends the page path, the referring hostname, the UTM fields, the `ref` or `source` parameter, the query parameters the site keeps, a fresh event ID and consent state. Analytics stores no IP address, user agent, visitor ID, page title, full URL or arbitrary properties. The script uses no cookies or browser storage. Owner sign-in data is separate.

Every page of the site is collected unless you list paths to include (then only those) or to exclude. Before storage, path segments holding an email address, a UUID, six or more digits in a row or a long token become `:email`, `:uuid`, `:number` or `:token`, and your rewrite rules (such as `/orders/*=/orders/:id`) group the rest. The page's hostname is stored beside its path and must be one of the site's origins.

Query strings are dropped except the five UTM fields, `ref`, `source` and the parameters you choose to keep; a kept value that looks like an email address, a phone or account number or a web address is dropped. `gclid`, `fbclid` and `msclkid` only mark a paid click. A visit's source is its `utm_source`, else its `ref` or `source` parameter, else the referring hostname; no referrer becomes `direct`. Campaigns come from `utm_campaign`.

Each page load also gets a channel (Direct, Organic Search, Paid Search, Organic Social, Paid Social, Email, Referral, AI Assistants, Affiliates or Display) from its source, `utm_medium` and paid-click flag; the methodology page lists the rules and source lists. A referring page is kept as its hostname and path, without its query; webmail referrers are grouped as `webmail` and their addresses are never kept. Referrer domains and Android app referrers report under named sources from the list on the methodology page (`news.ycombinator.com` as Hacker News, `app.slack.com` and `android-app://com.slack.android` as Slack); an unlisted referrer keeps its own domain, and **Source grouping rules** in a site's settings (approved like any change) name your own, such as `brewblog.example=Brew Blog`. The report's channel, source, referring-page and UTM tables count each visit under its first page load.

## Batch collection and raw history

`POST /api/vane/collect-batch` accepts `{"events":[PAGEVIEW,...]}` containing
1–100 normal collector records, each with its own event UUID and `siteId`. The
whole UTF-8 body may be at most 64 KiB (65,536 bytes); each serialized record has
the ordinary 8,192-character limit. Each record follows the same origin,
collection, consent and privacy rules as `/api/vane/collect`. The request supplies
shared visitor metadata; payloads cannot supply trusted IP, user-agent or
Cloudflare fields.

Validation rejects the whole batch if a record is malformed or refused, naming
its zero-based `index`. No pageview, goal, property or visitor salt is created by
that failure; an existing exclusion counter may record the refusal. DNT/GPC and
field-free coverage counts keep their separate rules. Valid records commit
atomically with their dependent writes. A compatible repeated ID admits one
pageview, including concurrent retries and repeats within a batch.

Success is HTTP 202 with `atomic: true`, an `accepted` count of new records and
ordered `results`. New results have status 202 and `accepted: true`; compatible
duplicates have status 200, `accepted: true` and `duplicate: true`. The single
collector keeps its existing response. Batching adds no multiplier: every accepted
pageview has its own real raw row and UUID. Authenticated Events API budgets are
unchanged.

Raw storage shares repeated site, visitor-digest and context values and packs
canonical UUIDs and digests losslessly. The `vane_events` logical view still
exposes every original event, field and timestamp. Retention and erasure remove
those rows and their derived contributions. Logical history archives preserve
the events; restore rebuilds physical references and derived analytics.

Unfiltered native whole-day reports use exact materialized visit and performance
facts. Hostname restrictions, partial historical cutoffs and visit/segment/search
filters reconstruct visits from their actual restricted raw event sequence.
Materialization changes neither recorded counts nor visit definitions. Storage
and full-scale latency remain workload-dependent and unproven; see
[collection scale](collection-scale.md).

## Consent and browser signals

With **Count declined consent** on (consent-required sites only), a page load without consent sends one empty count, so the report can show the declined share; page loads refused on an excluded path are counted the same way. Each count holds only the site, the day and the reason.

Choose **Consent required** or **Consent not required** in collection settings. For consent-required sites, load the script only after consent and set `window.vaneConsent = true` before it runs.

Unique visitors are counted without cookies. For each page load the Worker hashes a random daily salt with the site ID, the visitor's IP address and user agent; it stores only the hash, never the IP address or user agent. Each site's salt rotates at midnight in the site's time zone (set in **Settings**) and is deleted after 24 hours, so a visitor cannot be followed across days or sites. A range of several days shows the sum of its daily unique visitors. Reports use the site's local dates.

To stop counting your own visits, open any page of your site with `#vane-ignore=on` in each browser you use. The script stores a single `vane_ignore` flag in that browser, holding no identifier, and counts nothing there; `#vane-ignore=off` removes it. It is one of exactly two declared exceptions to "no browser storage": the other, a consented identifier, needs a consented mode this release does not have, so it is never written.

Do Not Track and Global Privacy Control stop collection. To see how much traffic sends either signal, turn on **Count privacy signals** in a site's settings and, after approval, copy the updated snippet: it adds `data-count-signals`, and each signalling page load then sends one count that carries no path, source, campaign or identifier. The report shows the count and its share beside the other coverage limits. Settings and the installation's public `/methodology` page state Vane's stance under the CCPA/CPRA and the other US state privacy laws. Blockers, consent exclusions and unlisted pages are invisible to the report. Vane does not measure complete traffic coverage.

## Sampling

Choose 10%, 25%, 50% or 100% of eligible loads. Report counts are observed counts; they are never scaled into estimates. The report's **Coverage and collection limits** shows the configured sample rate and consent mode.

Imported activity has unknown consent and sampling. Vane keeps those values unknown.

## Reading changes

Every report compares the selected period against its preceding period. The default is the current seven UTC days against the seven before. The **Weekly explanation** gives both counts and the difference, with evidence tables below.

Changes in recorded activity alone do not establish why people acted. Counts are page loads, rather than people or sessions. Non-browser senders can spoof the public collector. There is no fixed daily page-load admission ceiling. History publishes the D1 store capacity and every app page warns from 80%, naming a shorter raw retention window or scheduled warehouse export. Full-volume and dashboard latency proof remain pending; see [collection scale](collection-scale.md).

## Change collection settings

Open **Settings**, edit **Collection settings** and select **Prepare settings change**. The owner reviews the proposal in **Approvals**. Changes take effect after approval. Keep paths and labels public and free of personal identifiers.
