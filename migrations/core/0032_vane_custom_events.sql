-- CONV-002: custom events, each on the page load it happened on (its visitor and visit come from that page load), and
-- the properties of custom events and pageviews (event_id is a custom event or a pageview), with their site and day.
CREATE TABLE vane_custom_events(id TEXT PRIMARY KEY, site_id TEXT NOT NULL, day TEXT NOT NULL, page_id TEXT NOT NULL, name TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX vane_custom_events_page ON vane_custom_events(page_id);
CREATE INDEX vane_custom_events_site_day ON vane_custom_events(site_id,day);
CREATE TABLE vane_event_props(event_id TEXT NOT NULL, site_id TEXT NOT NULL, day TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(event_id,key));
CREATE INDEX vane_event_props_site_key ON vane_event_props(site_id,key,day);
