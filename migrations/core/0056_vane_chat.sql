CREATE TABLE vane_chat_connections (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('slack','teams')), label TEXT NOT NULL,
 channel TEXT, sealed_secret TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE vane_chat_states (
 state_hash TEXT PRIMARY KEY, site_id TEXT NOT NULL, actor_id TEXT NOT NULL, session_hash TEXT NOT NULL,
 label TEXT NOT NULL, channel TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
);
CREATE TABLE vane_chat_schedules (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 connection_id TEXT NOT NULL REFERENCES vane_chat_connections(id) ON DELETE CASCADE,
 segment_id TEXT, frequency TEXT NOT NULL, weekday INTEGER NOT NULL, hour INTEGER NOT NULL,
 next_at INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE vane_chat_log (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 connection_id TEXT NOT NULL, provider TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL,
 period TEXT NOT NULL, at INTEGER NOT NULL, state TEXT NOT NULL, reason TEXT NOT NULL,
 UNIQUE(connection_id,kind,period)
);
