-- EXPERIMENT-001: one exposure per page load and experiment: the variant the page load's visitor hash was assigned
-- and applied there (its visitor and day come from that page load).
CREATE TABLE vane_exposures(page_id TEXT NOT NULL, site_id TEXT NOT NULL, day TEXT NOT NULL, experiment TEXT NOT NULL, variant TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(page_id,experiment));
CREATE INDEX vane_exposures_site_day ON vane_exposures(site_id,experiment,day);
