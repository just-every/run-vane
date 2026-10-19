<img src="public/brand/mark.svg" width="96" alt="Vane, a blue swallow in flight">

# Vane

Cookie-free website analytics in your own account. Add a script, count page
loads, sources, campaigns and goal conversions, then export or restore history.
The run site presents the product, launch instructions and documentation built
from this repository's Markdown. Installed instances open on their own Lobby.

The public site is at https://run-vane.com.

## Run locally

Two lines, the same as the [Run page](https://run-vane.com/run). Install rer once
per computer; it brings its own Node when you have none:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
rer dev just-every/run-vane
```

If the installer prints an `export PATH=…` line, run it before the second line.
Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-vane`
does both in one line. To start it again later, run `cd run-vane && rer dev`. `rer dev`
installs pinned dependencies, selects Node 22.20.0, and prepares a local owner
and D1 database. The first launch takes a few minutes and prints progress. Open
`RER_OPEN` on this computer, confirm the owner on **Finish setup**, then open
**Your sites**. The link is a credential: keep it private. No external email is
sent. Repeating `rer dev` reuses the server. Stop with `rer dev --stop`.

For your own identity, run `npx -y @runeditrun/rer install just-every/run-vane`, then from the checkout `rer setup --owner-email you@example.com` and `rer dev`. Use `rer dev --login`
for ordinary email-link sign-in through the private local outbox. Local personas
`rer dev --as admin` and `rer dev --as member` use real administrator/read-only
roles. Never use the review identity as your production owner.

## First website

1. In **Add a site**, enter a name and exact origin, such as
   `https://fern.example`. Leave the include paths empty to collect every page, and enter
   `signup=/thanks` as a goal. Choose consent mode. Emails, UUIDs, long numbers
   and tokens in paths are replaced before storage, and query strings are dropped
   except UTM fields, `ref`, `source` and the parameters you keep.
2. **Prepare site**, review the complete proposal in **Approvals**, then
   **Approve change** as owner. Administrators prepare; only the owner approves.
   Both actor and time are recorded.
3. Open the site and **Settings**. Copy its script tag into your website. For
   consent-required sites, load it after consent and set
   `window.vaneConsent = true` before it runs. If your site has a CSP, allow
   Vane's origin in `script-src` and `connect-src`.
4. Visit a page, then `/thanks?utm_campaign=launch`. **Report** shows
   page loads, the matching goal, sources and campaigns, and compares the current
   seven UTC days against the preceding seven days.

For a real local website, save an `index.html` containing the tag in a separate
folder outside this checkout and serve it with
`python3 -m http.server 8098 --bind 127.0.0.1`. Register
`http://127.0.0.1:8098`. Add `thanks/index.html`, approve `/thanks/` and
`signup=/thanks/`, and visit those pages. Vane starts empty; no sample data loads.

**Visits means accepted page loads, not unique people or sessions.** Reloads
count again. A goal is a load of its configured path. DNT and Global Privacy
Control suppress collection. The script uses no cookies or browser storage.
It sends approved paths/labels, a fresh event ID and consent state. Analytics
stores no IP address, user agent, visitor ID, full URL or arbitrary properties.
Owner sign-in data is separate.

Sampling is 10%, 25%, 50% or 100% of eligible loads. Counts are observed, never
scaled estimates. A visit's source is its `utm_source`, `ref` or `source` parameter or
referring hostname; no referrer becomes `direct`. Consent exclusions, blockers
and excluded pages are invisible, so
Vane does not claim complete traffic coverage or inferred causes. Non-browser
senders can spoof the public collector. Admission is capped at 10,000 page loads
per site per UTC day.

## Import, undo and portability

The first move-in kit accepts **Umami v2 Events API** JSON pages. Read
[the documented shape and limits](docs/umami-import.md). It also accepts a page of
PostHog `$pageview` events as PostHog's events API returns them (`{"results": [...]}`,
up to 500), and a page of Simple Analytics' data-point CSV export (with at least `added_iso`,
`path` and `uuid`), keeping only each event's UTC day, path, source and campaign. In a site's **History**,
upload, **Preview import**, inspect, then **Apply import**. Preview writes
nothing. Apply records the owner, fingerprint and Base import-kit journal.
Repeat the same reviewed page if processing remains. **Undo import** removes
that import's unchanged contributions; repeat while undo is incomplete.
Imported consent and sampling are unknown, rather than invented.

`tests/fixtures/umami-events.json` is synthetic test data with `/`, `/thanks`,
`signup=/thanks`, `launch` and `search.example`. Its October 2026 dates may fall
outside the current report window; select From 2026-10-01 and Until 2026-10-04
to see them. The full archive/journal retains all three records. Production never loads this fixture itself.

**Data history → Download installation archive** exports every site's analytics,
proposals, deletion journal and import custody, excluding authentication. Restore
from **Data history** after signing into an empty analytics installation. Supply
any later export as **Later journal**: old archives are refused when it records
a later deletion. A fresh installation cannot know about an omitted journal.
Checksums detect corruption, not a malicious archive author; accept only your
own archives. Browser transfer is limited to 10 MB / 50,000 rows. For larger
installations:

```sh
rer dev --stop
rer export --output ../vane-installation.rer
# In an empty destination checkout, after rer install:
rer import --input ../vane-installation.rer --yes
```

RER installation archives also carry access-control records, suspend local dev
identities, exclude sessions/secrets and preserve migration history. Supply
`--journal ../later-installation.rer` after erasure. Keep private settings and
archives outside source control. `rer reset --yes` destroys local state; export
before using it.

The owner can **Prepare history erasure**, then approve the permanent deletion.
**Apply retention** erases events older than the configured window: 30, 90 or 365 days, 13 or 25 months, or never on a keep-forever site.
Retention is manual in this release. Repeat until imported rows are processed.
Deletion retires affected import custody and records a deletion fence.

## Exports and Looker Studio

Every report table downloads as CSV, and **Whole site as a ZIP of CSVs** on a report gives every date in the layout of Plausible's export. In a site's settings the owner can schedule a daily export to their own Amazon S3 or Cloudflare R2 bucket: each ended date arrives as `daily_rollups/<date>.csv` and `events/<date>.csv`, without visitor hashes, in the schema published at `/api/v1/export-schema.json`. BigQuery and Snowflake load those files through their S3 stage.

### Looker Studio

`connectors/looker-studio` holds a community connector. Push it to a new Apps Script project with `clasp push`, deploy it from its manifest, then add it in Looker Studio with a site's Stats API key (Settings, API keys), the installation's address and the site ID.

### Server-side and mobile events

Create an **events token** for one site on the API keys page, then `POST /api/v1/events` with `Authorization: Bearer <token>` and one event (or `{"events": [...]}` with up to 100): the script's fields, `type` `pageview` or `event`, and the visitor's `client_ip` and `user_agent`, which are used only to count visitors and classify devices and are never stored. Send an `Idempotency-Key` header to make a retry safe for 24 hours.

### Email reports

In a site's settings anyone on the team subscribes to a daily, weekly or monthly report at an hour in the site's time zone; the owner can also add outside recipients. Each email has the headline figures with their comparison, top pages and sources, goals, revenue, coverage notes and what moved, and a one-click unsubscribe link. Mail goes through the installation's configured mail provider.

### Browser alerts

Vane installs as an app from the browser's menu (Install app or Add to Home Screen). Under **Browser alerts** in the account menu, turn on alerts in each browser you want them in and send a test alert. Each alert is encrypted for that browser and carries only its title, the site name and a link; turning alerts off, or removal from the team, forgets the browser.

### Webhooks

In a site's settings an owner or administrator adds an https endpoint. Goal conversions arrive as signed JSON counts per goal and minute; check `Vane-Signature` (`t=<unix time>,v1=<HMAC-SHA256 of t.body>`) with the secret shown when you add it, and keep one copy per `Vane-Delivery`. The settings page lists every attempt.

### Assistants (MCP)

Point an MCP client at `POST <installation>/api/v1/mcp` with the header `Authorization: Bearer <Stats API key>`. Its `list_sites` and `query_stats` tools read the key's sites and answer exactly as `/api/v1/stats`; write tools are refused until agent grants exist.

## Commands and roles

[Agent command protocol](docs/commands.md): authenticated administrators prepare
`site.create`, `site.configure` and `history.erase`; the owner reviews and decides
in the UI. No approval command is exposed by the agent protocol. Every private
handler enforces native sessions and roles. Members read reports; owners import,
export, restore and approve deletion. Base's `/auth/invite` supports real member
and administrator invitations through ordinary email links.

## Deploy

Stop dev and commit changes, then validate with no provider calls:

```sh
rer deploy --dry-run
```

For a real deploy, use a Cloudflare account with a workers.dev subdomain and a
Workers/D1 management token, plus a verified Resend sender. Set `MAIL_FROM` in
`deploy.json` to that sender and commit. Supply `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, `OWNER_EMAIL` and `MAIL_API_KEY` in a private mode-0600
environment file outside this checkout, or your process environment. RER
supplies initial session/setup secrets and claims the owner. Never print or
commit values.

To show later bounces and spam complaints on email reports (REPORT-001), add the
provider's webhook for delivery events pointing at `https://<your origin>/api/vane/mail-events`
and set its signing secret (Resend `whsec_...`) or public key (SendGrid) as the
`MAIL_WEBHOOK_KEY` Worker secret.

```sh
rer deploy --env-file /absolute/private/vane-deploy.env
```

Deploy builds, creates D1, applies migrations and checks health/setup. It runs no
tests. Back up private `.rer/deploy/` resource-ownership records. Open the hosted
address, sign in through your mailbox, finish setup and register your website.
Identity is `analytics/vane`, Worker `vane-production`, D1 `vane-production-db`;
do not rename these. Domain purchase is unnecessary. This round validates local
hosting and dry run, with no live provider calls.

## Development

```sh
rer check --profile first-party
rer verify
```

Verify builds, typechecks, tests public flows and checks hosted assets. CI runs
one Verify per push. Build/deploy do not run tests. See [acceptance](ACCEPTANCE.md)
and [source attribution](SOURCES.md). MIT licensed.

## Run site and documentation

`rer build --site` writes the static run site to `dist/site`: the Vane
homepage approved on the design desk (17 Oct 2026), `/run`, `/docs`, six
Markdown guides and a not-found page. The homepage, docs and `/run` share the
installed app's tokens (`public/rer-theme.css`), Inter Tight and Inter type and
the swallow mark; the painted hero, interlude and closing are local AVIF/WebP
files in `public/site/art/`. All fonts and artwork are served locally.
`rer dev` prints the separate `RER_SITE` address alongside the installed app.
It preserves the installed `/` Lobby and never adds marketing routes to the app.

The docs manifest is `src/site/docs/manifest.ts`. Add or update repository
Markdown there; the site build reads the files directly. Links to published
Markdown become `/docs` links. Other repository files link to Source.

The site workflow is gated by `RUN_SITE_DEPLOY` and publishes to
https://run-vane.com on pushes to `main` when enabled. `deploy-site.json`
declares the public domain. The hosted demo is https://demo.run-vane.com/ (see
[DEMO.md](DEMO.md)).

# Move Matomo history into Vane

Open a site's **Data history**, then **Read Matomo history**. This works with
Matomo Cloud or a publicly reachable Matomo installation. Enter its HTTPS
Reporting API address (usually `https://analytics.example.com/index.php`),
numeric site ID, the source site's local date, its currency and a Reporting API
token with view access. Use a token you control; Vane uses it for that request
and never saves it or puts it in the preview, journal or archive.

Vane requests daily aggregate JSON reports through `API.getBulkRequest`, with
`format_metrics=0`, `flat=1` and `filter_limit=-1`. It reads visits and unique
visitors, actions and pages, referrers and campaigns, country/region/city,
device/browser/system, goals and ecommerce SKU reports. It never calls `Live`
or reads visitor logs. HTTP redirects, private endpoint addresses, source
errors, unsupported report types and responses larger than 2 MB are refused before
anything is applied. A request accepts up to 500 report rows; choose a smaller
source site/report export when more are needed.

Review the source report tables and definitions. **Apply import** approves that
exact sanitized fingerprint. A larger import may need **Apply import** again
to finish; repeating it resumes the same job without counting a row twice.
The journal downloads from the same page. **Undo import** removes the imported
rows; repeat while undo is in progress. Approved native goals are settings and
remain when history is undone.

Every aggregate table keeps its source measures and definition. Matomo's visits,
unique visitors, actions, goal conversions, source rates and currency remain
Matomo's. Independent breakdowns are never summed together and Vane never
fabricates visitor hashes or event rows from counts. Coverage is unknown.
Source reports appear alongside native totals in the selected date range;
merging source totals into native charts is the separate IMPORT-007 clause.

Goals show their source names and conditions. Prepare a supported exact URL or
case-sensitive event-name goal, then review it in **Approvals**. Approval makes
that native goal count future matching page loads or custom events. Revenue
goals match an event carrying revenue in the confirmed currency. Conditions
that cannot be represented exactly appear under **Needs completion**, with the
source predicate, for a person to complete. Nothing silently widens a source
condition or approves itself.

An offline report bundle may also be uploaded through **Import a document**:
`{"format":"vane-matomo-reports/1","day":"2026-10-01","currency":"USD","reports":{...},"goals":{...}}`.
Each `reports` key is the exact Matomo API method, containing its unformatted
JSON response; `goals` is the `Goals.getGoals` response. The repository fixture
`tests/fixtures/matomo-reports.json` shows this transport format. It is not a
Matomo visitor-log export.

Source schema: [Matomo Reporting API](https://developer.matomo.org/api-reference/api)
and [Goals module](https://developer.matomo.org/guides/reporting-api#module-goals).

For report CSV exports, use **Import Matomo report CSV**. Choose the exact
Reporting API method, local date and currency, and upload the unformatted flat
CSV. A summary report contains one data row; a breakdown contains one per
label. Repeat for each report. No column names are guessed or mapped to a
different source metric.
### Google Search Console

Create a Google OAuth web client with the Search Console API enabled. Set Worker secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; register `https://<installation>/api/vane/search-console/callback` as the authorized redirect URI. The owner connects in site settings, approves only `webmasters.readonly`, then chooses a property returned by Google. No Google account is needed to use native Vane analytics.

Source dates are Pacific dates and end dates are exclusive in Vane. Sync a custom source range in settings to fetch any available part of Google's 16-month history. Daily checks revisit unpublished dates; an absent date stays pending. Source query/page sets omit anonymized or lower-ranked rows and need not sum to overall totals. Clicking a query filters Vane's organic visits by its sanitized landing paths; Vane visitors are daily unique hashes, not identified Google searchers. Disconnect revokes and deletes credentials while retaining fetched, exportable source aggregates.

