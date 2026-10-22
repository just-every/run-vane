-- Every occurrence in one raw context/time group has the same exact visit.
-- Queue one assignment per group; conflicting assignments must abort rather
-- than choosing an arbitrary visit. Cleared inside the admitting transaction.
CREATE TABLE vane_visit_bulk_membership(
 group_id INTEGER PRIMARY KEY,visit INTEGER NOT NULL
);
