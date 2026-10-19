-- ALERT-001: an alert may count only a saved segment's visits (DASH-007, which carries the Hostname filter of DASH-013).
ALTER TABLE vane_alerts ADD COLUMN segment_id TEXT;
