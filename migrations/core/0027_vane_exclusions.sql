-- COVERAGE-001: field-free daily counts of page loads that reached Vane but were not collected, by reason:
-- consent-declined (only when the owner turns the counter on) and excluded-path.
CREATE TABLE vane_exclusions(site_id TEXT NOT NULL, day TEXT NOT NULL, reason TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(site_id,day,reason));
