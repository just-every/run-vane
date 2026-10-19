# Bing Webmaster Tools backend

`index.ts` exports `connect`, `disconnect`, `runNow`, daily `sync`, `report` and
`queryPaths(env, siteId, query, from, to, actor)`. Connections and manual runs
require the owner. Reports require site read access and scope. `queryPaths` is an internal report helper; its caller establishes site scope at the native report or Stats API door. An optional actor makes that check explicit for other callers.

Connect validates the exact property against `GetUserSites` with `IsVerified`
true and immediately syncs. A failed sync throws a safe provider error and
stores its visible reason. Disconnect removes the sealed key and configuration,
retaining fetched history. Reconnect starts a fresh property snapshot.

The only request origin is `https://ssl.bing.com`. Requests use the documented
`/webmaster/api.svc/json/` methods. Property and page URLs are parameters sent
to Bing, never outbound origins. Redirects are refused. Microsoft requires the
API key in `apikey`; neither request URLs, response bodies nor original errors
are logged, persisted or returned. The key is sealed with the existing AES-GCM
helper, bound to the site and connection revision.

Archive/export and erasure integration must include `vane_bing_rows` and exclude
`vane_bing_connections` (including its sealed key and configuration). Remove the
connection on site deletion. Inserts check the current connection revision/run,
site existence, and the persistent `vane_deletions.before_day` fence to prevent
an old sync from reviving erased history.

Report fields: safe `connection`, `queries`, `pages`, `dates`, `queryPages`,
dated `rows`, and explicit `metadata`. Metrics are `clicks`, `impressions`, `ctr`
(fraction or null without impressions), and `position` (impression-weighted
AvgImpressionPosition, null without a source measurement). Pages and query-page
paths use `storedPath`; query labels use `keptValue`. No visitor data is imported.
Date rows come from the source's site totals; they are never added to query or
page rows. A failure of page-query collection keeps the previous page-query
snapshot while publishing successful primary datasets and a visible error.

The API controls history and top-row coverage. Query/page datasets are documented
as updated weekly, site/date totals daily. Source calendar dates are retained;
there is no daily interpolation, invented zero, country/device breakdown, or
promise of a specific history window. Already observed history outside a newly
returned source date window remains stored with its actual fetch timestamp.

Official protocol/schema sources:

- [API key access](https://learn.microsoft.com/en-us/bingwebmaster/getting-access)
- [GetUserSites](https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getusersites?view=bing-webmaster-dotnet)
- [GetQueryStats](https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getquerystats?view=bing-webmaster-dotnet)
- [GetPageStats](https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getpagestats?view=bing-webmaster-dotnet)
- [GetPageQueryStats](https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getpagequerystats?view=bing-webmaster-dotnet)
- [GetRankAndTrafficStats](https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getrankandtrafficstats?view=bing-webmaster-dotnet)
- [WCF date encoding](https://learn.microsoft.com/en-us/dotnet/framework/wcf/feature-details/stand-alone-json-serialization#datetime-wire-format)
