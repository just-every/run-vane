-- MOBILE-001: the installation's VAPID key pair (private key sealed) and each person's per-browser push subscriptions.
CREATE TABLE vane_push_keys(id TEXT PRIMARY KEY, public_key TEXT NOT NULL, sealed_private TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE vane_push_subscriptions(id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX vane_push_subscriptions_operator ON vane_push_subscriptions(operator_id);
