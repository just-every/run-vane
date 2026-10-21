CREATE TABLE vane_import_sources(site_id TEXT NOT NULL, job_id TEXT NOT NULL, provider TEXT NOT NULL, PRIMARY KEY(site_id,job_id));
CREATE TABLE vane_import_day_choices(site_id TEXT NOT NULL, day TEXT NOT NULL, job_id TEXT NOT NULL, PRIMARY KEY(site_id,day));
