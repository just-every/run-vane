-- DASH-004: the channel derived at collection, and the referring page (hostname and redacted path, no query).
ALTER TABLE vane_events ADD COLUMN channel TEXT;
ALTER TABLE vane_events ADD COLUMN referrer TEXT;
