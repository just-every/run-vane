-- DASH-005: retain the edge code separately from the sourced display name.
ALTER TABLE vane_events RENAME COLUMN metro TO metro_code;
ALTER TABLE vane_events ADD COLUMN metro_name TEXT;
