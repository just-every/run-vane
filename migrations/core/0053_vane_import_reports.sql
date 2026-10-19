-- IMPORT-005: source aggregates retain their own definitions and independent report grain.
-- Never fabricate visitor hashes or individual events from report totals.
CREATE TABLE vane_import_reports (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL, import_job TEXT NOT NULL,
 day TEXT NOT NULL, provider TEXT NOT NULL, report TEXT NOT NULL,
 dimensions_json TEXT NOT NULL, metrics_json TEXT NOT NULL, definitions_json TEXT NOT NULL
);
CREATE INDEX vane_import_reports_site_day ON vane_import_reports(site_id,day);
