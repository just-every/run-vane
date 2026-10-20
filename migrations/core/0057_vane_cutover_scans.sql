CREATE TABLE vane_cutover_scans (
 id TEXT PRIMARY KEY,
 site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL,
 at INTEGER NOT NULL,
 page_limit INTEGER NOT NULL,
 fetched INTEGER NOT NULL,
 refused INTEGER NOT NULL,
 state TEXT NOT NULL,
 findings_json TEXT NOT NULL
);
CREATE INDEX vane_cutover_scans_site ON vane_cutover_scans(site_id,at);
