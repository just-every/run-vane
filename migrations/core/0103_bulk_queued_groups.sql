-- Share the actual admitted physical-group population between occurrence
-- accounting and visit maintenance. The physical rows and raw-ID queue remain
-- intact; this transaction-local cache is cleared before admission returns.
CREATE TABLE vane_visit_bulk_queued_groups(
 group_id INTEGER PRIMARY KEY,site INTEGER NOT NULL,context INTEGER NOT NULL,
 day TEXT NOT NULL,visitor INTEGER,site_id TEXT NOT NULL,kind TEXT NOT NULL,
 at_offset INTEGER,at INTEGER,identity TEXT,cell TEXT NOT NULL,
 consented INTEGER NOT NULL,raw_count INTEGER NOT NULL CHECK(raw_count>0),
 first_token BLOB NOT NULL,last_token BLOB NOT NULL,legacy INTEGER NOT NULL
);
