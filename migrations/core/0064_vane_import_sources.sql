CREATE TABLE vane_import_sources(site_id TEXT NOT NULL, job_id TEXT NOT NULL, provider TEXT NOT NULL, PRIMARY KEY(site_id,job_id));
CREATE TABLE vane_import_day_choices(site_id TEXT NOT NULL, day TEXT NOT NULL, job_id TEXT NOT NULL, PRIMARY KEY(site_id,day));
CREATE INDEX vane_import_events_job_day ON vane_import_events(site_id,import_job,day);
CREATE INDEX vane_import_sources_provider ON vane_import_sources(site_id,provider,job_id);
