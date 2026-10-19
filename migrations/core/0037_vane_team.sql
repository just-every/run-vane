-- TEAM-001: a team member's Vane role beside their Base account role, and the sites they may open. role is admin
-- for a Base admin, and analyst or viewer for a Base member; site_ids is a JSON array of site IDs, or NULL for every
-- site. The owner never has a row: the owner holds every site.
CREATE TABLE vane_grants(operator_id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin','analyst','viewer')), site_ids TEXT, granted_by TEXT NOT NULL, granted_at INTEGER NOT NULL);
