-- API-002: a site's scheduled warehouse export to an owner-entered S3-compatible bucket (Amazon S3 or Cloudflare R2).
-- The secret access key is sealed with AES-GCM under the installation's session secret and never shown again;
-- last_day is the last site-local date exported, next_attempt_at holds a failed run back for an hour, and
-- last_result is the newest run's outcome (counts or the refusal), as the audit records each run.
CREATE TABLE vane_exports(site_id TEXT PRIMARY KEY, endpoint TEXT NOT NULL, bucket TEXT NOT NULL, region TEXT NOT NULL, prefix TEXT NOT NULL, access_key_id TEXT NOT NULL, sealed_secret TEXT NOT NULL, last_day TEXT NOT NULL, next_attempt_at INTEGER, last_result TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
