-- Derived investigations and reviewed fix drafts. No source bodies or visitor fields are copied here.
CREATE TABLE vane_instrumentation_runs (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL, at INTEGER NOT NULL, scan_id TEXT NOT NULL,
 from_day TEXT NOT NULL, to_day TEXT NOT NULL, report_json TEXT NOT NULL
);
CREATE INDEX vane_instrumentation_runs_site ON vane_instrumentation_runs(site_id,at);
CREATE TABLE vane_instrumentation_fixes (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 proposal_id TEXT NOT NULL, draft_json TEXT NOT NULL, verified_at INTEGER
);
CREATE INDEX vane_instrumentation_fixes_site ON vane_instrumentation_fixes(site_id,created_at);
