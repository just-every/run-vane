-- ALERT-001: the site's business calendar: days the business is closed, left out of alert and report baselines and not
-- judged against ordinary weeks.
CREATE TABLE vane_closed_days(site_id TEXT NOT NULL, day TEXT NOT NULL, label TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(site_id,day));
