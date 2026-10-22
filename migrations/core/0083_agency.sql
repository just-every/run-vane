-- AGENCY-001: client grouping and public report branding, independent of native account custody.
CREATE TABLE vane_agency_clients(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE vane_agency_sites(site_id TEXT PRIMARY KEY, client_id TEXT NOT NULL);
CREATE INDEX vane_agency_client_sites ON vane_agency_sites(client_id);
CREATE TABLE vane_agency_members(operator_id TEXT PRIMARY KEY, client_id TEXT NOT NULL);
CREATE TABLE vane_agency_brands(id TEXT PRIMARY KEY, name TEXT NOT NULL, accent TEXT NOT NULL, background TEXT NOT NULL, logo_id TEXT, custom_origin TEXT UNIQUE, enabled INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE vane_agency_logos(id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL);
