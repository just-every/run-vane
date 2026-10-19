-- DASH-010: an owner's roll-up view over several sites; it holds only its name and member site IDs.
CREATE TABLE vane_rollups(id TEXT PRIMARY KEY, name TEXT NOT NULL, site_ids TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
