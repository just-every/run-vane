-- API-003: a site's signed webhooks. The signing secret is sealed (HMAC needs it); last_minute is the last ended UTC
-- minute whose goal conversions were queued. Each delivery keeps its counts-only payload, and each attempt only its
-- time, HTTP status and outcome.
CREATE TABLE vane_webhooks(id TEXT PRIMARY KEY, site_id TEXT NOT NULL, url TEXT NOT NULL, events_json TEXT NOT NULL, sealed_secret TEXT NOT NULL, last_minute INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE vane_webhook_deliveries(id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, site_id TEXT NOT NULL, event TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','delivered','failed')), attempts INTEGER NOT NULL, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX vane_webhook_due ON vane_webhook_deliveries(state,next_at);
CREATE TABLE vane_webhook_attempts(delivery_id TEXT NOT NULL, attempt INTEGER NOT NULL, site_id TEXT NOT NULL, at INTEGER NOT NULL, status INTEGER, outcome TEXT NOT NULL, PRIMARY KEY(delivery_id,attempt));
