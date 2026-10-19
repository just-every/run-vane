-- SEARCH-001. Connection credentials and OAuth transactions are installation-local secrets:
-- never archive, export or transfer vane_search_connections / vane_search_oauth_states.
CREATE TABLE vane_search_connections (
 site_id TEXT PRIMARY KEY REFERENCES vane_sites(id) ON DELETE CASCADE,
 generation TEXT NOT NULL, sealed_tokens TEXT NOT NULL,
 property TEXT, properties_json TEXT NOT NULL DEFAULT '[]',
 connected_by TEXT NOT NULL, connected_at INTEGER NOT NULL,
 last_sync INTEGER, next_sync INTEGER NOT NULL, last_error TEXT,
 lock_id TEXT, lock_until INTEGER
);
CREATE TABLE vane_search_oauth_states (
 state_hash TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL, session_hash TEXT NOT NULL,
 redirect_uri TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
);
CREATE INDEX vane_search_oauth_expiry ON vane_search_oauth_states(expires_at);
-- A day points at a complete immutable snapshot. A failed or disconnected sync never publishes half a day.
CREATE TABLE vane_search_days (
 site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE, day TEXT NOT NULL,
 property TEXT NOT NULL, snapshot_id TEXT, status TEXT NOT NULL CHECK(status IN ('final','pending')),
 checked_at INTEGER NOT NULL, published_at INTEGER,
 PRIMARY KEY(site_id,day)
);
CREATE TABLE vane_search_rows (
 site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE, day TEXT NOT NULL,
 snapshot_id TEXT NOT NULL,
 grain TEXT NOT NULL CHECK(grain IN ('overall','query','page','query_page')),
 query TEXT NOT NULL DEFAULT '', page TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '',
 clicks REAL NOT NULL, impressions REAL NOT NULL, ctr REAL NOT NULL, position REAL NOT NULL,
 PRIMARY KEY(snapshot_id,grain,query,page)
);
CREATE INDEX vane_search_rows_site_day ON vane_search_rows(site_id,day);
