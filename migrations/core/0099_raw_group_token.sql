-- A timestamp group can contain many distinct page loads. Cover its full IDs
-- so exact canonical visit neighbors do not scan and sort that whole bucket.
CREATE INDEX vane_raw_occurrences_group_token ON vane_raw_occurrences(group_id,token);
DROP INDEX vane_raw_occurrences_group;
