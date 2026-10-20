-- ALERT-002: preserve the reporting unit of every revenue crossing.
ALTER TABLE vane_alert_log ADD COLUMN currency TEXT CHECK(metric <> 'revenue' OR currency IS NOT NULL);
