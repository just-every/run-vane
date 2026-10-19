-- METRIC-002/003: when a page load was admitted, and its latest engagement ping (both epoch ms).
-- Events collected before this release, imports and demo rows without a time are left out of visits.
ALTER TABLE vane_events ADD COLUMN at INTEGER;
ALTER TABLE vane_events ADD COLUMN engaged_at INTEGER;
