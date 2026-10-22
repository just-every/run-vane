-- Seek the next actual timestamp within one maintained visit without scanning
-- every metadata group in that visit. Membership and all occurrences remain
-- unchanged; the partial index still excludes groups without a visit.
DROP INDEX vane_raw_groups_visit;
CREATE INDEX vane_raw_groups_visit ON vane_raw_groups(visit_id,at_offset) WHERE visit_id IS NOT NULL;
