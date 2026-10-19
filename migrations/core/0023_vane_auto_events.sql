-- CONV-003: automatic outbound-link, download, 404 and form-submission events, each with one recorded detail.
CREATE TABLE vane_auto_events(id TEXT PRIMARY KEY, site_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, prop TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX vane_auto_events_site_day ON vane_auto_events(site_id, day);
