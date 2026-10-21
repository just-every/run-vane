# Back up and restore

Your analytics history stays portable. Vane can import supported Umami history, undo an import, download an installation archive and restore into an empty installation.

## Import and undo

Open a site's **History**, choose an **Analytics document**, and select **Preview import**. Preview writes nothing. Check the rows and fingerprint under **Review import**, then select **Apply import**. See [Move in from Umami](umami-import.md) for the supported JSON and limits.

The **Import journal** records approval, checkpoints and committed records. **Undo import** removes that import's unchanged contributions. Repeat apply or undo while processing remains. Imported consent and sampling stay unknown.

## Whole event exports

For a complete Umami `website_event` CSV, Simple Analytics data-point CSV or
PostHog `$pageview` JSON Lines export,
use the checkout's streaming command instead of splitting the file by hand.
It reads RFC 4180 CSV (including quoted commas and multiline fields) or JSON
Lines in bounded pages and uses the same owner-only preview, fingerprint, apply and journal doors
as the History page. No new provider credentials or API keys are used.

Save the `Cookie` request-header value from your signed-in installation in a
private file readable only by you. Treat it as a sign-in credential. Keep the
source export, session file and review directory outside the checkout.

```sh
node scripts/import-export.mjs preview \
  --origin http://127.0.0.1:8787 \
  --site YOUR_SITE_ID --cutover 2024-03-15 --format umami \
  --input /private/website_event.csv \
  --cookie-file /private/vane-session.txt \
  --review-dir /private/vane-review
```

Use `--cutover 2024-03-15 --format simple` for a Simple Analytics export. Its header must include
`added_iso`, `path` and `uuid`. Umami requires `event_id`, `created_at`,
`url_path` and `event_type`; custom events must already have approved native goals.
All formats use the same field rules as the document importer.

For PostHog use `--cutover 2024-03-15 --format posthog` and a UTF-8 JSON Lines file: one complete
`$pageview` event object per line, with `uuid` (or `id`), `event`, `timestamp`
and `properties`. Blank lines, CRLF and an initial UTF-8 BOM are accepted; the
last line need not end with a newline. Select pageviews when exporting: other
event types are refused by the existing preview door. A JSON array or a
`{ "results": [...] }` API response is still a document import; this streaming
command expects JSON Lines, not an API response or CSV.

Each preview request contains at most 500 events and 2,000,000 document bytes;
an oversized single row or malformed JSON stops preview. Only the UTC day,
kind, redacted path, source and campaign survive, with hashed event identity
for deduplication. Person/session/device IDs, IPs, titles, full URLs and other
properties are dropped by the ordinary server importer. If preview stops on a
later page, its incomplete manifest cannot be applied.

Preview publishes no analytics. The review directory holds only sanitized
records, discard counts, fingerprints and checkpoints, with private file
permissions. Inspect its manifest and page documents before applying. Raw event
IDs, session IDs, page titles and original upload bytes are never copied there.
The source file's hash binds a resumed preview to the same bytes, format, site
and installation; changing any of those requires a new review directory.

```sh
node scripts/import-export.mjs apply \
  --review-dir /private/vane-review \
  --cookie-file /private/vane-session.txt --yes
```

Repeat the same command after an interruption. Each reviewed page keeps its
ordinary import job; a lost response resumes that job and cannot count its events
twice. Errors stop the command without automatically retrying. If the site's
settings change, the server refuses stale fingerprints: preview again into a new
review directory. Jobs remain visible in History and use the ordinary journal
and Undo import action. The command does not provide a single whole-file undo.

The public-door test exercises interrupted preview and application with complete
multi-page Umami, Simple Analytics and PostHog files, matching totals, unknown
coverage, identifier absence and ordinary undo. PostHog also exercises a lost
apply response, repeated source IDs across pages, malformed and oversized rows.
The separate `tests/import-scale.journey.mjs` exercises a two-million-row Umami
preview, interrupted after one million rows, through the real CLI and Worker.
It checks every anonymous record and the exact day totals with the CLI heap
limited to 128 MiB. It publishes no analytics. The **Import scale** workflow
runs it for relevant candidate changes and supports manual runs.

`IMPORT-006` remains partial: interrupted publication of two million Umami rows
and matching published totals are still unproven. Publication now lets the import engine gather up to 100 entries per batch,
ending earlier when its measured D1 request budget requires it. Planning,
reviewed fingerprints, authority fences, journal and undo are unchanged. The
public-door fixture publishes 1,003 distinct Umami rows in 13 apply requests,
including an interrupted response and a completed repeat; the former 20-entry
cap required at least 51 requests for those rows. This fixture is not a
two-million-row publication proof. Preview scale is not publication scale.

## Google Analytics source documents

`IMPORT-002` currently supports owner-uploaded daily source reports, with preview, exact-fingerprint approval, resumable application, journal and undo. Google OAuth and automatic Data/Admin API reads are not available yet. Export the source responses yourself; do not put OAuth codes or tokens in the document.

For GA4, wrap complete [Data API `runReport` responses](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport) and optional [Admin API key events](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.keyEvents/list) in JSON:

```json
{
  "format": "vane-ga4-history/1",
  "property": "properties/123",
  "from": "2025-09-01",
  "to": "2026-09-30",
  "reports": [],
  "keyEvents": []
}
```

Replace `reports` with your actual source responses, each including a `date` dimension, its headers, all rows and `rowCount`. Dates use the source property's local calendar and the inclusive range above. Each report grouping stays separate; preserve `metadata.currencyCode` for money and `metadata.timeZone` when provided. Incomplete report pagination is refused. Upload at most 500 sanitized report rows in one document; split larger exports into separately reviewed documents. Empty documents are refused.

GA4 users can span days and devices; they differ from Vane's daily cookie-free visitor estimates. Session and engagement rules remain GA4's, with bounce and engagement rates retained as fractions between 0 and 1. Source sampling, thresholding, restrictions and data-loss flags stay on the rows. The reports retain their source dimensions and metrics, never become invented visits, and do not add to native Vane totals. Any viewer can leave imported data out of a view with `imported=off` (the dashboard, a shared link, CSV tables, `/api/v1/stats` and `include.imports: false` on `/api/v2/query`), and an import by another source skips the days an earlier source's import already holds, listing them in its preview and journal. A declared cut-over date, live data winning on overlap days, chart labels and the parallel-run report remain `IMPORT-007` work.

Admin key events retain their event name, source property and counting method. They appear under **Recovered definitions**, awaiting a matching accepted native event or an explicit completion. A definition still needs the owner's ordinary proposal approval before it changes live counting. A source count never establishes a trigger.

For a dated Universal Analytics archive, use:

```json
{
  "format": "vane-ua-csv/1",
  "property": "UA-123-1",
  "from": "2024-01-01",
  "to": "2024-01-31",
  "currency": "USD",
  "csv": "Date,Page,Users,Sessions,Pageviews,Bounce Rate,Revenue\n20240101,/pricing,10,12,20,25,49.99\n"
}
```

Use an unformatted daily CSV with a `Date` column; period-only summaries do not establish daily dates. UA bounce rates remain percentages and duration metrics remain seconds. Money needs its source currency. Personal-looking labels, query strings, unsupported columns and paths outside the site's approved privacy settings are refused before custody. Open a site's **History → Import a document**, upload the JSON, review the source definitions and apply it. Undo removes imported rows while keeping their journal and any separately approved native settings.

## Download an archive

In **Data history**, select **Download installation archive**. The analytics archive contains every site's analytics, proposals, deletion journal and import custody. It excludes authentication.

Keep archives private. Checksums detect corruption; accept only your own archives.

## Restore an archive

Sign into an empty analytics installation. In **Data history → Restore an installation archive**, select the **Installation archive**. Supply a later export under **Later journal (optional)** when one exists, then select **Restore archive**.

An old archive is refused when the supplied later journal records a later deletion. A fresh installation cannot know about a journal you omit. Browser transfer is limited to 10 MB or 50,000 rows.

For larger installations, use RER's installation archive:

```sh
rer dev --stop
rer export --output ../vane-installation.rer
```

In an empty destination checkout, after `rer install`:

```sh
rer import --input ../vane-installation.rer --yes
```

These installation archives also carry access-control records, suspend local development identities, exclude sessions and secrets, and preserve migration history. Supply `--journal ../later-installation.rer` after erasure. Keep archives and private settings outside source control.

## Retention and erasure

Choose 30, 90 or 365 days, 13 or 25 months, or as long as the installation exists in collection settings. **Apply retention** erases events older than the window and nothing on a keep-forever site. Retention runs manually and erases one imported row per run; repeat until imported rows are processed.

The History page shows how full the store is against its capacity, D1's 10,240 MB database limit on Workers Paid (set `VANE_STORE_LIMIT_MB` to 500 on Workers Free). From 80% every app page warns and names the choices: a shorter retention window, or a scheduled warehouse export once that ships. Vane never drops or rolls up events to make room.

For a site's full history, select **Prepare history erasure**, then review and approve the permanent deletion as owner. Deletion retires affected import custody and records a deletion fence.

`rer reset --yes` destroys local state. Export first if you need to retain it.

## Audit history

Owners and administrators can open **Audit history** from the sites page. It lists every proposal and approval, settings change, import and undo, archive download, restore, erasure, retention run, sign-in and change prepared through the agent command API, with who did it, when and to what. Entries hold identifiers and counts only, so erasing a site's history keeps them without the erased data, and they travel in the installation archive.

## Declaring a cut-over date

The owner may set a cut-over date in any history import form, or send `cutover: "2026-10-05"` alongside `siteId` and `document` to `POST /api/vane/import-preview`. Review shows the date and any normalized source dates that already have live collection. Apply the returned sanitized `carry` with its exact `fingerprint`; changing the date invalidates approval. Continue with the same carry until complete. The import journal records the date. To change it for records already imported, undo that import before reviewing it again.

For a dated import, reports include only source dates strictly before the cut-over. Any date with live collection uses live data alone, even if live data arrives after import. This uses each record's normalized date (source-local dates for aggregate reports; the existing UTC date for event imports). Imported source reports remain separate from native event totals. Report CSVs, Stats API answers and the whole-site ZIP use the same precedence. `imported=off` also leaves imported history out of the ZIP. Installation and site archives retain the complete imported records and date, so undo and transfer preserve the original history.

For a new preview, leaving the field empty selects the day after the last normalized source date. Review records that date before publication. Existing undated archives keep their recorded policy until the owner undoes and reviews the import again. Reports label each imported source, range and metric definition, and show its coverage as unknown. Every viewer can turn imported history off for the dashboard, comparison, shared/public report, CSV, Stats API and whole-site ZIP. The owner can use Compare a parallel run for a transient 14-complete-day Plausible comparison; discrepancies name a cause only when owner-supplied evidence supports it, and unresolved causes remain explicit.

Every whole-export preview requires `--cutover YYYY-MM-DD`, reviewed once for the entire export, and resumes only with that same date. Only normalized source dates strictly before it appear in reports; live collection wins each overlap day. The command retains the reviewed date across every page, including duplicate source events across pages.

The streaming command saves each reviewed job ID. Continuations publish that immutable reviewed custody without uploading its source page again; they still require the same owner, fingerprint and exact reviewed site policy. After a policy change, review the source again before applying. A lost response can repeat the reviewed page safely without duplicating a committed record.
