# Changelog

## 0.1.0 — 2026-11-26

The first release. Vane is cookie-free website analytics, and it runs in your own Cloudflare account.

Prepare Vane for hosted installation with a generated delivery descriptor, Managed mail relay support, source provenance and synthetic integration fixtures.

### What a site owner gets

- **Analytics without cookies.** One script tag counts page loads, sources, campaigns and goal conversions; it uses no cookies or browser storage and stores no IP address, user agent or visitor ID.
- **Changes a person approves.** Administrators prepare a site's settings; only the owner approves, and actor and time are recorded.
- **Move in and take it with you.** Import Umami, PostHog and Simple Analytics pages and read-only GA4 data, with undo; export, archive and restore the full history.
- **Hosting you can measure.** The hosting panel projects usage from measured collection work, and a running install moves from a local computer to Cloudflare intact.
- **Mail optional.** A Business can run Vane with mail off, or configure Managed or direct-provider mail.

### Not in this release

Visits mean accepted page loads, not unique people or sessions; blocked, excluded and non-consenting loads are not counted, and the 10-million-a-month collection target is not yet proven.

### Upgrading

This is the first tagged release; every migration under `migrations/core` counts as added. Preserve the analytics project identity and existing migration bytes.

### Earlier work, 19 October 2026

- Carry the owner-picked app look through every app screen: a slim rail with the
  swallow mark, site switcher and live count; an Overview with a top bar, five
  metric cards that pick the chart, a stretched chart that marks days outside
  normal variation, four short tables and a What changed panel with the change
  waiting for approval; the full report groups below, reached from the rail.
- Quiet one-pixel fields with a blue focus ring, near-black pill buttons and
  Base's two-gradient select chevron on every screen, at 1440 and 390 px.
- Load nine weeks of US demo traffic with devices, channels, returning visitors
  and one annotated day when the shop's page loads went unrecorded.
- Compare like with like while today is running: the compared period stops at
  the same time of day on its matching day, for the cards, the sites list's
  change and the What changed evidence; Today's chart stops at the current hour
  and its panel says the day is still running instead of judging it.
- US dates in the app's own text, readable names in Approvals and Audit history,
  one-line labels in report tables, 24 px checkboxes, and field borders at
  about 3:1 without changing the brand file's tokens.

### Earlier work, 16 October 2026

- Run the hosted demo on rer 0.2.30's native Worker Loader host instead of a
  container; Base copies refreshed from rer-v0.2.30.
- Implement the approved Vane run-site homepage: an indigo isobar setting,
  three real-product steps and six concise feature bands.
- Add on-site documentation rendered from repository Markdown, with navigation,
  section links, code copying and responsive tables.
- Carry the shared Vane theme through the Base `/run` page and public 404.
- Share Geologica, Plex Mono and indigo tokens across setup, sign-in and the app.
- Add accessible account navigation and script copying to the app.
- Update the published rer pin to 0.2.20.
- Keep the installed Lobby and authenticated product routes intact. No sample
  analytics or hosted demo is added.
- Add the gated run-site workflow; deployment remains disabled and the existing
  site domain is run-vane.com.
