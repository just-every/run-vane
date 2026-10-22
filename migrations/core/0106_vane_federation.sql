-- TEAM-002: short-lived SP-initiated SAML attempts. Both the browser/RelayState
-- claim and the library's request cache live in D1, never process memory.
CREATE TABLE vane_saml_requests (
 relay_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL,
 config_hash TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
 request_value TEXT NOT NULL, created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, claim TEXT, cache_removed INTEGER NOT NULL DEFAULT 0 CHECK(cache_removed IN (0,1))
);
CREATE INDEX vane_saml_expiry ON vane_saml_requests(expires_at);
CREATE INDEX vane_saml_browser ON vane_saml_requests(browser_hash,expires_at);

-- SCIM records associations to an invitation the owner already authorized.
-- Provisioning never creates a person, changes a grant, or accepts an invitation.
CREATE TABLE vane_scim_users (
 operator_id TEXT PRIMARY KEY REFERENCES oa_operators(id),
 external_id TEXT UNIQUE, created_at INTEGER NOT NULL
);
