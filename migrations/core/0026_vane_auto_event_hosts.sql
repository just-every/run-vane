-- DASH-013: automatic events record the hostname of the page they happened on, like page loads.
ALTER TABLE vane_auto_events ADD COLUMN hostname TEXT;
