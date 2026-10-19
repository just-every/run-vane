# Collection and coverage

Vane records accepted page loads for the paths you approve. A goal is a load of its configured path. Reports show recorded counts, with the previous period alongside them.

## What is collected

The script sends approved paths and labels, a fresh event ID and consent state. Analytics stores no IP address, user agent, visitor ID, full URL or arbitrary properties. The script uses no cookies or browser storage. Owner sign-in data is separate.

Only allowed paths, configured campaign labels and referring hostnames enter analytics. Campaigns come from `utm_campaign`. Unknown sources and campaigns become `other`; no referrer becomes `direct`.

## Consent and browser signals

Choose **Consent required** or **Consent not required** in collection settings. For consent-required sites, load the script only after consent and set `window.vaneConsent = true` before it runs.

Do Not Track and Global Privacy Control stop collection. To see how much traffic sends either signal, turn on **Count privacy signals** in a site's settings and, after approval, copy the updated snippet: it adds `data-count-signals`, and each signalling page load then sends one count that carries no path, source, campaign or identifier. The report shows the count and its share beside the other coverage limits. Settings and the installation's public `/methodology` page state Vane's stance under the CCPA/CPRA and the other US state privacy laws. Blockers, consent exclusions and unlisted pages are invisible to the report. Vane does not measure complete traffic coverage.

## Sampling

Choose 10%, 25%, 50% or 100% of eligible loads. Report counts are observed counts; they are never scaled into estimates. The report's **Coverage and collection limits** shows the configured sample rate and consent mode.

Imported activity has unknown consent and sampling. Vane keeps those values unknown.

## Reading changes

Every report compares the selected period against its preceding period. The default is the current seven UTC days against the seven before. The **Weekly explanation** gives both counts and the difference, with evidence tables below.

Changes in recorded activity alone do not establish why people acted. Counts are page loads, rather than people or sessions. Non-browser senders can spoof the public collector. Admission is capped at 10,000 page loads per site per UTC day.

## Change collection settings

Open **Settings**, edit **Collection settings** and select **Prepare settings change**. The owner reviews the proposal in **Approvals**. Changes take effect after approval. Keep paths and labels public and free of personal identifiers.
