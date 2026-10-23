-- Installation-local GA4 credentials and single-use approvals. Never archived.
CREATE TABLE vane_ga4_connections (
 site_id TEXT PRIMARY KEY REFERENCES vane_sites(id) ON DELETE CASCADE,
 generation TEXT NOT NULL, sealed_tokens TEXT NOT NULL,
 property TEXT, properties_json TEXT NOT NULL DEFAULT '[]',
 connected_by TEXT NOT NULL, connected_at INTEGER NOT NULL,
 last_sync INTEGER, next_sync INTEGER NOT NULL, last_error TEXT,
 lock_id TEXT, lock_until INTEGER
);
CREATE TABLE vane_ga4_oauth_states (
 state_hash TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL, session_hash TEXT NOT NULL,
 redirect_uri TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
);
CREATE INDEX vane_ga4_oauth_expiry ON vane_ga4_oauth_states(expires_at);
