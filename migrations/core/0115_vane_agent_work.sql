CREATE TABLE vane_agent_work (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, from_day TEXT NOT NULL, to_day TEXT NOT NULL,
 payload_json TEXT NOT NULL, created_by TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE INDEX vane_agent_work_site ON vane_agent_work(site_id,kind,from_day,to_day);
CREATE TABLE vane_agent_dismissals (
 site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 type TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL,
 PRIMARY KEY(site_id,type)
);
