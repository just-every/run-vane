-- HEAT-001: page allowlist and daily grid counters, never visitor or event rows.
CREATE TABLE vane_heat_pages (
 site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 path TEXT NOT NULL,
 enabled_by TEXT NOT NULL,
 enabled_at INTEGER NOT NULL,
 PRIMARY KEY(site_id,path)
);
CREATE TABLE vane_heat_clicks (
 site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 path TEXT NOT NULL,
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 10000),
 x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 39),
 y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 99),
 count INTEGER NOT NULL CHECK(count>0),
 PRIMARY KEY(site_id,day,path,width,x,y)
);
-- Follow the same erasure/retention journal as event history. Page choices are settings.
CREATE TRIGGER vane_heat_erasure AFTER INSERT ON vane_deletions BEGIN
 DELETE FROM vane_heat_clicks WHERE site_id=NEW.site_id AND day<NEW.before_day;
END;
