CREATE TABLE vane_sites(id TEXT PRIMARY KEY, name TEXT NOT NULL, origin TEXT NOT NULL UNIQUE, config_json TEXT NOT NULL, created_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE vane_events(id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES vane_sites(id), day TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL, source TEXT NOT NULL, campaign TEXT NOT NULL, consent TEXT NOT NULL, sample_rate INTEGER, import_job TEXT);
CREATE INDEX vane_events_report ON vane_events(site_id,day);
CREATE TABLE vane_proposals(id TEXT PRIMARY KEY, command TEXT NOT NULL, payload_json TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected')), prepared_by TEXT NOT NULL, created_at INTEGER NOT NULL, approved_by TEXT, approved_at INTEGER);
CREATE TABLE vane_deletions(id TEXT PRIMARY KEY, site_id TEXT NOT NULL, before_day TEXT NOT NULL, at INTEGER NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL);
CREATE TABLE vane_admission(site_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(site_id,day));
CREATE TABLE vane_guard(value INTEGER NOT NULL CHECK(value=1));
CREATE TABLE vane_restore(id TEXT PRIMARY KEY, digest TEXT NOT NULL, restored_by TEXT NOT NULL, at INTEGER NOT NULL);
