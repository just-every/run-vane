-- Anonymous page geometry, never DOM text, attributes, selectors or identifiers.
CREATE TABLE vane_heat_layouts (
 site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 path TEXT NOT NULL,
 width INTEGER NOT NULL,
 geometry_json TEXT NOT NULL,
 PRIMARY KEY(site_id,day,path,width)
);
CREATE TRIGGER vane_heat_layout_erasure AFTER INSERT ON vane_deletions BEGIN
 DELETE FROM vane_heat_layouts WHERE site_id=NEW.site_id AND day<NEW.before_day;
END;
