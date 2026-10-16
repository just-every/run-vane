# Vane

Cookie-free website analytics in your own account. Add a script, count page
loads, sources, campaigns and goal conversions, then export or restore history.
The run site presents the product, launch instructions and documentation built
from this repository's Markdown. Installed instances open on their own Lobby.

The public site is at https://run-vane.com.

## Run locally

Install Git, then run one line. It installs RER, clones Vane and starts it:

```sh
npx -y @runeditrun/rer dev just-every/run-vane
```

To start it again later, run `cd run-vane && rer dev`. Add the installer's printed directory to your shell PATH if requested. `rer dev`
installs pinned dependencies, selects Node 22.20.0, and prepares a local owner
and D1 database. The first launch takes a few minutes and prints progress. Open
`RER_OPEN` on this computer, confirm the owner on **Finish setup**, then open
**Your sites**. The link is a credential: keep it private. No external email is
sent. Repeating `rer dev` reuses the server. Stop with `rer dev --stop`.

For your own identity on a fresh checkout, use `rer install`, then
`rer setup --owner-email you@example.com`, then `rer dev`. Use `rer dev --login`
for ordinary email-link sign-in through the private local outbox. Local personas
`rer dev --as admin` and `rer dev --as member` use real administrator/read-only
roles. Never use the review identity as your production owner.

## First website

1. In **Add a site**, enter a name and exact origin, such as
   `https://fern.example`. Enter `/`, `/pricing` and `/thanks` as allowed paths, one per line;
   `signup=/thanks` as a goal; `launch` as a campaign; and `search.example` as a
   referring hostname. Choose consent mode. List only public static paths and
   labels, never names, addresses or customer identifiers.
2. **Prepare site**, review the complete proposal in **Approvals**, then
   **Approve change** as owner. Administrators prepare; only the owner approves.
   Both actor and time are recorded.
3. Open the site and **Settings**. Copy its script tag into your website. For
   consent-required sites, load it after consent and set
   `window.vaneConsent = true` before it runs. If your site has a CSP, allow
   Vane's origin in `script-src` and `connect-src`.
4. Visit an allowed page, then `/thanks?utm_campaign=launch`. **Report** shows
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
scaled estimates. Unknown sources/campaigns become `other`; no referrer becomes
`direct`. Consent exclusions, blockers and unlisted pages are invisible, so
Vane does not claim complete traffic coverage or inferred causes. Non-browser
senders can spoof the public collector. Admission is capped at 10,000 page loads
per site per UTC day.

## Import, undo and portability

The first move-in kit accepts **Umami v2 Events API** JSON pages. Read
[the documented shape and limits](docs/umami-import.md). In a site's **History**,
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
**Apply retention** erases events older than the configured 30, 90 or 365 days.
Retention is manual in this release. Repeat until imported rows are processed.
Deletion retires affected import custody and records a deletion fence.

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

`rer build --site` writes the static run site to `dist/site`: the approved
Vane homepage, `/run`, `/docs`, seven Markdown guides and a not-found page.
The homepage and docs share the installed app's Geologica type, paper and ink
tokens, and indigo isobar artwork. All fonts and artwork are served locally.
`rer dev` prints the separate `RER_SITE` address alongside the installed app.
It preserves the installed `/` Lobby and never adds marketing routes to the app.

The docs manifest is `src/site/docs/manifest.ts`. Add or update repository
Markdown there; the site build reads the files directly. Links to published
Markdown become `/docs` links. Other repository files link to Source.

The site workflow is gated by `RUN_SITE_DEPLOY` and publishes to
https://run-vane.com on pushes to `main` when enabled. `deploy-site.json`
declares the public domain. There is no hosted demo.
