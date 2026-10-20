-- DASH-005 (ct ruling 20 Oct 2026 22:31Z): events keep only the US metro code. Names come from each site's
-- owner-approved metro-name table, a site setting holding no visitor data, and are looked up when a report, export or
-- API answer is made. Vane ships no code-to-name table.
ALTER TABLE vane_events DROP COLUMN metro_name;
CREATE TABLE vane_metro_names(site_id TEXT NOT NULL,metro_code TEXT NOT NULL CHECK(length(metro_code)=3),metro_name TEXT NOT NULL,PRIMARY KEY(site_id,metro_code));
CREATE TABLE vane_metro_tables(site_id TEXT PRIMARY KEY,label TEXT,public INTEGER NOT NULL DEFAULT 0,rows INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 0,prepared_by TEXT,approved_by TEXT,approved_at INTEGER);
