-- Derive multiplicities only from the queue of actual physical INSERTs.
-- New native pageviews have no engagement or scroll details. Interior tokens
-- at one exact context/time therefore contribute zero on-page milliseconds.
-- Every raw occurrence and its full token remains in the raw store and queue.
CREATE TABLE vane_visit_bulk_new_groups(
 group_id INTEGER PRIMARY KEY,site INTEGER NOT NULL,context INTEGER NOT NULL,
 day TEXT NOT NULL,visitor INTEGER NOT NULL,at_offset INTEGER NOT NULL,at INTEGER NOT NULL,
 identity TEXT NOT NULL,pages INTEGER NOT NULL CHECK(pages>0),
 first_raw INTEGER NOT NULL,last_raw INTEGER NOT NULL
);
