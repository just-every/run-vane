ALTER TABLE vane_events ADD COLUMN visitor TEXT;
-- One random salt per site and local day. It never leaves the database: the archive excludes it.
CREATE TABLE vane_salts(site_id TEXT NOT NULL, day TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(site_id,day));
