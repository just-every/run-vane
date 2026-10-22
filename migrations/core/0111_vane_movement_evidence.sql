-- Off-default, owner-approved incoming aggregates. The sender key grants no native/API/annotation authority.
CREATE TABLE vane_agent_evidence_keys (
 site_id TEXT PRIMARY KEY REFERENCES vane_sites(id) ON DELETE CASCADE,
 secret_hash TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 window_start INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE vane_agent_evidence (
 site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 day TEXT NOT NULL, metric TEXT NOT NULL CHECK(metric IN ('orders','checkout-errors','uptime-failures')),
 numerator INTEGER NOT NULL CHECK(numerator>=0), denominator INTEGER NOT NULL CHECK(denominator>=numerator),
 revision INTEGER NOT NULL CHECK(revision>0), content_hash TEXT NOT NULL,
 url TEXT, received_at INTEGER NOT NULL,
 PRIMARY KEY(site_id,day,metric)
);
CREATE TABLE vane_movement_investigations (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL, at INTEGER NOT NULL, from_day TEXT NOT NULL, to_day TEXT NOT NULL,
 compared_from TEXT NOT NULL, compared_to TEXT NOT NULL, report_json TEXT NOT NULL
);
CREATE INDEX vane_movement_investigations_site ON vane_movement_investigations(site_id,at);
