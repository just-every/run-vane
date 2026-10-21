-- METRIC-005: only site-scoped digests; the raw first-party identifier is never stored.
ALTER TABLE vane_events ADD COLUMN consented_visitor TEXT;
ALTER TABLE vane_events ADD COLUMN consented_created_at INTEGER;
ALTER TABLE vane_events ADD COLUMN consented_expires_at INTEGER;
CREATE INDEX vane_events_consented ON vane_events(site_id,consented_visitor,day) WHERE consented_visitor IS NOT NULL;
