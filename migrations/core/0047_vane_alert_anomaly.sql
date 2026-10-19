-- ALERT-001: an alert fires on a fixed threshold or on an anomaly against the same weekday and hour in the 8 weeks
-- before; the newest local hour it judged; and the site's scheduled maintenance windows, one-off or weekly, inside which
-- a drop is held and logged, not sent.
ALTER TABLE vane_alerts ADD COLUMN condition TEXT NOT NULL DEFAULT 'threshold' CHECK(condition IN ('threshold','anomaly'));
ALTER TABLE vane_alerts ADD COLUMN judged_hour INTEGER;
ALTER TABLE vane_alert_log ADD COLUMN condition TEXT NOT NULL DEFAULT 'threshold';
CREATE TABLE vane_maintenance(id TEXT PRIMARY KEY, site_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('once','weekly')), weekday INTEGER, day TEXT, start_minute INTEGER NOT NULL, end_minute INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
