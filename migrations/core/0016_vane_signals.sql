CREATE TABLE vane_signals(site_id TEXT NOT NULL REFERENCES vane_sites(id), day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(site_id,day));
