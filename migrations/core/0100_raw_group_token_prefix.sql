-- Keep every full token in the occurrence and its unique site/token index.
-- The journey index orders by a four-byte prefix; readers resolve every tie
-- using the full token, so even deliberately colliding prefixes stay exact.
CREATE INDEX vane_raw_occurrences_group_prefix ON vane_raw_occurrences(group_id,substr(token,1,4));
DROP INDEX vane_raw_occurrences_group_token;
