-- SHARE-001: read-only shared links to a site or one of its saved segments, with the reports the owner chose. Only the
-- SHA-256 of the link's token is kept; an optional password is kept as a salted PBKDF2-SHA256 hash. A revoked link's
-- row is deleted, so it answers 404 at once. failures/failed_from count wrong passwords in the current 15-minute window.
CREATE TABLE vane_share_links(id TEXT PRIMARY KEY, site_id TEXT NOT NULL, label TEXT NOT NULL, segment_id TEXT, reports_json TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, password_salt TEXT, password_hash TEXT, expires_at INTEGER, embed_origins_json TEXT NOT NULL, failures INTEGER NOT NULL DEFAULT 0, failed_from INTEGER, created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX vane_share_links_site ON vane_share_links(site_id);
