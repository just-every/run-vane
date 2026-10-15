# Move from Umami v2

Vane accepts a JSON response from Umami v2's documented
[`GET /api/websites/:websiteId/events`](https://v2.umami.is/docs/api/events-api).
The response has `data`, `count`, `page`, and `pageSize` at the root. It is not a
database dump or the event-data endpoint. Download pages of up to 500 events and
import each independently. Vane never requests a Umami credential. `count` is the
complete Umami result count; only the supplied `data` page is imported.

Each event needs `id`, a UTC ISO `createdAt`, `urlPath`, and `eventType`. Type 1
maps to pageview. Type 2 requires an `eventName` configured as a Vane goal, on the
goal's approved path. Every path must exactly match the site's approved list.
Unknown paths, types, goals and goal/path mismatches stop the entire page with an
explicit row-number error.

The public `tests/fixtures/umami-events.json` is deliberately synthetic. To try
it, approve paths `/` and `/thanks`, goal `signup` at `/thanks`, campaign `launch`,
and source `search.example`. It demonstrates approved and discarded values; it
is not a customer export or evidence of real traffic.

Preview shows normalized events, mapped/duplicate counts, discard counts and a
fingerprint. Confirm the fingerprint to apply the same page. It binds sanitized
events, discard counts, site configuration/version and the owner. Changed policy
or safe event values require a fresh preview. Ignored private values do not enter
the fingerprint. Apply records owner ID and UTC approval time before publishing.
The HTTP integration requires native owner sessions and CSRF protection; an agent
API key cannot approve through that integration.

Only sanitized events enter Base import-kit source custody. Session IDs, page
titles, website IDs, raw source event IDs, referrer paths/queries, unknown fields
and raw URL queries are discarded before planning. Event identity is a stable
hash of the destination site and source event ID; no visitor/session identity is
kept. Only an approved `utm_campaign` token is extracted. Missing campaigns become
`none`; unknown or ambiguous campaigns become `other`. Empty referrer domains
become `direct`; approved hostnames remain; unknown domains become `other`.
Neither raw upload nor original bytes are retained. Artifact hashes describe
only sanitized values. Imported consent and sampling are unknown (`null`).

Apply publishes up to 20 entries per call. Repeat the same document/fingerprint
until `complete: true`; completed replays are idempotent. Reusing an event ID with
changed safe content fails. Journal exposes approval, checkpoints, committed
batches, discard counts and event provenance. Repeat undo until `complete: true`.
Undo removes imported events and refuses rows edited since import. Base jobs are
bound to the owner who previewed them; another owner cannot take over a job.

Call `eraseSite` while the site exists. Base retires all import custody for that
site and deletes import rows, revisions and approvals in one atomic batch. A
durable fence and append-only receipt retain IDs, counts and time; retired jobs
cannot resume or undo. The caller owns deletion of live events and site records.
Portability must preserve fences and reject archives predating erasure; a fence
alone cannot enforce that outer archive policy.

## Server API

`src/vane/movein/index.ts` exports:

- `preview(env, actor, {siteId, document})`
- `apply(env, actor, {siteId, document, fingerprint})`
- `journal(env, actor, {siteId, jobId})`
- `undo(env, actor, {siteId, jobId})`
- `eraseSite(env, actor, siteId, nativeStatements?)`
- `expireBefore(env, actor, siteId, beforeDay, nativeStatements?)`

`env.DB` is a real D1 binding; actor is native `{id, role}`. All operations reject
non-owners, check active owner authority in `oa_operators`, and fence site policy
inside Base transactions. `MoveinError` supplies a safe `code` and HTTP `status`.
Do not log documents or expose arbitrary engine diagnostics in HTTP errors.

## Portability

Export/import `vane_import_events`, `vane_import_revisions`,
`vane_import_approvals`, `vane_import_erasure_fences`, and every `ik_*` table in
`migrations/core/0015_import_kit.sql`, including empty staging tables. These hold
jobs, source/provenance custody, original availability manifests, chunks, batches,
reversal history, preparation guards and erasure journals/receipts. Preserve
append-only journals and monotonic fences when checking restore eligibility.
Reports union `vane_import_events` with `vane_events` and preserve null consent
and sampling.

Base runtime source under `src/modules/import-kit` is copied byte-for-byte from
`fc0e1041efa55771142bbb57c4ab4743147e264d`, limited to transitive dependencies of
D1 planning, create, apply, read, undo and retirement. No tests or proof apps are
copied. The migration embeds Base's fresh D1 schemas plus Vane's import tables.

Deletion accepts optional inert SQL descriptors `{sql, params}` (not prepared
statements). Native deletes and deletion-ledger inserts commit in the same Base
retirement batch and import erasure fence. Do not delete the site row in these
statements: current site policy must still authorize the transaction's final
check. `expireBefore` erases one expired imported event per call, plus the caller's
idempotent native deletion descriptors, returning `remaining` and `complete`.
Repeat until complete. It tombstones that event's source custody while preserving
other imported events. If there are no expired imports, the native statements and
fence still commit with the same active-owner/site-policy checks. A partial run
can be resumed, and its deletion receipt already fences older archives.

Preview also returns `carry: {format: 'vane-umami-preview/1', events, discarded}`.
Use this sanitized carry as apply's document to avoid returning raw uploads in
HTML. Carry validation rejects unknown keys, unhashed IDs, unapproved paths,
goals, sources/campaigns and non-null consent/sampling. Raw response and carry
produce the same fingerprint under the same site policy. `archiveTables` exports
the complete table inventory from the public server entry point.
