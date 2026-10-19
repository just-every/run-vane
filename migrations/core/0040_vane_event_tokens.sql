-- INSTALL-008: per-site events tokens (kind 'events', one site in site_ids) join the API keys, so the kind check is
-- rebuilt. vane_idempotency keeps only the SHA-256 of each Idempotency-Key a token sent in the last 24 hours, with
-- the counts its first request answered.
CREATE TABLE vane_api_keys_next(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('stats','provisioning','events')), label TEXT NOT NULL, site_ids TEXT, token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER);
INSERT INTO vane_api_keys_next(id,kind,label,site_ids,token_hash,created_by,created_at,revoked_at) SELECT id,kind,label,site_ids,token_hash,created_by,created_at,revoked_at FROM vane_api_keys;
DROP TABLE vane_api_keys;
ALTER TABLE vane_api_keys_next RENAME TO vane_api_keys;
CREATE TABLE vane_idempotency(key_id TEXT NOT NULL, key_hash TEXT NOT NULL, at INTEGER NOT NULL, answer TEXT, PRIMARY KEY(key_id,key_hash));
