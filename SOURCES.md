# Source custody

Started from the committed Base foundation at
`fc0e1041efa55771142bbb57c4ab4743147e264d`, converted to package mode with RER
0.2.17. `composition.lock.json` records foundation copies; domain additions are
edition-owned. The package pin is now RER 0.2.30, and every Base copy recorded
in `base-copies.json` (modules, `src/base`, edition-authoring scripts and
`run-demo.yml`) is refreshed from rer-v0.2.30
(`d434ea67989fe10b6ddff01daba8bb350975e54a`).

Adapted MIT sibling source:

- Spool `src/domain/origins.ts` at
  `9f75f060a66446f4c9dcf9cafddd0906d7698748`: canonical origins in
  `src/vane/privacy.ts`. Its admission and retention informed atomic fences.
  Free-text scrubbing is replaced with explicit approved analytics labels.
- Uptime `src/domain/schedule.ts` at
  `c699a67fa0358f79b736c27b7657a9189afaa9f4`: grid helpers in
  `src/vane/reports.ts` align comparison windows.
- Mango `src/core/features/insights/service.ts` at
  `7f27217b8ce03aeac9cf4eb3fa0c8eb7ebc28d3f`: evidence/time-window service
  structure in `src/vane/reports.ts`. Its contact/IP consent schema is replaced
  with event consent provenance without person identity.

Read package-mode examples run-coaster `3cdb77f`, run-beam `9029728` and run-pier
`dcd4c59`. No sibling repository was changed.

The exact published RER 0.2.17 package supplies bounded, nonblocking macOS listener ownership inspection. No local RER patches are applied.

## DASH-005 metro names (20 October 2026)

Vane ships no US metro-area (Nielsen DMA®) code-to-name table, and fetches none
at build or run time: no published source licenses DMA code-to-name pairs for
this MIT-licensed, redistributable repository (ct ruling, 20 October 2026
22:31Z). `metro_code` keeps the US DMA code Cloudflare provides; events never
store a name. Names come only from each site's own metro-name table, which a
site's owner or administrator uploads and the owner approves; it is site data
in the installation's database and is never committed, shipped or fetched.
Unnamed codes show as “Metro NNN (unnamed)” with the place most of their
visitors were in. Tests, fixtures, seeds and demo data use Cloudflare's own
example code (635, Austin, Texas) and synthetic codes and names such as 999 and
“Fixture Metro A”, never real DMA names.

Cloudflare documents the code field (a nullable 3-digit code, no name) at
https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties.
The legacy PEAR Net_GeoIP 1.0.0 mapping (12 May 2011,
https://pear.php.net/package/Net_GeoIP) is LGPL-2.1-or-later and a third-party
copy, so it has not been incorporated into this MIT seed.

Sources checked, all accessed 2026-10-20 UTC; each is refused in any form
(copied, scraped, derived, partial or test-only), as are community lists, any
Nielsen or reseller data without a written licence, and Census CBSAs as a
substitute geography:

- Cloudflare `request.cf.metroCode`, `ip.src.metro_code`, `cf-metro-code`: a
  code only (https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/ip.src.metro_code/).
- Google Ads geotargets CSV 2026-10-06: no DMA rows; “For DMA data, contact
  The Nielsen Company directly”
  (https://developers.google.com/google-ads/api/data/geotargets). Google Ads
  API and Campaign Manager 360 `metros.list` give names only to signed-in API
  users under terms that forbid building databases or redistributing
  (https://developers.google.com/terms,
  https://developers.google.com/doubleclick-advertisers/rest/v4/metros/list).
  Google Ad Manager and Studio help pages send readers to Nielsen
  (https://developers.google.com/ad-manager/api/geotargets,
  https://support.google.com/richmedia/answer/3388373). The GA4 Data API has
  no DMA dimension
  (https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema).
- Meta Marketing API: now Comscore Markets; Platform Terms forbid licensing
  Platform Data (https://developers.facebook.com/terms/).
- Xandr and Microsoft Advertising: client API only; Microsoft uses its own
  market areas
  (https://learn.microsoft.com/en-us/xandr/digital-platform-api/designated-market-area-service,
  https://learn.microsoft.com/en-us/advertising/guides/geographical-location-codes).
- Adobe Analytics names DMAs through a Nielsen partnership
  (https://experienceleague.adobe.com/en/docs/analytics/components/dimensions/us-dma).
- Nielsen: no public list; DMA boundaries and data are Nielsen's alone
  (https://www.nielsen.com/dma-regions/, https://www.nielsen.com/legal/terms-of-use/).
- Precisely, a Nielsen licensee: internal use only
  (https://www.precisely.com/legal/licensing/additional-terms-for-designated-market-area-regions-dmar-09-2025/).
- MaxMind: `metro_code` deprecated, no names, GeoLite EULA bars disclosure
  (https://dev.maxmind.com/geoip/docs/databases/city-and-country/,
  https://www.maxmind.com/en/geolite2/eula).
- IP2Location free ZIP Code to Metro: redistribution prohibited
  (https://www.ip2location.com/free/zipcode-metro, https://www.ip2location.com/terms).
- GeoNames, Natural Earth, OpenStreetMap, Wikidata and Wikipedia: no DMA
  code-to-name data (https://www.geonames.org/export/codes.html,
  https://www.naturalearthdata.com/about/terms-of-use/,
  https://en.wikipedia.org/wiki/Media_market).
- Census and OMB delineation files: CBSAs, a different geography
  (https://www.census.gov/geographies/reference-files/time-series/demo/metro-micro/delineation-files.html).
- FCC 47 CFR 76.55(e): refers to Nielsen's own publication
  (https://www.law.cornell.edu/cfr/text/47/76.55).

A bundled table (Outcome A) needs a written licence from Nielsen, or a licensor
it authorizes, that expressly covers redistribution in this public MIT
repository and every installation, reports, exports and APIs, and public pages
(or states what is excluded). Only the owner can obtain one, and its entry is
written here before any file lands: the dataset and edition; the rights holder;
the licensor and licence document (title, date, reference, URL); the exact
grants and any exclusions; the notice text and where it shows; term, expiry and
renewal; retrieval date and method, path, SHA-256, row count and code range;
the owner's approval; and the next review date. The file would be the
data-only `src/vane/us-metro-names.ts` with the notice in its header, reviewed
yearly after Nielsen's annual publication, never fetched at run time, and
removed if the licence lapses. No such licence exists.
