# First release

- Sign in as owner, prepare a site or settings through the UI or agent command, and approve it with a recorded decision; administrators prepare and members read.
- Add one script tag and see consent-aware, cookie-free page-load visits, sources, campaigns, goal conversions and a weekly comparison with explicit sampling/coverage limits.
- Preview a documented Umami v2 Events page without writes, approve its sanitized import, inspect the durable journal and undo its contributions.
- Export and restore complete analytics history into an empty installation; reject corrupt archives and old history fenced by a supplied later deletion journal.
- Approve history erasure or apply the declared retention window, removing live/imported data and retiring import custody.
- Follow the public run-site homepage to `/run` and `/docs`; follow each guide's navigation and local links through the built static site.
- Build documentation directly from repository Markdown, with readable code, tables, section links, and optional clipboard controls.
- Present the approved indigo-isobar landing page in the shared Geologica theme; stack its three hero cards and feature bands on phones.
- Preserve the installed Lobby, real sign-in/setup flows and existing app actions; never seed the landing drawing's sample counts into analytics.

Not required: domain purchase, live provider calls, a hosted demo, fleet rollout,
unique visitor/session counts, cross-site tracking,
fingerprinting, ad attribution, session replay or product analytics. Independent
release review is a later stage.

Functional site check: `rer build --site`, then `node --test tests/site.test.mjs`.
Shared type check: `pnpm typecheck`. The independent visual gate compares the
built homepage at 1440 and 390 with the approved SPEC and picks.
