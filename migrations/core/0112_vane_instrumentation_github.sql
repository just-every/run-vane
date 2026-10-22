-- Owner-approved source connection and bounded draft-PR outbox. Neither authority table travels in archives.
CREATE TABLE vane_instrumentation_github (
 site_id TEXT PRIMARY KEY REFERENCES vane_sites(id) ON DELETE CASCADE,
 generation TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0, repository TEXT NOT NULL, base_branch TEXT NOT NULL,
 mappings_json TEXT NOT NULL, sealed_token TEXT NOT NULL, last_head TEXT,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE vane_instrumentation_prs (
 fix_id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 generation TEXT NOT NULL, base_sha TEXT NOT NULL, branch TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('prepared','sending','blocked','uncertain','published')),
 candidate_sha TEXT, pr_url TEXT, pr_number INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
