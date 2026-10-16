# Try Vane

Run `rer demo` for a fresh, signed-in Vane Demo. Stop it with `rer demo --stop`.
The demo uses `.rer/demo/`, leaves `.wrangler/state` alone, and deletes its data
on stop. Another start gets a new workspace. There is no demo bar or outbox.

Three configured websites have two weeks of recent page loads, sources, campaigns
and goals, approved site history and a pending campaign change to review.
`src/demo.ts` loads real records with fixed IDs and never fetches.

Base's v2 guard allows public reads and mocks effects on people and third-party
accounts. Vane's sign-in and invitation mail uses Base's silent development
sender without a provider secret. Analytics collection stays inside the visitor's copy.
The hosted instance accepts Base's signed owner claim at `/auth/owner-claim`.

`.github/workflows/run-demo.yml` reads the `run-demo` GitHub environment. Dispatch
it with `test_only` for the separate test host and published Turnstile test keys;
use `test_only` plus `remove` to delete that host. Dispatch without those inputs
for production, after the real widget's site key and secret are configured. Each
visitor gets their own native Worker Loader isolate and SQLite copy of the
database, erased after 60 minutes or 15 idle minutes.
Production start pages never sign a visitor in until Turnstile passes.

`deploy-demo.json` declares the hostname, product name, demo owner and plain
mail sender settings. Real deployments refuse `RER_DEMO` settings. Base's adoption
guide is https://github.com/runeditrun/base/blob/rer-v0.2.30/default-seed/DEMO.md.
