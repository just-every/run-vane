-- DASH-005: location names from Cloudflare's request geolocation at collection; no IP address is ever stored.
ALTER TABLE vane_events ADD COLUMN country TEXT;
ALTER TABLE vane_events ADD COLUMN region TEXT;
ALTER TABLE vane_events ADD COLUMN city TEXT;
ALTER TABLE vane_events ADD COLUMN metro TEXT;
