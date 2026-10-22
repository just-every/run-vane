-- Bound exact old-neighbor expansion by distinct incoming timestamp buckets,
-- then order their occurrences and the new rows once for each anonymous chain.
-- Both tables are transaction scratch, emptied before native admission returns.
CREATE TABLE vane_visit_bulk_buckets(
 context INTEGER NOT NULL,at_offset INTEGER NOT NULL,
 PRIMARY KEY(context,at_offset)
) WITHOUT ROWID;
CREATE TABLE vane_visit_bulk_neighbors(
 rank INTEGER PRIMARY KEY,raw_id INTEGER NOT NULL UNIQUE,
 site INTEGER NOT NULL,day TEXT NOT NULL,visitor INTEGER NOT NULL,context INTEGER NOT NULL,
 at_offset INTEGER NOT NULL,token BLOB NOT NULL,at INTEGER NOT NULL,
 engaged INTEGER,scroll INTEGER NOT NULL,gap INTEGER NOT NULL,old_visit INTEGER,
 next_id INTEGER,next_at_offset INTEGER,old_prev_rank INTEGER,old_next_rank INTEGER
);
