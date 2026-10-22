# Native pageview batching

`POST /api/vane/collect-batch` takes exactly `{"events":[PAGEVIEW,...]}` with
1–1000 ordinary collector records. Each includes its normal `siteId`; each site's
registered origin, collection configuration, consent and anonymous field rules
apply. The HTTP request supplies the actual shared visitor metadata. Payloads
cannot supply client IP, user agent or trusted Cloudflare fields. The entire
UTF-8 body is at most 524,288 bytes; each serialized record is at most 8,192
characters, matching the ordinary record bound.

Validation is all-or-nothing. A malformed or refused record rejects the entire
batch with its zero-based `index`; no pageview, goal, property or visitor salt is
created by that validation failure. The existing site/day exclusion counters
may record the refused record. DNT/GPC requests are refused without converting
their fields into a count. The existing enabled signal/declined/ignored doors
remain separate field-free requests, preventing a second implicit count.

After validation, one D1 batch atomically rechecks site versions and ID
compatibility and commits the admitted records. It reserves transient markers
only for absent exact IDs, then checks that the physical insert admitted every
reserved row before dependent writes proceed.
Goals, properties and counters are gated by that record's marker. Replays,
including concurrent or repeated IDs within the batch, therefore admit one raw
pageview and acknowledge every compatible repeat. Scratch rows are removed
inside the same transaction; a failure rolls them back. They are not archived or
visitor history. Database failures remain failures and are never acknowledged
as duplicates without an actual committed matching ID.

A successful response is HTTP 202 with `atomic: true`, the count of newly
admitted records, and ordered per-record `results`. Each new result has status
202, `accepted: true` and any experiment assignment. A duplicate result has
status 200, `accepted: true`, `duplicate: true`. The ordinary `/collect` door
keeps its single-record payload and response shape; it shares validation and
admission code. This transport does not change the authenticated Events API's
request or hourly event budgets and does not invent weighted events.
