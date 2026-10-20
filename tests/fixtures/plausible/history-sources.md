# Plausible history fixtures

All counts are synthetic. No Plausible account, real key or visitor data is used.

The ZIP includes every published dashboard report. Column labels follow the upstream exporter and default CSV configuration, including `unique_entrances`, `total_entrances`, `unique_exits`, `total_exits`, `exit_rate`, and the reversed `name,version` browser/OS headers.

- https://github.com/plausible/analytics/blob/master/lib/plausible/stats/dashboard/csv_export.ex
- https://github.com/plausible/analytics/blob/master/assets/js/dashboard/stats/csv-export/csv-export-body.ts
- https://github.com/plausible/analytics/blob/master/test/plausible_web/controllers/api/stats_controller/dashboard_csv_export_test.exs

`history-api.json` follows https://plausible.io/docs/stats-api, including ordered `dimensions` / `metrics` arrays, echoed query, `meta.total_rows`, nullable revenue and `{value,currency,short,long}` money. It embeds the existing typed Sites API definition fixtures. Dashboard exports do not include revenue currency; history revenue is read using the Stats API.

`history-dashboard.json` holds the unzipped source for independent totals assertions. Its ZIP has no Vane metadata or added files.
