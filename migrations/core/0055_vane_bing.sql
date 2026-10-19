-- SEARCH-002: credentials/configuration never belong to an archive. Source aggregates do.
CREATE TABLE vane_bing_connections (
 site_id TEXT PRIMARY KEY REFERENCES vane_sites(id) ON DELETE CASCADE,
 id TEXT NOT NULL UNIQUE,
 property TEXT NOT NULL,
 sealed_key TEXT NOT NULL,
 connected_by TEXT NOT NULL,
 connected_at INTEGER NOT NULL,
 last_attempt_at INTEGER,
 last_sync_at INTEGER,
 sync_id TEXT,
 next_sync_at INTEGER NOT NULL,
 error TEXT,
 query_pages_error TEXT,
 source_counts TEXT
);
CREATE INDEX vane_bing_due ON vane_bing_connections(next_sync_at);
CREATE TABLE vane_bing_rows (
 site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('query','page','date','query-page')),
 query TEXT NOT NULL DEFAULT '',
 page TEXT NOT NULL DEFAULT '',
 clicks INTEGER NOT NULL CHECK(clicks>=0),
 impressions INTEGER NOT NULL CHECK(impressions>=0),
 position_sum REAL NOT NULL DEFAULT 0,
 position_weight INTEGER NOT NULL DEFAULT 0,
 fetched_at INTEGER NOT NULL,
 PRIMARY KEY(site_id,day,kind,query,page)
);
