-- AGENT-007: the owner's explicit choice to send a site's questions to the configured model provider. Off by default.
-- Questions, model replies and answers are never stored; the audit row holds only the outcome class.
CREATE TABLE vane_ask_sites (
 site_id TEXT PRIMARY KEY REFERENCES vane_sites(id) ON DELETE CASCADE,
 enabled_by TEXT NOT NULL,
 enabled_at INTEGER NOT NULL
);
