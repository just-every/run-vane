-- DASH-009: dated chart annotations a site keeps: team members' notes and the events integrations post
-- (deploys, releases, incidents, error spikes, campaign sends). Settings changes, definition versions and imports
-- are annotated from the audit trail, the site's definitions and import approvals, so they are not copied here.
CREATE TABLE vane_annotations(id TEXT PRIMARY KEY, site_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, url TEXT, author TEXT, at INTEGER NOT NULL);
CREATE INDEX vane_annotations_site_day ON vane_annotations(site_id,day);
-- The site's annotation webhook secret, created and revoked only by the owner; only its SHA-256 is kept.
CREATE TABLE vane_annotation_hooks(site_id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, created_at INTEGER NOT NULL, created_by TEXT NOT NULL);
-- The site's GitHub release key: HMAC verification needs the key itself, so it is kept encrypted (AES-GCM under a key
-- derived from the installation's session secret), created and revoked only by the owner, and accepts release events only.
CREATE TABLE vane_github_keys(site_id TEXT PRIMARY KEY, sealed_key TEXT NOT NULL, created_at INTEGER NOT NULL, created_by TEXT NOT NULL);
