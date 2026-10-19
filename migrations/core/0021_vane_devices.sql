-- DASH-006: classes derived from the user agent and viewport width at collection; the user agent itself is never stored.
ALTER TABLE vane_events ADD COLUMN device TEXT;
ALTER TABLE vane_events ADD COLUMN browser TEXT;
ALTER TABLE vane_events ADD COLUMN browser_version TEXT;
ALTER TABLE vane_events ADD COLUMN os TEXT;
ALTER TABLE vane_events ADD COLUMN os_version TEXT;
ALTER TABLE vane_events ADD COLUMN screen TEXT;
