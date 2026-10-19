-- COLLECT-002: the page's hostname (lowercased, no port), the UTM fields beyond the campaign, the paid-click flag
-- (set by gclid, fbclid or msclkid, whose values are never stored) and the owner's kept query parameters.
ALTER TABLE vane_events ADD COLUMN hostname TEXT;
ALTER TABLE vane_events ADD COLUMN utm_source TEXT;
ALTER TABLE vane_events ADD COLUMN utm_medium TEXT;
ALTER TABLE vane_events ADD COLUMN utm_term TEXT;
ALTER TABLE vane_events ADD COLUMN utm_content TEXT;
ALTER TABLE vane_events ADD COLUMN paid_click INTEGER;
ALTER TABLE vane_events ADD COLUMN query TEXT;
