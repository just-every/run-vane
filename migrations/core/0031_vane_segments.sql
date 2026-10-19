-- DASH-007: a site's saved segments, named filter sets shared with its team; filters_json is a JSON array of
-- {dimension, op, value}. The owner and administrators save, replace and delete them.
CREATE TABLE vane_segments(id TEXT PRIMARY KEY, site_id TEXT NOT NULL, name TEXT NOT NULL, filters_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(site_id,name));
