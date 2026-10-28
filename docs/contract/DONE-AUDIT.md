Carried-done audit of every clause done at `7d02f5807e148660e634f62b713d1fa39e468d4c`, the main commit both maps name.

| Clause | Point | Outcome | Asserting test | Result |
| --- | --- | --- | --- | --- |
| `HTTP-001` | 1 | /health requested signed out on the built Worker | `tests/vane-access.mjs:6` | asserted |
| `HTTP-001` | 1 | /vane.js requested | `tests/vane-access.mjs:9` | asserted |
| `HTTP-001` | 1 | unknown paths requested | `tests/vane-access.mjs:21` | asserted |
| `HTTP-001` | 1 | every private route requested signed out | `tests/vane-access.mjs:23` | asserted |
| `HTTP-001` | 2 | health answers | `tests/vane-access.mjs:6` | asserted |
| `HTTP-001` | 2 | the script is served | `tests/vane-access.mjs:9` | asserted |
| `HTTP-001` | 2 | unknown paths return 404 | `tests/vane-access.mjs:21` | asserted |
| `HTTP-001` | 2 | private API routes return 401 | `tests/vane-access.mjs:23` | asserted |
| `HTTP-001` | 2 | private app routes redirect to sign-in | `tests/vane-access.mjs:26` | asserted |
| `ACCESS-001` | 1 | an administrator is invited and holds a working session | `tests/vane-access.mjs:38` | asserted |
| `ACCESS-001` | 1 | a member is invited and reads sites | `tests/vane-access.mjs:36` | asserted |
| `ACCESS-001` | 2 | the member cannot prepare a site | `tests/vane-access.mjs:33` | asserted |
| `ACCESS-001` | 2 | the administrator cannot approve | `tests/vane-access.mjs:35` | asserted |
| `ACCESS-001` | 2 | the administrator cannot import or restore | `tests/vane-access.mjs:40` | asserted |
| `ACCESS-001` | 2 | export is owner-only (member and administrator refused, owner succeeds) | `tests/vane-access.mjs:37` | asserted |
| `ACCESS-001` | 2 | export by the owner succeeds | `tests/vane-access.mjs:39` | asserted |
| `ACCESS-001` | 2 | revoking the administrator ends their session | `tests/vane-access.mjs:46` | asserted |
| `ACCESS-002` | 1 | private GET doors called signed out are refused | `tests/vane-access.mjs:23` | asserted |
| `ACCESS-002` | 1 | private POST doors called signed out are refused | `tests/vane-access.mjs:24` | asserted |
| `ACCESS-002` | 1 | a private door after sign-out is refused | `tests/vane-access.mjs:28` | asserted |
| `ACCESS-002` | 1 | a mutation with a foreign Origin is refused | `tests/vane-access.mjs:25` | asserted |
| `ACCESS-002` | 2 | each signed-out, post-sign-out and foreign-Origin call is refused | `tests/vane-access.mjs:24` | asserted |
| `ACCESS-002` | 2 | "with no write" restated BASE-ACCESS-002 and left the point (base) | — | moved |
| `APPROVE-001` | 1 | an administrator prepares a site proposal | `tests/vane-access.mjs:41` | asserted |
| `APPROVE-001` | 1 | the owner approves it | `tests/vane-access.mjs:41` | asserted |
| `APPROVE-001` | 1 | a second approval gets 409 | `tests/vane-access.mjs:42` | asserted |
| `APPROVE-001` | 2 | the proposal records distinct preparer and approver | `tests/vane-access.mjs:43` | asserted |
| `COLLECT-001` | 1 | an event from a foreign origin is refused with 403 | `tests/vane-access.mjs:50` | asserted |
| `COLLECT-001` | 1 | an event with an extra personal field is refused with 400 | `tests/vane-access.mjs:51` | asserted |
| `COLLECT-001` | 1 | a path carrying a query is refused with 400 | `tests/vane-access.mjs:52` | asserted |
| `COLLECT-001` | 2 | a valid event is accepted (202) | `tests/vane-access.mjs:53` | asserted |
| `COLLECT-001` | 3 | a default-mode pageview leaves no cookie and no storage entry | `tests/vane-access.mjs:237` | asserted |
| `COLLECT-001` | 3 | #vane-ignore=on writes only vane_ignore and excludes that browser | `tests/vane-access.mjs:239` | asserted |
| `COLLECT-001` | 3 | #vane-ignore=off clears it | `tests/vane-access.mjs:241` | asserted |
| `COLLECT-001` | 4 | /methodology and the report's data inventory name both storage exceptions | `tests/vane-access.mjs:245` | asserted |
| `COLLECT-001` | 5 | with DNT and then GPC set, a page load sends nothing while the counter is off | `tests/vane-access.mjs:213` | asserted |
| `COLLECT-001` | 5 | exactly one field-free count and nothing else while it is on | `tests/vane-access.mjs:211` | asserted |
| `COLLECT-001` | 5 | the count carries no fields | `tests/vane-access.mjs:223` | asserted |
| `COLLECT-001` | 6 | an unapproved compatibility proposal changes nothing | `tests/vane-access.mjs:15` | asserted |
| `COLLECT-001` | 6 | approval adds only the compatibility flag and ISO currency | `tests/vane-access.mjs:17` | asserted |
| `COLLECT-001` | 6 | private fields stay absent | `tests/vane-access.mjs:18` | asserted |
| `COLLECT-001` | 6 | approved opt-out restores the exact earlier response bytes | `tests/vane-access.mjs:20` | asserted |
| `CONSENT-001` | 1 | on a consent-required site an event without granted consent is refused with 403 | `tests/vane-access.mjs:58` | asserted |
| `CONSENT-001` | 1 | an event with granted consent is accepted | `tests/vane-access.mjs:59` | asserted |
| `DEDUP-001` | 1 | the first copy is accepted (202) | `tests/vane-access.mjs:53` | asserted |
| `DEDUP-001` | 1 | the identical repeat answers 200 with nothing counted | `tests/vane-access.mjs:54` | asserted |
| `DEDUP-001` | 1 | a conflicting copy gets 409 | `tests/vane-access.mjs:55` | asserted |
| `DEDUP-001` | 2 | the report counts one visit | `tests/vane-access.mjs:56` | asserted |
| `TRAFFIC-001` | 1 | events collected in two adjacent periods of the same length; the summary reads both | `tests/vane-access.mjs:117` | asserted |
| `TRAFFIC-001` | 2 | compared totals show the previous-period count and change | `tests/vane-access.mjs:118` | asserted |
| `TRAFFIC-001` | 2 | referring-hostname rows show previous count and change | `tests/vane-access.mjs:120` | asserted |
| `TRAFFIC-001` | 2 | campaign rows show previous count and change | `tests/vane-access.mjs:121` | asserted |
| `TRAFFIC-001` | 2 | page rows show previous count and change | `tests/vane-access.mjs:122` | asserted |
| `TRAFFIC-001` | 2 | goal rows show previous count and change | `tests/vane-access.mjs:123` | asserted |
| `TRAFFIC-001` | 2 | the change is shown on the report page | `tests/vane-access.mjs:130` | asserted |
| `TRAFFIC-001` | 2 | counts and coverage-limit text match the seeded events | `tests/vane-access.mjs:125` | asserted |
| `IMPORT-001` | 1 | preview has no raw identifiers | `tests/vane-access.mjs:63` | asserted |
| `IMPORT-001` | 1 | preview writes nothing | `tests/vane-access.mjs:65` | asserted |
| `IMPORT-001` | 1 | apply with a changed fingerprint gets 409 | `tests/vane-access.mjs:66` | asserted |
| `IMPORT-001` | 1 | applying twice gives one job | `tests/vane-access.mjs:67` | asserted |
| `IMPORT-001` | 1 | the journal is read | `tests/vane-access.mjs:71` | asserted |
| `IMPORT-001` | 1 | undo removes the imported events | `tests/vane-access.mjs:72` | asserted |
| `ARCHIVE-001` | 1 | a corrupted archive restore returns 400 | `tests/vane-access.mjs:77` | asserted |
| `ARCHIVE-001` | 1 | the corrupt restore writes nothing | `tests/vane-access.mjs:78` | asserted |
| `ARCHIVE-001` | 2 | the real archive restores into an empty installation | `tests/vane-access.mjs:79` | asserted |
| `ARCHIVE-001` | 2 | the restored tables are identical | `tests/vane-access.mjs:89` | asserted |
| `ARCHIVE-001` | 2 | restoring again gets 409 | `tests/vane-access.mjs:90` | asserted |
| `ARCHIVE-001` | 2 | the restored import can be undone | `tests/vane-access.mjs:92` | asserted |
| `ERASURE-001` | 1 | a site with live and imported history is erased through the owner's approval | `tests/vane-access.mjs:100` | asserted |
| `ERASURE-001` | 2 | live and imported history are gone | `tests/vane-access.mjs:101` | asserted |
| `ERASURE-001` | 2 | the deletion and erasure journals exist | `tests/vane-access.mjs:101` | asserted |
| `ERASURE-001` | 2 | restoring the old archive with the later journal is refused | `tests/vane-access.mjs:102` | asserted |
| `RETENTION-001` | 1 | old history imported, a recent event collected and retention applied until it completes | `tests/vane-access.mjs:107` | asserted |
| `RETENTION-001` | 2 | old history is gone | `tests/vane-access.mjs:108` | asserted |
| `RETENTION-001` | 2 | the recent event remains | `tests/vane-access.mjs:108` | asserted |
| `RETENTION-001` | 2 | one deletion is journaled | `tests/vane-access.mjs:108` | asserted |
| `RUNSITE-001` | 1 | the homepage reaches /run and /docs | `tests/site.test.mjs:31` | asserted |
| `RUNSITE-001` | 1 | /run shows the real launch command | `tests/site.test.mjs:35` | asserted |
| `RUNSITE-001` | 1 | every local link from the built homepage and guides resolves | `tests/site.test.mjs:44` | asserted |
| `RUNSITE-001` | 1 | the run site contains only public routes | `tests/site.test.mjs:45` | asserted |
| `DOCS-001` | 1 | each guide is built and opened | `tests/site.test.mjs:58` | asserted |
| `DOCS-001` | 2 | code blocks render | `tests/site.test.mjs:58` | asserted |
| `DOCS-001` | 2 | tables render | `tests/site.test.mjs:59` | asserted |
| `DOCS-001` | 2 | heading anchors render | `tests/site.test.mjs:61` | asserted |
| `DOCS-001` | 2 | the clipboard control copies the block | `tests/site.test.mjs:84` | asserted |
| `HOME-001` | 1 | at 390 px the hero cards sit under their copy | `tests/site.test.mjs:133` | asserted |
| `HOME-001` | 1 | at 390 px every section's drawing sits under its copy | `tests/site.test.mjs:132` | asserted |
| `HOME-001` | 1 | no sideways scrolling at 390 px | `tests/site.test.mjs:134` | asserted |
| `HOME-001` | 1 | at 1440 px each two-column section's drawing sits beside its copy | `tests/site.test.mjs:135` | asserted |
| `HOME-001` | 1 | at 1440 px the wind trail runs down the page | `tests/site.test.mjs:137` | asserted |
| `HOME-001` | 1 | every font, image and style comes from the run site itself | `tests/site.test.mjs:140` | asserted |
| `HOME-001` | 1 | Inter Tight and Inter are loaded | `tests/site.test.mjs:142` | asserted |
| `HOME-001` | old 1 | the independent visual gate's comparison with the approved specification (a human pass) moved to register row R-10 | — | moved |
| `LOBBY-001` | 1 | on a fresh installation the owner completes /setup | `tests/vane-access.mjs:156` | asserted |
| `LOBBY-001` | 1 | the owner signs in by email link | `tests/vane-access.mjs:160` | asserted |
| `LOBBY-001` | 1 | the owner opens /app | `tests/vane-access.mjs:168` | asserted |
| `LOBBY-001` | 2 | no landing-drawing numbers appear in analytics | `tests/vane-access.mjs:164` | asserted |
| `DEPLOY-001` | 1 | with the variable unset the run-site workflow skips deployment | none | none |
| `DEPLOY-001` | 2 | the identifiers in wrangler.jsonc, package.json and edition.json are unchanged | none | none |
| `INSTALL-001` | 1 | a fixture site without the script names that cause | `tests/vane-access.mjs:184` | asserted |
| `INSTALL-001` | 1 | a wrong site ID names that cause | `tests/vane-access.mjs:186` | asserted |
| `INSTALL-001` | 1 | a CSP that blocks the script names that cause | `tests/vane-access.mjs:188` | asserted |
| `INSTALL-001` | 2 | the correct installation turns verified when the first event arrives | `tests/vane-access.mjs:200` | asserted |
| `INSTALL-001` | 2 | the site leaves Awaiting first event | `tests/vane-access.mjs:201` | asserted |
| `INSTALL-001` | 3 | the Worker's outbound requests during each check are only the homepage GET and at most five redirects | none | none |
| `INSTALL-001` | 3 | the check carries no visitor data | none | none |
| `INSTALL-001` | 3 | only the pass/fail result is stored | none | none |
| `INSTALL-007` | 1 | a React Router fixture navigates four views (tour at line 93) | `tests/vane-conversions.mjs:92` | asserted |
| `INSTALL-007` | 1 | a hash-routed fixture navigates four views (tour at line 94) | `tests/vane-conversions.mjs:92` | asserted |
| `INSTALL-007` | 2 | four pageviews with the right paths and no duplicates | `tests/vane-conversions.mjs:92` | asserted |
| `INSTALL-007` | 2 | a manual pageview arrives with its path and kept UTM field | `tests/vane-conversions.mjs:98` | asserted |
| `INSTALL-007` | 2 | the props breakdown is a pointer to CONV-002's acceptance, moved to the Requirement | — | moved |
| `INSTALL-008` | 1 | events sent from a server with a site token are accepted | `tests/vane-mobile-and-api.mjs:194` | asserted |
| `INSTALL-008` | 1 | a duplicate idempotency key repeats the first answer | `tests/vane-mobile-and-api.mjs:199` | asserted |
| `INSTALL-008` | 1 | a token for another site is used | `tests/vane-mobile-and-api.mjs:208` | asserted |
| `INSTALL-008` | 2 | events count once | `tests/vane-mobile-and-api.mjs:202` | asserted |
| `INSTALL-008` | 2 | the foreign token is refused | `tests/vane-mobile-and-api.mjs:208` | asserted |
| `INSTALL-008` | 2 | no raw IP or user agent is stored | `tests/vane-mobile-and-api.mjs:206` | asserted |
| `COLLECT-002` | 1 | pages with emails, tokens, order numbers and UTM and click-ID queries are loaded | `tests/vane-reports.mjs:253` | asserted |
| `COLLECT-002` | 2 | stored paths are redacted | `tests/vane-reports.mjs:256` | asserted |
| `COLLECT-002` | 2 | no raw value survives in storage | `tests/vane-reports.mjs:264` | asserted |
| `COLLECT-002` | 2 | UTM values and the paid-click flag are kept | `tests/vane-reports.mjs:258` | asserted |
| `COLLECT-002` | 2 | a rewrite rule groups the order pages | `tests/vane-reports.mjs:269` | asserted |
| `COLLECT-002` | 3 | ?ref=producthunt and ?source=newsletter report those sources | `tests/vane-reports.mjs:262` | asserted |
| `COLLECT-002` | 3 | utm_source=google with ref=x reports google | `tests/vane-reports.mjs:258` | asserted |
| `COLLECT-003` | 1 | a headless browser is refused | `tests/vane-report-settings.mjs:215` | asserted |
| `COLLECT-003` | 1 | an opted-out browser sends only an empty count | `tests/vane-report-settings.mjs:219` | asserted |
| `COLLECT-003` | 1 | spam referrer, excluded IP and excluded country loads are refused with their reason | `tests/vane-report-settings.mjs:225` | asserted |
| `COLLECT-003` | 1 | real visits beside them are accepted | `tests/vane-report-settings.mjs:222` | asserted |
| `COLLECT-003` | 2 | only the real visits count | `tests/vane-report-settings.mjs:231` | asserted |
| `COLLECT-003` | 2 | the exclusion report shows each reason and its count | `tests/vane-report-settings.mjs:232` | asserted |
| `COLLECT-003` | 2 | the report page shows each reason with its share | `tests/vane-report-settings.mjs:234` | asserted |
| `COLLECT-004` | 1 | the load test admits every valid event exactly once at the stated volume | `tests/collection-scale.journey.mjs:120` | asserted |
| `COLLECT-004` | 1 | the burst runs at 500 events per second | `tests/collection-scale.journey.mjs:88` | asserted |
| `COLLECT-004` | 1 | concurrent retries admit an ID once | `tests/collection-scale.journey.mjs:65` | asserted |
| `COLLECT-004` | 2 | the 12-month dashboard query is timed under 2 seconds | `tests/collection-scale.journey.mjs:101` | asserted |
| `COLLECT-004` | 2 | the limit warning appears at the published threshold | `tests/vane-report-settings.mjs:81` | asserted |
| `COVERAGE-001` | 1 | declined consent combined on one site | `tests/vane-reports.mjs:383` | asserted |
| `COVERAGE-001` | 1 | sampling combined on the site | `tests/vane-reports.mjs:385` | asserted |
| `COVERAGE-001` | 1 | exclusions combined on the site | `tests/vane-reports.mjs:383` | asserted |
| `COVERAGE-001` | 1 | an import combined on the site | `tests/vane-reports.mjs:383` | asserted |
| `COVERAGE-001` | 1 | a Cloudflare zone comparison combined on the site | none | none |
| `COVERAGE-001` | 2 | the report shows each share with its denominator | `tests/vane-reports.mjs:385` | asserted |
| `COVERAGE-001` | 2 | the totals are labelled partial | `tests/vane-reports.mjs:385` | asserted |
| `METRIC-001` | 1 | pageviews from two simulated visitors over two days | `tests/vane-metrics.mjs:16` | asserted |
| `METRIC-001` | 2 | unique visitors are 2 per day | `tests/vane-metrics.mjs:16` | asserted |
| `METRIC-001` | 2 | the range shows 4 under the stated method | `tests/vane-metrics.mjs:17` | asserted |
| `METRIC-001` | 3 | the database and archive hold no IP or user agent | `tests/vane-metrics.mjs:23` | asserted |
| `METRIC-001` | 3 | the logs hold no IP or user agent | none | none |
| `METRIC-001` | 3 | no salt older than 24 hours is kept | `tests/vane-metrics.mjs:24` | asserted |
| `METRIC-001` | 3 | the same visitor hashes differently on another site | `tests/vane-metrics.mjs:20` | asserted |
| `METRIC-002` | 1 | one visitor's pageviews with gaps of 10, 40 and 5 minutes (loads at line 31) | `tests/vane-metrics.mjs:30` | asserted |
| `METRIC-002` | 2 | 2 visits, 4 pageviews and 2 pages per visit | `tests/vane-metrics.mjs:33` | asserted |
| `METRIC-003` | 1 | a quick bounce, a 45-second single-page visit and a three-page visit (loads at lines 48-50) | `tests/vane-metrics.mjs:45` | asserted |
| `METRIC-003` | 2 | the bounce rate matches | `tests/vane-metrics.mjs:53` | asserted |
| `METRIC-003` | 2 | visit durations match | `tests/vane-metrics.mjs:53` | asserted |
| `METRIC-003` | 2 | per-page time matches | `tests/vane-metrics.mjs:54` | asserted |
| `METRIC-004` | 1 | the methodology page opens signed out | `tests/vane-report-settings.mjs:183` | asserted |
| `METRIC-004` | 1 | each metric's definition link from the dashboard reaches its definition | `tests/vane-report-settings.mjs:186` | asserted |
| `METRIC-004` | 2 | the page states the roll-up rules and the two storage exceptions | `tests/vane-report-settings.mjs:187` | asserted |
| `METRIC-004` | 3 | a changed visit timeout shows a dated definition annotation on the charts | `tests/vane-report-settings.mjs:200` | asserted |
| `METRIC-005` | 1 | day-1 and day-8 consented visits give one returning visitor in the week-2 cohort | `tests/consented.test.mjs:51` | asserted |
| `METRIC-005` | 1 | the cohort table shows the week-2 return | `tests/consented.test.mjs:44` | asserted |
| `METRIC-005` | 2 | without consent the same visits count as cookie-free daily visitors | `tests/consented.test.mjs:42` | asserted |
| `METRIC-005` | 3 | a revoke deletes the identifier | `tests/consented.test.mjs:80` | asserted |
| `METRIC-005` | 4 | the methodology page defines consented mode, its identifier and lifetime | `tests/consented.test.mjs:64` | asserted |
| `METRIC-005` | 5 | a day-1 view and day-3 purchase complete a cross-visit funnel | `tests/consented.test.mjs:47` | asserted |
| `METRIC-005` | 5 | the visitor sees the same split-test variant on both days | `tests/consented.test.mjs:37` | asserted |
| `METRIC-006` | 1 | visits scroll a long fixture page to 50% and to 100% | `tests/vane-metrics.mjs:88` | asserted |
| `METRIC-006` | 2 | the page shows the average depth | `tests/vane-metrics.mjs:92` | asserted |
| `METRIC-006` | 2 | the page shows the 75% share | `tests/vane-metrics.mjs:92` | asserted |
| `DASH-001` | 1 | events are sent while the real-time view is open | `tests/vane-report-settings.mjs:163` | asserted |
| `DASH-001` | 2 | current visitors and the live lists update within 15 seconds without a reload | `tests/vane-report-settings.mjs:161` | asserted |
| `DASH-001` | 2 | the live pages and sources lists update | `tests/vane-report-settings.mjs:164` | asserted |
| `DASH-001` | 2 | current visitors and live lists drop after 5 idle minutes | `tests/vane-report-settings.mjs:173` | asserted |
| `DASH-002` | 1 | events either side of a US daylight-saving change and midnight in America/Chicago | `tests/vane-reports.mjs:411` | asserted |
| `DASH-002` | 2 | the daily buckets follow local days | `tests/vane-reports.mjs:408` | asserted |
| `DASH-002` | 2 | each preset range returns the expected totals | `tests/vane-reports.mjs:402` | asserted |
| `DASH-002` | 2 | the data table matches the chart | `tests/vane-reports.mjs:417` | asserted |
| `DASH-003` | 1 | visits with known entry and exit pages are seeded | `tests/vane-reports.mjs:6` | asserted |
| `DASH-003` | 2 | the top pages table matches | `tests/vane-reports.mjs:11` | asserted |
| `DASH-003` | 2 | the entry pages table matches | `tests/vane-reports.mjs:12` | asserted |
| `DASH-003` | 2 | the exit pages table matches | `tests/vane-reports.mjs:13` | asserted |
| `DASH-003` | 2 | grouping by /blog/* sums the posts | `tests/vane-reports.mjs:16` | asserted |
| `DASH-004` | 1 | visits with Google organic and paid, Facebook, an email UTM, chatgpt.com and five-field UTMs are sent | `tests/vane-reports.mjs:275` | asserted |
| `DASH-004` | 2 | each lands in its documented channel | `tests/vane-reports.mjs:289` | asserted |
| `DASH-004` | 2 | every UTM field is reportable | `tests/vane-reports.mjs:293` | asserted |
| `DASH-004` | 2 | each row's visitors, bounce rate and visit duration equal a hand count | `tests/vane-reports.mjs:289` | asserted |
| `DASH-005` | 1 | events with Cloudflare geo for Texas, Ontario and London are sent | `tests/vane-reports.mjs:63` | asserted |
| `DASH-005` | 2 | reports show the country | `tests/vane-reports.mjs:71` | asserted |
| `DASH-005` | 2 | reports show the region | `tests/vane-reports.mjs:72` | asserted |
| `DASH-005` | 2 | reports show the city | `tests/vane-reports.mjs:73` | asserted |
| `DASH-005` | 2 | no IP appears anywhere in storage | `tests/vane-reports.mjs:94` | asserted |
| `DASH-005` | 3 | Austin with 12 visitors and Marfa with 3 are seeded and a shared link opened | `tests/vane-reports.mjs:82` | asserted |
| `DASH-005` | 4 | Austin is listed on the shared link | `tests/vane-reports.mjs:84` | asserted |
| `DASH-005` | 4 | Marfa is folded into Other cities in Texas | `tests/vane-reports.mjs:84` | asserted |
| `DASH-005` | 4 | Marfa is not named on the shared link | `tests/vane-reports.mjs:85` | asserted |
| `DASH-005` | 4 | the signed-in dashboard lists both cities | `tests/vane-reports.mjs:77` | asserted |
| `DASH-005` | 5 | a current visitor from Texas appears in the live locations list | `tests/vane-reports.mjs:89` | asserted |
| `DASH-005` | 5 | it drops after 5 idle minutes | `tests/vane-reports.mjs:91` | asserted |
| `DASH-005` | 6 | a week where Texas falls names Texas among the movers with its totals | `tests/vane-reports.mjs:75` | asserted |
| `DASH-005` | 7 | the country table shows conversions and conversion rate for the selected goal | `tests/vane-reports.mjs:71` | asserted |
| `DASH-005` | 8 | filtering by country is United States keeps only those visits | `tests/vane-reports.mjs:80` | asserted |
| `DASH-015` | 1 | code 635 shows unnamed | `tests/locations.journey.mjs:44` | asserted |
| `DASH-015` | 1 | its place reads Austin, Texas | `tests/locations.journey.mjs:63` | asserted |
| `DASH-015` | 2 | CSV gives an empty name and the dashboard's figures | `tests/locations.journey.mjs:79` | asserted |
| `DASH-015` | 2 | the ZIP metros file gives an empty name and the dashboard's figures | `tests/locations.journey.mjs:84` | asserted |
| `DASH-015` | 2 | the warehouse export gives an empty name | `tests/locations.journey.mjs:233` | asserted |
| `DASH-015` | 2 | the Stats API gives an empty name and the dashboard's figures | `tests/locations.journey.mjs:69` | asserted |
| `DASH-015` | 2 | MCP gives the Stats API answer | `tests/locations.journey.mjs:76` | asserted |
| `DASH-015` | 3 | the saved filter keys on the code | `tests/locations.journey.mjs:58` | asserted |
| `DASH-015` | 3 | the mover keys on the code | `tests/locations.journey.mjs:59` | asserted |
| `DASH-015` | 3 | the live list keys on the code | `tests/locations.journey.mjs:107` | asserted |
| `DASH-015` | 4 | a US load without a valid code counts as Unknown metro area | `tests/locations.journey.mjs:49` | asserted |
| `DASH-015` | 4 | non-US loads are absent | `tests/locations.journey.mjs:48` | asserted |
| `DASH-015` | 4 | loads without geolocation stay Unknown location | `tests/locations.journey.mjs:50` | asserted |
| `DASH-015` | 5 | on shared and public pages the place shows | `tests/locations.journey.mjs:92` | asserted |
| `DASH-015` | 5 | a 3-visitor metro folds into Other metro areas | `tests/locations.journey.mjs:93` | asserted |
| `DASH-015` | 5 | a metro whose leading city is under 5 visitors names only its region | `tests/locations.journey.mjs:92` | asserted |
| `DASH-015` | 5 | nothing shows without the chosen report | `tests/locations.journey.mjs:96` | asserted |
| `DASH-015` | old 8 of DASH-005 | the journeys use Cloudflare's example code 635 and synthetic codes, places and names (a proof boundary, moved to docs/contract/rules.md) | — | moved |
| `DASH-016` | 1 | an administrator uploads a table and it waits | `tests/locations.journey.mjs:212` | asserted |
| `DASH-016` | 1 | after the owner approves, the name appears on every signed-in surface | `tests/locations.journey.mjs:216` | asserted |
| `DASH-016` | 1 | the name appears in exports | `tests/locations.journey.mjs:221` | asserted |
| `DASH-016` | 1 | the name appears in API answers | `tests/locations.journey.mjs:222` | asserted |
| `DASH-016` | 2 | public pages keep codes unnamed until public names are approved | `tests/locations.journey.mjs:237` | asserted |
| `DASH-016` | 2 | after that approval public pages show the name with the footnote | `tests/locations.journey.mjs:247` | asserted |
| `DASH-016` | 2 | the audit records the approval | `tests/locations.journey.mjs:242` | asserted |
| `DASH-016` | 2 | event rows are unchanged | `tests/locations.journey.mjs:217` | asserted |
| `DASH-016` | 3 | uploads by a Viewer or an Analyst are refused | `tests/locations.journey.mjs:186` | asserted |
| `DASH-016` | 3 | a Stats API key upload is refused | `tests/locations.journey.mjs:191` | asserted |
| `DASH-016` | 3 | a provisioning-key upload is refused | `tests/locations.journey.mjs:192` | asserted |
| `DASH-016` | 3 | a command-API upload is refused | `tests/locations.journey.mjs:194` | asserted |
| `DASH-016` | 3 | an upload from a web address is refused and fetches nothing | `tests/locations.journey.mjs:195` | asserted |
| `DASH-016` | 3 | approval by an administrator is refused | `tests/locations.journey.mjs:213` | asserted |
| `DASH-016` | 4 | codes 63, 6355 and 6a5, a duplicate code, empty, overlong and formula-leading names, a control character, wrong, extra or missing columns, files over 1,000 rows or 256 KB are refused | `tests/locations.journey.mjs:200` | asserted |
| `DASH-016` | 4 | a missing label or statement is refused | `tests/locations.journey.mjs:203` | asserted |
| `DASH-016` | 4 | every refusal changes nothing | `tests/locations.journey.mjs:204` | asserted |
| `DASH-016` | 5 | clearing reverts to unnamed | `tests/locations.journey.mjs:254` | asserted |
| `DASH-016` | 5 | erasure leaves the table | `tests/locations.journey.mjs:251` | asserted |
| `DASH-016` | 5 | the archive and restore keep the names | `tests/locations.journey.mjs:256` | asserted |
| `DASH-016` | 5 | a site transfer keeps the names | `tests/locations.journey.mjs:259` | asserted |
| `DASH-006` | 1 | events from iPhone Safari, Android Chrome, Windows Edge and an iPad | `tests/vane-reports.mjs:41` | asserted |
| `DASH-006` | 2 | the device table matches | `tests/vane-reports.mjs:44` | asserted |
| `DASH-006` | 2 | the browser table matches | `tests/vane-reports.mjs:45` | asserted |
| `DASH-006` | 2 | the OS table matches | `tests/vane-reports.mjs:46` | asserted |
| `DASH-006` | 2 | no raw user agent is stored | `tests/vane-reports.mjs:54` | asserted |
| `DASH-007` | 1 | filter by Organic Search and mobile and not /blog/* from the report | `tests/vane-conversions.mjs:62` | asserted |
| `DASH-007` | 1 | the segment is saved | `tests/vane-conversions.mjs:66` | asserted |
| `DASH-007` | 1 | the segment reopens in the report | `tests/vane-conversions.mjs:68` | asserted |
| `DASH-007` | 1 | the segment reopens in the summary API | `tests/vane-conversions.mjs:70` | asserted |
| `DASH-007` | 2 | each total equals a hand count of the seeded events | `tests/vane-conversions.mjs:70` | asserted |
| `DASH-007` | 2 | each comparison operator keeps whole visits | `tests/vane-conversions.mjs:53` | asserted |
| `DASH-007` | 3 | the saved segment recomputes a funnel's step counts | `tests/vane-conversions.mjs:71` | asserted |
| `DASH-007` | 4 | a member applies the segment | `tests/vane-conversions.mjs:75` | asserted |
| `DASH-007` | 4 | a member cannot save one | `tests/vane-conversions.mjs:76` | asserted |
| `DASH-007` | 5 | an unsupported pattern is refused at save with the reason | `tests/vane-conversions.mjs:301` | asserted |
| `DASH-007` | 5 | the refused pattern saves nothing | `tests/vane-conversions.mjs:302` | asserted |
| `DASH-007` | old 5 | reopening the segment in an alert is a pointer to ALERT-001, moved to the Requirement | — | moved |
| `DASH-008` | 1 | the last 30 days compared with the previous period | `tests/vane-reports.mjs:454` | asserted |
| `DASH-008` | 1 | the last 30 days compared with last year | `tests/vane-reports.mjs:457` | asserted |
| `DASH-008` | 2 | the chart overlays match the seeded data | `tests/vane-reports.mjs:471` | asserted |
| `DASH-008` | 2 | the per-row changes match the seeded data | `tests/vane-reports.mjs:473` | asserted |
| `DASH-009` | 1 | a manual note is added | `tests/vane-report-settings.mjs:293` | asserted |
| `DASH-009` | 1 | a settings change is approved | `tests/vane-report-settings.mjs:296` | asserted |
| `DASH-009` | 1 | a deploy webhook is posted | `tests/vane-report-settings.mjs:302` | asserted |
| `DASH-009` | 1 | an Uptime incident is received | `tests/vane-report-settings.mjs:304` | asserted |
| `DASH-009` | 2 | all four annotations appear on the chart at the right time | `tests/vane-report-settings.mjs:316` | asserted |
| `DASH-009` | 3 | each is listed in the explanation of a report whose range covers it | `tests/vane-report-settings.mjs:317` | asserted |
| `DASH-010` | 1 | three sites in the overview sorted by change | `tests/vane-report-settings.mjs:107` | asserted |
| `DASH-010` | 1 | a roll-up of two of them is created | `tests/vane-report-settings.mjs:112` | asserted |
| `DASH-010` | 2 | one visitor to both sites and two others | `tests/vane-report-settings.mjs:98` | asserted |
| `DASH-010` | 3 | the roll-up shows 4 visitors and 4 visits | `tests/vane-report-settings.mjs:116` | asserted |
| `DASH-010` | 3 | labelled summed per site with the cross-site note | `tests/vane-report-settings.mjs:123` | asserted |
| `DASH-010` | 4 | pageviews and conversions are exact sums | `tests/vane-report-settings.mjs:117` | asserted |
| `DASH-010` | 4 | revenue is an exact sum | `tests/vane-conversions.mjs:166` | asserted |
| `DASH-010` | 5 | bounce rate equals summed bounced visits over summed visits | `tests/vane-report-settings.mjs:116` | asserted |
| `DASH-010` | 6 | the site split gives each site's own figures | `tests/vane-report-settings.mjs:120` | asserted |
| `DASH-010` | 6 | the methodology page states each rule | `tests/vane-report-settings.mjs:126` | asserted |
| `DASH-011` | 1 | visits through home, pricing, signup and home, blog, exit are seeded | `tests/vane-report-settings.mjs:132` | asserted |
| `DASH-011` | 2 | the journey from home shows both paths with the right counts | `tests/vane-report-settings.mjs:137` | asserted |
| `DASH-012` | 1 | ?q=returns searched by two visitors and an email-like term by one | `tests/vane-reports.mjs:104` | asserted |
| `DASH-012` | 2 | the returns term appears | `tests/vane-reports.mjs:110` | asserted |
| `DASH-012` | 2 | the email-like term never appears | `tests/vane-reports.mjs:119` | asserted |
| `DASH-013` | 1 | / and /pricing sent from www and blog hostnames of one site | `tests/vane-reports.mjs:350` | asserted |
| `DASH-013` | 2 | the pages table shows four rows, each with its hostname | `tests/vane-reports.mjs:356` | asserted |
| `DASH-013` | 3 | the Hostname filter narrows the dashboard | `tests/vane-reports.mjs:360` | asserted |
| `DASH-013` | 3 | the Hostname filter narrows the Stats API answer | none | none |
| `DASH-013` | 3 | the Hostname filter narrows a CSV export | none | none |
| `DASH-013` | 4 | is not and contains return the complements | `tests/vane-reports.mjs:361` | asserted |
| `DASH-013` | 4 | a wildcard matches both hostnames | `tests/vane-reports.mjs:363` | asserted |
| `DASH-013` | 4 | a segment saved with the filter gives the same totals in a scheduled report | none | none |
| `DASH-013` | 5 | an event from a hostname that is not allowed is refused | `tests/vane-reports.mjs:353` | asserted |
| `DASH-014` | 1 | visits with the Hacker News, two Slack, Facebook and an unlisted referrer | `tests/vane-reports.mjs:307` | asserted |
| `DASH-014` | 2 | the sources table shows Hacker News, Slack with two visits, Facebook and brewblog.example | `tests/vane-reports.mjs:310` | asserted |
| `DASH-014` | 2 | Slack's drill-down lists both referrers | `tests/vane-reports.mjs:312` | asserted |
| `DASH-014` | 3 | an approved owner rule regroups the row | `tests/vane-reports.mjs:318` | asserted |
| `DASH-014` | 3 | the published source list names every grouping used | none | none |
| `PERF-001` | 1 | a slow-image page shows its LCP p75 above 2.5 s on that page only | `tests/vane-conversions.mjs:36` | asserted |
| `HEAT-001` | 1 | two buttons are clicked repeatedly on a fixture page | `tests/heat.test.mjs:80` | asserted |
| `HEAT-001` | 2 | the heatmap concentrates on them | `tests/heat.test.mjs:88` | asserted |
| `HEAT-001` | 2 | no click request holds text or identifiers | `tests/heat.test.mjs:141` | asserted |
| `HEAT-001` | 2 | no stored row holds text or identifiers | `tests/heat.test.mjs:144` | asserted |
| `HEAT-001` | 2 | the scroll map matches METRIC-006 | `tests/heat.test.mjs:86` | asserted |
| `HEAT-002` | 1 | the owner captures the enabled page natively and sees the click map over the live screenshot | `tests/heat.test.mjs:115` | asserted |
| `HEAT-002` | 1 | the scroll map over the live screenshot | `tests/heat.test.mjs:117` | asserted |
| `HEAT-002` | 1 | at 1440 and 390 CSS pixels | `tests/heat.test.mjs:51` | asserted |
| `CONV-001` | 1 | /thanks/* and /thanks** defined, /thanks/pro and /thanks/pro/annual visited | `tests/vane-reports.mjs:27` | asserted |
| `CONV-001` | 2 | /thanks/* converts on /thanks/pro only | `tests/vane-reports.mjs:32` | asserted |
| `CONV-001` | 2 | /thanks** converts on both | `tests/vane-reports.mjs:32` | asserted |
| `CONV-001` | 2 | the conversion rate equals converting visitors over visitors | `tests/vane-reports.mjs:31` | asserted |
| `CONV-001` | 3 | a 75% scroll goal on /blog/** is defined | `tests/vane-reports.mjs:35` | asserted |
| `CONV-001` | 4 | a visitor scrolling to 80% converts and one scrolling to 50% does not | `tests/vane-reports.mjs:32` | asserted |
| `CONV-002` | 1 | Signup with plan=pro and plan=free fired through JavaScript and CSS classes | `tests/vane-conversions.mjs:108` | asserted |
| `CONV-002` | 2 | the breakdown by plan matches | `tests/vane-conversions.mjs:121` | asserted |
| `CONV-002` | 2 | a property holding an email address is refused | `tests/vane-conversions.mjs:117` | asserted |
| `CONV-002` | 3 | a manual pageview with author=jo breaks down by author | `tests/vane-conversions.mjs:122` | asserted |
| `CONV-002` | 4 | a funnel step on Signup with plan=pro counts only the pro signups | `tests/vane-conversions.mjs:125` | asserted |
| `CONV-002` | 5 | a filter plan is pro keeps only the visits with a pro signup | `tests/vane-conversions.mjs:126` | asserted |
| `CONV-003` | 1 | an outbound link, a PDF link, a 404 page and a form submission on a fixture site | `tests/vane-reports.mjs:190` | asserted |
| `CONV-003` | 2 | four events arrive with the right properties | `tests/vane-reports.mjs:190` | asserted |
| `CONV-003` | 2 | no form contents are kept | `tests/vane-reports.mjs:197` | asserted |
| `CONV-004` | 1 | conversions from Google and from email are seeded | `tests/vane-report-settings.mjs:273` | asserted |
| `CONV-004` | 2 | the channel table shows each channel's conversion rate for the selected goal | `tests/vane-report-settings.mjs:278` | asserted |
| `CONV-004` | 2 | the channel table shows each channel's revenue for the selected goal | `tests/vane-conversions.mjs:157` | asserted |
| `CONV-005` | 1 | the funnel product, cart, checkout, purchase with visits that drop at each step | `tests/vane-conversions.mjs:14` | asserted |
| `CONV-005` | 2 | the step counts and rates match | `tests/vane-conversions.mjs:15` | asserted |
| `CONV-005` | 2 | the segment filter recomputes them | `tests/vane-conversions.mjs:16` | asserted |
| `CONV-006` | 1 | USD and CAD purchases with a Stripe Checkout return referrer (lines 143-144) | `tests/vane-conversions.mjs:137` | asserted |
| `CONV-006` | 2 | revenue totals in USD at the owner-entered CAD rate | `tests/vane-conversions.mjs:151` | asserted |
| `CONV-006` | 2 | the rate is shown | `tests/vane-conversions.mjs:152` | asserted |
| `CONV-006` | 2 | attribution goes to the original source rather than Stripe, after the timeout and within the visit | `tests/vane-conversions.mjs:157` | asserted |
| `CONV-006` | 2 | Stripe never takes credit | `tests/vane-conversions.mjs:154` | asserted |
| `CONV-006` | 2 | a EUR amount with no rate is listed apart | `tests/vane-conversions.mjs:152` | asserted |
| `CONV-006` | 3 | the methodology page defines revenue, the owner-entered rate and the roll-up's exact sum | `tests/vane-conversions.mjs:168` | asserted |
| `CONV-006` | 4 | the channel table shows each channel's revenue and revenue per visitor | `tests/vane-conversions.mjs:157` | asserted |
| `CONV-006` | 4 | the revenue chart and compared period match | `tests/vane-conversions.mjs:161` | asserted |
| `CONV-006` | 4 | its data table matches | `tests/vane-conversions.mjs:163` | asserted |
| `CONV-006` | 4 | a roll-up's exact sum matches | `tests/vane-conversions.mjs:166` | asserted |
| `CONV-006` | 5 | the public stats page shows no revenue by default | `tests/vane-conversions.mjs:171` | asserted |
| `CONV-006` | 5 | once the revenue report is added it shows the amounts as sent, the USD total, the labelled rate and the EUR amount apart | `tests/vane-conversions.mjs:175` | asserted |
| `CONV-006` | 5 | the page and device rows still carry no revenue | `tests/vane-conversions.mjs:176` | asserted |
| `CONV-007` | 1 | one visitor views, adds two tees and a mug, checks out and buys across three page loads; another views and adds a tee | `tests/vane-conversions.mjs:182` | asserted |
| `CONV-007` | 2 | the ecommerce funnel shows 2, 2, 1 and 1 visits | `tests/vane-conversions.mjs:196` | asserted |
| `CONV-007` | 2 | the product report shows each product's views, units and revenue | `tests/vane-conversions.mjs:195` | asserted |
| `CONV-007` | 2 | a euro purchase is kept as 20.00 euros | `tests/vane-conversions.mjs:195` | asserted |
| `CONV-007` | 3 | lines on another event, an email address in a line, a zero quantity, an unknown or missing currency, an undeclared field and more than 50 lines are refused | `tests/vane-conversions.mjs:192` | asserted |
| `CONV-009` | 1 | a click event for #book-demo is defined and its matched element previewed | `tests/vane-conversions.mjs:242` | asserted |
| `CONV-009` | 1 | the definition is approved | `tests/vane-conversions.mjs:251` | asserted |
| `CONV-009` | 2 | clicks on the live fixture arrive as the event with no site code change | `tests/vane-conversions.mjs:260` | asserted |
| `EXPERIMENT-001` | 1 | a fixture test with a seeded 20% lift and a null test run | `tests/vane-conversions.mjs:220` | asserted |
| `EXPERIMENT-001` | 2 | the first reaches significance with the expected interval | `tests/vane-conversions.mjs:222` | asserted |
| `EXPERIMENT-001` | 2 | the null test never does | `tests/vane-conversions.mjs:225` | asserted |
| `EXPERIMENT-001` | 2 | a skewed split triggers the mismatch warning | `tests/vane-conversions.mjs:226` | asserted |
| `EXPERIMENT-001` | 3 | before every variant has the minimum sample the test reports underpowered and calls no result | `tests/vane-conversions.mjs:218` | asserted |
| `EXPERIMENT-001` | 4 | vane('experiment') hands the page its variant and reports the exposure | `tests/vane-conversions.mjs:232` | asserted |
| `EXPERIMENT-001` | 4 | an exposure naming its own variant is refused | `tests/vane-conversions.mjs:234` | asserted |
| `SEARCH-001` | 1 | connect against a Search Console API fixture | `tests/search-console.test.mjs:48` | asserted |
| `SEARCH-001` | 1 | read the queries | `tests/search-console.test.mjs:51` | asserted |
| `SEARCH-001` | 1 | filter the dashboard by a query | `tests/search-console.test.mjs:65` | asserted |
| `SEARCH-001` | 1 | disconnect | `tests/search-console.test.mjs:73` | asserted |
| `SEARCH-001` | 2 | query figures match the fixture | `tests/search-console.test.mjs:51` | asserted |
| `SEARCH-001` | 2 | page figures match the fixture | `tests/search-console.test.mjs:52` | asserted |
| `SEARCH-001` | 2 | the tokens are removed after disconnect | `tests/search-console.test.mjs:73` | asserted |
| `SEARCH-001` | 3 | unpublished last two days show as pending with the next sync time | `tests/search-console.test.mjs:53` | asserted |
| `SEARCH-001` | 4 | the next sync fills both days once with the fixture's figures | `tests/search-console.test.mjs:69` | asserted |
| `SEARCH-001` | 4 | a finalised day is filled once, without duplicates | `tests/search-console.test.mjs:72` | asserted |
| `SEARCH-001` | 4 | each query lists its landing pages with their clicks and Vane visitors | `tests/search-console.test.mjs:65` | asserted |
| `SEARCH-002` | 1 | connect against a Bing API fixture | `tests/bing.test.mjs:60` | asserted |
| `SEARCH-002` | 1 | Bing queries show beside Google's | `tests/bing.test.mjs:91` | asserted |
| `SEARCH-002` | 1 | the Bing figures match the fixture | `tests/bing.test.mjs:62` | asserted |
| `IMPORT-002` | 1 | preview a 13-month import against a Data API fixture | `tests/ga4.test.mjs:106` | asserted |
| `IMPORT-002` | 1 | apply it | `tests/ga4.test.mjs:27` | asserted |
| `IMPORT-002` | 1 | read the journal | `tests/ga4.test.mjs:29` | asserted |
| `IMPORT-002` | 1 | undo it | `tests/ga4.test.mjs:34` | asserted |
| `IMPORT-002` | 2 | imported totals match the fixture per dimension | `tests/ga4.test.mjs:25` | asserted |
| `IMPORT-002` | 2 | the daily totals match the fixture | `tests/ga4.test.mjs:24` | asserted |
| `IMPORT-002` | 2 | the definition-difference notes are shown | none | none |
| `IMPORT-003` | 1 | a fixture in the dashboard-export layout is imported | `tests/plausible-history.test.mjs:41` | asserted |
| `IMPORT-003` | 1 | a Stats API fixture is imported | `tests/plausible-history.test.mjs:88` | asserted |
| `IMPORT-003` | 2 | each dimension's totals match the export | `tests/plausible-history.test.mjs:35` | asserted |
| `IMPORT-003` | 2 | each dimension's totals match the Stats API | `tests/plausible-history.test.mjs:83` | asserted |
| `IMPORT-003` | 2 | the goals are proposed under the same names with the recovered types and patterns | `tests/plausible-history.test.mjs:39` | asserted |
| `IMPORT-003` | 2 | the Stats API goals are proposed with their types | `tests/plausible-history.test.mjs:86` | asserted |
| `IMPORT-003` | 2 | no funnel is read from either source | `tests/plausible-history.test.mjs:87` | asserted |
| `IMPORT-003` | 2 | undo removes the imported history | `tests/plausible-history.test.mjs:94` | asserted |
| `IMPORT-006` | 1 | a 2-million-row event-based analytics export is imported with an interruption mid-way | `tests/import-scale.journey.mjs:121` | asserted |
| `IMPORT-006` | 1 | a lightweight analytics export is imported with an interruption | `tests/import-export.test.mjs:101` | asserted |
| `IMPORT-006` | 1 | a web-event analytics export is imported with an interruption | `tests/import-export.test.mjs:160` | asserted |
| `IMPORT-006` | 2 | the 2-million-row import resumes | `tests/import-scale.journey.mjs:128` | asserted |
| `IMPORT-006` | 2 | the lightweight import resumes | `tests/import-export.test.mjs:115` | asserted |
| `IMPORT-006` | 2 | the web-event import resumes and completes | `tests/import-export.test.mjs:193` | asserted |
| `IMPORT-006` | 2 | totals match | `tests/import-scale.journey.mjs:157` | asserted |
| `IMPORT-006` | 2 | the other imports' totals match | `tests/import-export.test.mjs:119` | asserted |
| `IMPORT-006` | 2 | no identifiers are kept | `tests/import-scale.journey.mjs:133` | asserted |
| `IMPORT-006` | 2 | no identifiers are kept by the other imports | `tests/import-export.test.mjs:121` | asserted |
| `IMPORT-007` | 1 | imported history overlaps two days of live collection | `tests/import-merge.test.mjs:110` | asserted |
| `IMPORT-007` | 2 | charts show the overlap once using live data | `tests/import-merge.test.mjs:102` | asserted |
| `IMPORT-007` | 2 | the imported range is labelled | `tests/import-merge.test.mjs:156` | asserted |
| `IMPORT-007` | 2 | the imported range counts as unknown coverage | `tests/import-merge.test.mjs:101` | asserted |
| `IMPORT-007` | 3 | switching imported data off removes the range from the chart and tables | `tests/import-merge.test.mjs:54` | asserted |
| `IMPORT-007` | 3 | switching it off removes it from a CSV export | `tests/import-merge.test.mjs:59` | asserted |
| `IMPORT-007` | 3 | switching it off removes it from the Stats API answer | `tests/import-merge.test.mjs:68` | asserted |
| `IMPORT-007` | 3 | switching it back on restores them | `tests/import-merge.test.mjs:56` | asserted |
| `IMPORT-007` | 4 | history imported through 4 June 2024, then an export starting 3 June previewed | `tests/import-merge.test.mjs:20` | asserted |
| `IMPORT-007` | 5 | the preview lists 3-4 June as held by the earlier source and skipped | `tests/import-merge.test.mjs:21` | asserted |
| `IMPORT-007` | 5 | the applied import's journal lists them | `tests/import-merge.test.mjs:22` | asserted |
| `IMPORT-007` | 5 | those days' totals equal the earlier source's alone | `tests/import-merge.test.mjs:24` | asserted |
| `IMPORT-010` | 1 | against a Stats API fixture for 14 overlap days the report shows both columns per day | `tests/import-parallel.test.mjs:73` | asserted |
| `IMPORT-010` | 1 | the report covers 14 days | `tests/import-parallel.test.mjs:70` | asserted |
| `IMPORT-010` | 1 | it explains a seeded bot-filter difference | `tests/import-parallel.test.mjs:80` | asserted |
| `IMPORT-008` | 1 | a fixture page instrumented only with plausible() calls carrying props and USD revenue | none | none |
| `IMPORT-008` | 1 | the plausible-event-name= and plausible-event-name-- class forms | none | none |
| `IMPORT-008` | 2 | the same events and properties arrive with no page edit | `tests/incumbent-options.test.mjs:34` | asserted |
| `IMPORT-008` | 2 | the USD revenue from the plausible() call arrives | none | none |
| `IMPORT-008` | 3 | plausible.init customProperties gives the pageview author=jo | `tests/incumbent-options.test.mjs:27` | asserted |
| `IMPORT-008` | 3 | a click on a .dwg link arrives as a file download | `tests/incumbent-options.test.mjs:30` | asserted |
| `IMPORT-008` | 4 | fathom.trackEvent Purchase with _value 4999 arrives as $49.99 revenue | `tests/incumbent-options.test.mjs:30` | asserted |
| `IMPORT-008` | 5 | after the export fixture is imported the goals are proposed under the same names | `tests/plausible-definitions.test.mjs:25` | asserted |
| `IMPORT-008` | 5 | approving them makes the live events count as conversions in the goal reports | `tests/plausible-definitions.test.mjs:36` | asserted |
| `IMPORT-011` | 1 | a page that still loads the incumbent script appears in the call-site scan | `tests/sitemap-scan.test.mjs:37` | asserted |
| `IMPORT-011` | 1 | the scan drafts its native rewrite | `tests/sitemap-scan.test.mjs:38` | asserted |
| `IMPORT-009` | 1 | a fixture in the real dashboard-export layout with no funnel file is imported | `tests/plausible-definitions.test.mjs:24` | asserted |
| `IMPORT-009` | 2 | its conversions.csv and custom_props.csv rows are recovered | `tests/plausible-definitions.test.mjs:25` | asserted |
| `IMPORT-009` | 3 | matching live Signup and Purchase calls establish their event names | `tests/plausible-definitions.test.mjs:21` | asserted |
| `IMPORT-009` | 3 | the live Purchase with USD revenue establishes revenue type and currency | `tests/plausible-definitions.test.mjs:26` | asserted |
| `IMPORT-009` | 4 | four goals are proposed with the right type, pattern, threshold and currency | `tests/plausible-definitions.test.mjs:25` | asserted |
| `IMPORT-009` | 4 | USD is shown for confirmation | `tests/plausible-definitions.test.mjs:26` | asserted |
| `IMPORT-009` | 5 | Leads (old) appears under Needs completion | `tests/plausible-definitions.test.mjs:37` | asserted |
| `IMPORT-009` | 5 | Leads (old) is not proposed | `tests/plausible-definitions.test.mjs:25` | asserted |
| `IMPORT-009` | 6 | plan is proposed as a property | `tests/plausible-definitions.test.mjs:25` | asserted |
| `IMPORT-009` | 7 | with a Stats API key the goals are read directly and Purchase carries EUR | `tests/plausible-definitions.test.mjs:47` | asserted |
| `IMPORT-009` | 7 | no field is inferred from a name except the scroll threshold | `tests/plausible-definitions.test.mjs:48` | asserted |
| `IMPORT-009` | 8 | with an Enterprise Sites API key the result is identical | `tests/plausible-definitions.test.mjs:47` | asserted |
| `IMPORT-012` | 1 | the funnel Visit /pricing, Signup, Purchase is rebuilt by pasting the three step names | `tests/plausible-definitions.test.mjs:30` | asserted |
| `IMPORT-012` | 1 | it is approved | `tests/plausible-definitions.test.mjs:31` | asserted |
| `IMPORT-012` | 2 | replayed live shimmed events are counted at each step | `tests/plausible-definitions.test.mjs:33` | asserted |
| `IMPORT-012` | 3 | the import screen states that no funnel definitions are exposed | `tests/plausible-definitions.test.mjs:37` | asserted |
| `IMPORT-012` | 3 | no funnel is proposed from the export read (the exact definition list holds goals only) | `tests/plausible-definitions.test.mjs:25` | asserted |
| `IMPORT-012` | 3 | no funnel is proposed from a Stats or Enterprise API read | `tests/plausible-definitions.test.mjs:47` | asserted |
| `REPORT-001` | 1 | two recipients subscribe to the weekly report at 8:00 America/New_York | `tests/vane-alerts.mjs:12` | asserted |
| `REPORT-001` | 1 | the schedule runs across a daylight-saving change | `tests/vane-alerts.mjs:21` | asserted |
| `REPORT-001` | 2 | each email arrives once at the local hour | `tests/vane-alerts.mjs:16` | asserted |
| `REPORT-001` | 2 | its figures match the dashboard | `tests/vane-alerts.mjs:18` | asserted |
| `REPORT-001` | 2 | unsubscribe stops it | `tests/vane-alerts.mjs:23` | asserted |
| `REPORT-001` | 3 | a delivery failed temporarily twice is retried at 15 minutes and 2 hours | `tests/vane-alerts.mjs:26` | asserted |
| `REPORT-001` | 3 | it is delivered once, under one delivery ID | `tests/vane-alerts.mjs:27` | asserted |
| `REPORT-001` | 4 | a delivery failing all four attempts shows as failed after the 12-hour retry | `tests/vane-alerts.mjs:29` | asserted |
| `REPORT-001` | 4 | the send list shows it failed with its attempts | `tests/vane-alerts.mjs:31` | asserted |
| `REPORT-001` | 5 | a permanent bounce is not retried | `tests/vane-alerts.mjs:28` | asserted |
| `REPORT-001` | 5 | it shows in the app at once | `tests/vane-alerts.mjs:32` | asserted |
| `REPORT-001` | 6 | a Monday 8:00 weekly report arrives on Monday at 8:00 local time and on no other day | `tests/vane-alerts.mjs:19` | asserted |
| `REPORT-004` | 1 | a signed provider event reports a permanent bounce on a delivered report hours later and it shows on that send | `tests/vane-alerts.mjs:52` | asserted |
| `REPORT-004` | 1 | a spam complaint on another send shows on it | none | none |
| `REPORT-004` | 2 | a wrong signature is refused | `tests/vane-alerts.mjs:42` | asserted |
| `REPORT-004` | 2 | an event naming another address is refused | `tests/vane-alerts.mjs:43` | asserted |
| `REPORT-004` | 2 | an identical retry changes nothing | none | none |
| `REPORT-004` | 3 | the next scheduled sends to both addresses fail unsent with that reason | `tests/vane-alerts.mjs:58` | asserted |
| `REPORT-004` | 3 | the second stopped address fails unsent too | `tests/vane-alerts.mjs:59` | asserted |
| `REPORT-004` | 3 | other recipients keep their reports | `tests/vane-alerts.mjs:60` | asserted |
| `REPORT-003` | 1 | a week where organic search falls 40% on one page is seeded | `tests/vane-report-settings.mjs:255` | asserted |
| `REPORT-003` | 2 | the explanation names that page and channel with its denominators | `tests/vane-report-settings.mjs:258` | asserted |
| `REPORT-003` | 2 | it lists the overlapping annotation | `tests/vane-report-settings.mjs:259` | asserted |
| `REPORT-003` | 2 | a fluctuation inside the 95% interval is normal variation and one outside is not | `tests/vane-report-settings.mjs:262` | asserted |
| `ALERT-001` | 1 | eight weeks of baseline with a 4x spike, a 70% drop and a Thanksgiving dip | `tests/vane-alerts.mjs:121` | asserted |
| `ALERT-001` | 2 | the spike alerts once | `tests/vane-alerts.mjs:121` | asserted |
| `ALERT-001` | 2 | the drop alerts once | `tests/vane-alerts.mjs:131` | asserted |
| `ALERT-001` | 2 | the holiday dip does not alert | `tests/vane-alerts.mjs:141` | asserted |
| `ALERT-001` | 2 | the cool-down suppresses a repeat | `tests/vane-alerts.mjs:126` | asserted |
| `ALERT-001` | 3 | a current-visitors threshold of 50 with a fake clock is crossed | `tests/vane-alerts.mjs:75` | asserted |
| `ALERT-001` | 4 | the alert is sent within 15 minutes of the crossing | `tests/vane-alerts.mjs:79` | asserted |
| `ALERT-001` | 4 | the recorded crossing and send times show it | `tests/vane-alerts.mjs:78` | asserted |
| `ALERT-001` | 5 | a recurring Saturday 2:00-3:00 maintenance window with a drop inside it | `tests/vane-alerts.mjs:117` | asserted |
| `ALERT-001` | 6 | no alert is sent inside the window | `tests/vane-alerts.mjs:128` | asserted |
| `ALERT-001` | 6 | the alert log shows the drop as held with the reason scheduled maintenance | `tests/vane-alerts.mjs:143` | asserted |
| `ALERT-001` | 6 | the same drop at 4:00 alerts | `tests/vane-alerts.mjs:129` | asserted |
| `ALERT-001` | 7 | each alert's message lists its largest movers with their totals | `tests/vane-alerts.mjs:124` | asserted |
| `ALERT-001` | 8 | an alert on a saved segment counts only that segment's visits | `tests/vane-alerts.mjs:101` | asserted |
| `ALERT-002` | 1 | a fixture site whose script is removed raises its alert | `tests/tracking-health.test.mjs:86` | asserted |
| `ALERT-002` | 1 | a goal whose event name broke raises its alert | `tests/tracking-health.test.mjs:82` | asserted |
| `ALERT-002` | 1 | blocked browser purchase events while Stripe confirms orders raise the divergence alert | none | none |
| `ALERT-002` | 2 | each condition raises its own named alert | `tests/tracking-health.test.mjs:81` | asserted |
| `ALERT-002` | 3 | a page-silent alert names /pricing while other pages keep sending | `tests/tracking-health.test.mjs:84` | asserted |
| `ALERT-002` | 4 | with twelve goals firing the overview reads all 12 goals tracking with the time of the check | `tests/tracking-health.test.mjs:33` | asserted |
| `ALERT-002` | 4 | after one breaks the next check reads 11 of 12 and names the silent goal | `tests/tracking-health.test.mjs:107` | asserted |
| `ALERT-002` | 5 | each alert's message lists its largest movers with their totals | `tests/tracking-health.test.mjs:89` | asserted |
| `FOLLOW-001` | 1 | a drop alert is fired and left unacknowledged past the reminder time | `tests/vane-alerts.mjs:186` | asserted |
| `FOLLOW-001` | 1 | past the escalation time (escalation moved to Oncall as a ct NEW clause) | — | moved |
| `FOLLOW-001` | 2 | one reminder arrives | `tests/vane-alerts.mjs:186` | asserted |
| `FOLLOW-001` | 2 | one escalation arrives (moved to Oncall) | — | moved |
| `FOLLOW-001` | 3 | the item is acknowledged and resolved as a tracking fault | `tests/vane-alerts.mjs:192` | asserted |
| `FOLLOW-001` | 4 | reminders stop | `tests/vane-alerts.mjs:194` | asserted |
| `FOLLOW-001` | 4 | the item records who resolved it, when and with what outcome | `tests/vane-alerts.mjs:196` | asserted |
| `SHARE-001` | 1 | a password-protected link that hides revenue is created | `tests/vane-reports.mjs:151` | asserted |
| `SHARE-001` | 1 | it opens signed out | `tests/vane-reports.mjs:155` | asserted |
| `SHARE-001` | 1 | it is embedded | `tests/vane-reports.mjs:169` | asserted |
| `SHARE-001` | 2 | the figures match the dashboard | `tests/vane-reports.mjs:169` | asserted |
| `SHARE-001` | 2 | no revenue is shown | `tests/vane-reports.mjs:157` | asserted |
| `SHARE-001` | 2 | the wrong password is refused | `tests/vane-reports.mjs:153` | asserted |
| `SHARE-001` | 2 | a revoked link returns 404 | `tests/vane-reports.mjs:176` | asserted |
| `SHARE-002` | 1 | a site is made public with two reports and opened signed out | `tests/vane-reports.mjs:130` | asserted |
| `SHARE-002` | 2 | only those reports appear | `tests/vane-reports.mjs:132` | asserted |
| `SHARE-002` | 2 | turning it off returns 404 | `tests/vane-reports.mjs:138` | asserted |
| `SHARE-002` | 3 | revenue appears only once the owner adds the revenue report | `tests/vane-conversions.mjs:175` | asserted |
| `SHARE-002` | 3 | revenue is absent before | `tests/vane-conversions.mjs:171` | asserted |
| `TEAM-001` | 1 | an analyst is invited to one site and a viewer to two | `tests/vane-team-and-exports.mjs:25` | asserted |
| `TEAM-001` | 2 | every in-role action through its public route succeeds for each role | `tests/vane-team-and-exports.mjs:28` | asserted |
| `TEAM-001` | 2 | every out-of-scope call is refused | `tests/vane-team-and-exports.mjs:29` | asserted |
| `TEAM-001` | 2 | every out-of-role call is refused | `tests/vane-team-and-exports.mjs:50` | asserted |
| `TEAM-001` | 2 | the analyst saves a segment | `tests/vane-team-and-exports.mjs:56` | asserted |
| `TEAM-001` | 2 | the analyst prepares a no-code event | `tests/vane-team-and-exports.mjs:58` | asserted |
| `TEAM-001` | 2 | "with no write" restated BASE-ROLE-001 and left the point (base); the no-write check is still at line 54 | — | moved |
| `TEAM-001` | 2 | a transfer of ownership is refused without the current owner's confirmation | `tests/vane-team-and-exports.mjs:71` | asserted |
| `TEAM-001` | 2 | a confirmed transfer works | `tests/vane-team-and-exports.mjs:81` | asserted |
| `AGENCY-001` | 1 | two clients are created, each with a site and a client user | `tests/agency.test.mjs:44` | asserted |
| `AGENCY-001` | 2 | each client user sees only their own site | `tests/agency.test.mjs:45` | asserted |
| `AGENCY-001` | 2 | the branded weekly email shows the agency logo | `tests/agency.test.mjs:63` | asserted |
| `AGENCY-001` | 2 | the agency overview lists both | `tests/agency.test.mjs:85` | asserted |
| `API-001` | 1 | a scoped key queries visitors by channel with a filter, a saved segment and a comparison | `tests/vane-team-and-exports.mjs:103` | asserted |
| `API-001` | 1 | the figures equal the dashboard's | `tests/vane-team-and-exports.mjs:101` | asserted |
| `API-001` | 1 | the compared figures equal the dashboard's | `tests/vane-team-and-exports.mjs:102` | asserted |
| `API-001` | 2 | a key for another site is refused | `tests/vane-team-and-exports.mjs:113` | asserted |
| `API-001` | 2 | a revoked key is refused | `tests/vane-team-and-exports.mjs:121` | asserted |
| `API-001` | 2 | a burst over the rate limit is refused | `tests/vane-team-and-exports.mjs:119` | asserted |
| `API-001` | 3 | a v2 query fixture returns the same figures from the compatible route | `tests/vane-team-and-exports.mjs:109` | asserted |
| `API-001` | 3 | a provisioning key creates a site and a goal | `tests/vane-team-and-exports.mjs:127` | asserted |
| `API-001` | 3 | they then appear in the app | `tests/vane-team-and-exports.mjs:131` | asserted |
| `API-002` | 1 | a breakdown downloads as CSV | `tests/vane-team-and-exports.mjs:146` | asserted |
| `API-002` | 1 | a site ZIP downloads | `tests/vane-team-and-exports.mjs:173` | asserted |
| `API-002` | 1 | the Looker Studio connector runs against the API | `tests/vane-team-and-exports.mjs:194` | asserted |
| `API-002` | 1 | a scheduled export runs to an R2 fixture | `tests/vane-team-and-exports.mjs:222` | asserted |
| `API-002` | 2 | the CSV matches the dashboard | `tests/vane-team-and-exports.mjs:150` | asserted |
| `API-002` | 2 | the ZIP matches the dashboard | `tests/vane-team-and-exports.mjs:178` | asserted |
| `API-002` | 2 | the connector matches the dashboard | `tests/vane-team-and-exports.mjs:194` | asserted |
| `API-002` | 2 | the warehouse export matches the dashboard | `tests/vane-team-and-exports.mjs:224` | asserted |
| `API-002` | 2 | the export matches the declared schema | `tests/vane-team-and-exports.mjs:223` | asserted |
| `API-003` | 1 | a webhook endpoint is subscribed | `tests/vane-mobile-and-api.mjs:252` | asserted |
| `API-003` | 1 | an alert is fired to it | `tests/vane-alerts.mjs:93` | asserted |
| `API-003` | 1 | a goal burst is fired and the first delivery fails | `tests/vane-mobile-and-api.mjs:260` | asserted |
| `API-003` | 2 | signed payloads arrive once each after the retry | `tests/vane-mobile-and-api.mjs:263` | asserted |
| `API-003` | 2 | each delivery succeeds once | `tests/vane-mobile-and-api.mjs:266` | asserted |
| `API-003` | 2 | the alert payload is signed | `tests/vane-alerts.mjs:94` | asserted |
| `API-003` | 2 | the delivery log shows the failure and the success | `tests/vane-mobile-and-api.mjs:267` | asserted |
| `API-004` | 1 | an MCP client with a scoped key asks for last week's top sources | `tests/vane-mobile-and-api.mjs:130` | asserted |
| `API-004` | 1 | the result equals the Stats API answer | `tests/vane-mobile-and-api.mjs:130` | asserted |
| `API-004` | 1 | a write tool is refused without a grant | `tests/vane-mobile-and-api.mjs:134` | asserted |
| `PRIVACY-001` | 1 | consented mode is toggled | none | none |
| `PRIVACY-001` | 1 | automatic events are toggled | `tests/vane-reports.mjs:330` | asserted |
| `PRIVACY-001` | 1 | a Search Console connection is toggled | none | none |
| `PRIVACY-001` | 2 | the inventory and the generated text change to match | `tests/vane-reports.mjs:331` | asserted |
| `PRIVACY-001` | 2 | the stored data matches the inventory | `tests/vane-reports.mjs:344` | asserted |
| `RETENTION-002` | 1 | a keep-forever site imports 30 months, collects today's events and applies retention | `tests/vane-report-settings.mjs:63` | asserted |
| `RETENTION-002` | 2 | every imported and live event remains | `tests/vane-report-settings.mjs:65` | asserted |
| `RETENTION-002` | 2 | a raw-event query for the oldest imported day returns its events | `tests/vane-report-settings.mjs:66` | asserted |
| `RETENTION-002` | 3 | at 25 months only events older than 25 months are erased | `tests/vane-report-settings.mjs:74` | asserted |
| `RETENTION-002` | 3 | one deletion is journaled | `tests/vane-report-settings.mjs:74` | asserted |
| `RETENTION-002` | 4 | at 80% of the published capacity the warning names both choices | `tests/vane-report-settings.mjs:81` | asserted |
| `RETENTION-002` | 4 | no event is dropped | `tests/vane-report-settings.mjs:83` | asserted |
| `PRIVACY-002` | 1 | a fixture page loads with GPC set and with DNT set | `tests/vane-access.mjs:211` | asserted |
| `PRIVACY-002` | 2 | nothing is collected | `tests/vane-access.mjs:213` | asserted |
| `PRIVACY-002` | 2 | the signal share is counted in a field-free counter when the owner enables it | `tests/vane-access.mjs:220` | asserted |
| `PRIVACY-002` | 2 | the stance shows on the methodology page | `tests/vane-access.mjs:227` | asserted |
| `PRIVACY-003` | 1 | each adapter denies then grants consent from California, Germany and Texas | `tests/vane-mobile-and-api.mjs:230` | asserted |
| `PRIVACY-003` | 2 | collection follows each region's rule | `tests/vane-mobile-and-api.mjs:231` | asserted |
| `PRIVACY-005` | 1 | in a browser only the installation's origin receives a request from vane.js | `tests/vane-access.mjs:140` | asserted |
| `PRIVACY-005` | 2 | events are collected, every report read, an import applied and the archive downloaded with outbound requests recorded | `tests/vane-access.mjs:145` | asserted |
| `PRIVACY-005` | 3 | each succeeds | `tests/vane-access.mjs:143` | asserted |
| `PRIVACY-005` | 3 | the record holds no outbound request | `tests/vane-access.mjs:146` | asserted |
| `PRIVACY-005` | 4 | seed.json lists Cloudflare as the only required external | `tests/vane-access.mjs:135` | asserted |
| `PRIVACY-005` | 4 | the present-tense list of today's optional integrations moved to docs/contract/data-flows.md | — | moved |
| `AUDIT-001` | 1 | each audited action is performed, including an agent.prepare proposal and a sign-in opening a session | `tests/vane-access.mjs:262` | asserted |
| `AUDIT-001` | 1 | the audit view is read | `tests/vane-access.mjs:272` | asserted |
| `AUDIT-001` | 1 | the export is read | `tests/vane-access.mjs:270` | asserted |
| `AUDIT-001` | 2 | each entry has its actor, time and subject | `tests/vane-access.mjs:267` | asserted |
| `AUDIT-001` | 2 | erasing a site's history leaves the audit entries without the erased data | `tests/vane-access.mjs:271` | asserted |
| `AUDIT-001` | old 3 | the shared-link and API-key audit obligations are pointers to SHARE-001 and API-001, moved to the Requirement | — | moved |
| `SITE-001` | 1 | a site with www and apex hostnames is added | `tests/vane-reports.mjs:203` | asserted |
| `SITE-001` | 1 | its time zone and currency change through approval | `tests/vane-reports.mjs:214` | asserted |
| `SITE-001` | 1 | it is deleted | `tests/vane-reports.mjs:232` | asserted |
| `SITE-001` | 2 | events from both hostnames count | `tests/vane-reports.mjs:206` | asserted |
| `SITE-001` | 2 | deletion leaves no history | `tests/vane-reports.mjs:235` | asserted |
| `HOST-001` | 1 | deploy to a Cloudflare test account and run a 1,000,000-pageview native load | `tests/host-cloudflare-cost.journey.mjs:106` | asserted |
| `HOST-001` | 1 | read the cost panel | `tests/host-cloudflare-cost.journey.mjs:103` | asserted |
| `HOST-001` | old 1 | the `COLLECT-004` load run on a deployed account (a proof boundary) moved to register row R-1 | — | moved |
| `HOST-001` | 2 | the stated cost per 100,000 pageviews matches measured account usage within 10% | `tests/host-cloudflare-cost.journey.mjs:124` | asserted |
| `HOST-001` | 2 | the deployed resources are exactly the Worker and the bindings deploy.json declares | none | none |
| `HOST-001` | 3 | the cost panel names Workers Paid for the load-test volume | `tests/host-cloudflare-cost.journey.mjs:107` | asserted |
| `HOST-001` | 4 | on a Workers Free fixture, traffic at 80% of the daily limit raises the plan warning | `tests/vane-report-settings.mjs:347` | asserted |
| `HOST-002` | 1 | from an empty folder the command runs until it reports the app ready and prints its sign-in link | `tests/host-local-processes.mjs:98` | asserted |
| `HOST-002` | 1 | the folder starts empty | `tests/host-local.journey.mjs:37` | asserted |
| `HOST-002` | 2 | the owner adds a site, loads a fixture page and sees the pageview in the report | `tests/host-local-ui.mjs:56` | asserted |
| `HOST-002` | 3 | the journey repeats with network access cut off and passes | `tests/host-local.journey.mjs:67` | asserted |
| `HOST-002` | 3 | only loopback exists in the cut-off runtime | `tests/host-local.journey.mjs:83` | asserted |
| `HOST-003` | 1 | the local installation's report shows a fixture pageview | `tests/host-local-ui.mjs:56` | asserted |
| `HOST-003` | 2 | the installation is exported and imported into a fresh Cloudflare test deployment | `tests/host-cloudflare.journey.mjs:86` | asserted |
| `HOST-003` | 2 | the same pageview is in the report there | `tests/host-cloudflare.journey.mjs:91` | asserted |
| `OPEN-001` | 1 | LICENSE holds the MIT license text | none | none |
| `OPEN-001` | 1 | package.json declares MIT | none | none |
| `OPEN-001` | 2 | "no license-key check" restated BASE-DATA-005 and left the point (base) | — | moved |
| `OPEN-001` | 2 | a scan of src/ finds no payment-provider call, plan gate or usage meter | none | none |
| `OPEN-001` | 2 | the product tests pass on a fresh clone with no key or account other than the owner's own | `tests/host-local.journey.mjs:67` | asserted |
| `DEMO-001` | 1 | rer demo starts | `tests/demo.journey.mjs:14` | asserted |
| `DEMO-001` | 1 | each example site opens | `tests/demo.journey.mjs:23` | asserted |
| `DEMO-001` | 1 | the pending change is approved | `tests/demo.journey.mjs:34` | asserted |
| `DEMO-001` | 2 | stopping the demo removes its data | `tests/demo.journey.mjs:36` | asserted |
| `MOBILE-001` | 1 | at 390 and 1440 px the site, report, filter, approval and alert journeys complete by keyboard | `tests/vane-mobile-and-api.mjs:39` | asserted |
| `MOBILE-001` | 1 | the filter journey completes | `tests/vane-mobile-and-api.mjs:34` | asserted |
| `MOBILE-001` | 1 | the site journey completes | `tests/vane-mobile-and-api.mjs:25` | asserted |
| `MOBILE-001` | 1 | the automated accessibility scan is clean | `tests/vane-mobile-and-api.mjs:16` | asserted |
| `MOBILE-001` | 2 | the PWA installs | `tests/vane-mobile-and-api.mjs:57` | asserted |
| `MOBILE-001` | 2 | a push alert is received | `tests/vane-mobile-and-api.mjs:99` | asserted |
| `AGENT-006` | 1 | the brief names each seeded opportunity with correct figures and a linked draft | `tests/agent-work.test.mjs:28` | asserted |
| `AGENT-006` | 2 | a dismissed type does not return the next week | `tests/agent-work.test.mjs:31` | asserted |
| `AGENT-007` | 1 | ten fixture questions are asked, including an ambiguous and an unanswerable one | `tests/ask.test.mjs:48` | asserted |
| `AGENT-007` | 2 | every numeric answer equals the Stats API result for the shown query | `tests/ask.test.mjs:33` | asserted |
| `AGENT-007` | 2 | the ambiguous question gets a choice | `tests/ask.test.mjs:42` | asserted |
| `AGENT-007` | 2 | the unanswerable one says why | `tests/ask.test.mjs:46` | asserted |
| `AGENT-008` | 1 | the ten fixture questions are asked from a Slack fixture | none | none |
| `AGENT-008` | 1 | the ten fixture questions are asked from a Teams fixture | none | none |
| `AGENT-008` | 2 | the Slack and Teams answers match the Stats API, offer a choice for the ambiguous question and say why for the unanswerable one | none | none |

Rows: 620; 581 asserted, 27 none, 12 moved. Clauses audited: 99.

Notes.

- Point numbers are the new contract's. "old N" marks an outcome that left a point: a Base restatement mapped `base`, a pointer to another clause, a proof boundary moved to the register or docs, or the escalation step moved to Oncall.
- `tests/vane.test.mjs`, which most Evidence cells name, is the entry that imports `tests/vane-access.mjs`, `tests/vane-metrics.mjs`, `tests/vane-reports.mjs`, `tests/vane-report-settings.mjs`, `tests/vane-conversions.mjs`, `tests/vane-team-and-exports.mjs`, `tests/vane-mobile-and-api.mjs` and `tests/vane-alerts.mjs`; a line cited in one of those modules runs under that Evidence file. Lines cited in `tests/host-local-processes.mjs` and `tests/host-local-ui.mjs` are in helpers that the cited journeys call.
- Each `none` row demotes its clause to partial in the same commit, with a Gap naming the unasserted outcome: `DEPLOY-001`, `INSTALL-001`, `COVERAGE-001`, `METRIC-001`, `DASH-013`, `DASH-014`, `IMPORT-002`, `IMPORT-008`, `REPORT-004`, `ALERT-002`, `PRIVACY-001`, `HOST-001`, `OPEN-001`. The exception is `AGENT-008`, the part of done `AGENT-007` that the old Gap named as future: it is missing, and its Gap says no Slack or Teams question door exists.
