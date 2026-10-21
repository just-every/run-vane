-- IMPORT-007: cut-over policy travels with imported history, including settled site transfers.
CREATE TABLE vane_import_cutovers (
 site_id TEXT NOT NULL, job_id TEXT NOT NULL, day TEXT NOT NULL,
 PRIMARY KEY(site_id,job_id)
);
