-- INSTALL-006: credentials belong to this installation and are excluded from archives.
-- Only SHA-256 digests are retained; provider_json is nonsecret route configuration.
CREATE TABLE vane_proxy_connections (
 id TEXT PRIMARY KEY,
 site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 mode TEXT NOT NULL CHECK(mode IN ('external','worker')),
 hostname TEXT NOT NULL,
 site_origin TEXT NOT NULL,
 public_prefix TEXT NOT NULL,
 credential_hash TEXT,
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 rotated_at INTEGER,
 revoked_at INTEGER,
 provider_json TEXT,
 CHECK((mode='external' AND credential_hash IS NOT NULL) OR (mode='worker' AND credential_hash IS NULL))
);
CREATE UNIQUE INDEX vane_proxy_active_path ON vane_proxy_connections(hostname,public_prefix) WHERE revoked_at IS NULL;
CREATE INDEX vane_proxy_site ON vane_proxy_connections(site_id,created_at);
