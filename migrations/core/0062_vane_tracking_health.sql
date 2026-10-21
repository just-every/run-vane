-- ALERT-002: each site's daily tracking-health check. The owner sets its local time (09:00 by default); a run keeps the
-- local day it ran on, when it ran and what it found for the day it judged (goal names with their conversion counts,
-- silent pages, collection-error and consent-rate figures), never a visitor field. Tracking-health alerts are
-- vane_alerts rows with a tracking-health metric.
CREATE TABLE vane_health(site_id TEXT PRIMARY KEY, check_minute INTEGER NOT NULL DEFAULT 540 CHECK(check_minute BETWEEN 0 AND 1439), checked_day TEXT, checked_at INTEGER, result_json TEXT);
