-- ALERT-001: traffic alerts on a fixed threshold (current visitors, or visitors, visits or pageviews in the last 60 minutes),
-- each with its cool-down and creator, and the alert log: when a crossing was seen, whether it was sent or held, and why.
CREATE TABLE vane_alerts(id TEXT PRIMARY KEY, site_id TEXT NOT NULL, metric TEXT NOT NULL CHECK(metric IN ('current','visitors','visits','pageviews')), direction TEXT NOT NULL CHECK(direction IN ('above','below')), threshold INTEGER NOT NULL, cooldown_hours INTEGER NOT NULL, crossed INTEGER NOT NULL DEFAULT 0, last_sent_at INTEGER, created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE vane_alert_log(id TEXT PRIMARY KEY, alert_id TEXT NOT NULL, site_id TEXT NOT NULL, metric TEXT NOT NULL, direction TEXT NOT NULL, threshold INTEGER NOT NULL, value INTEGER NOT NULL, seen_at INTEGER NOT NULL, sent_at INTEGER, outcome TEXT NOT NULL);
CREATE INDEX vane_alert_log_site ON vane_alert_log(site_id,seen_at);
