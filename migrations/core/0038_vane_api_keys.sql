-- API-001: Stats API keys (read-only, for the sites in site_ids) and the owner's provisioning keys (site_ids NULL).
-- Only the SHA-256 of a key is kept; revoked_at refuses it at once. vane_api_usage counts requests per key in the
-- 10-second (scope b) and clock-hour (scope h) windows the published rate limits use, and per UTC day (scope d)
-- as the key's only record of its use.
CREATE TABLE vane_api_keys(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('stats','provisioning')), label TEXT NOT NULL, site_ids TEXT, token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER);
CREATE TABLE vane_api_usage(key_id TEXT NOT NULL, scope TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(key_id,scope,window));
