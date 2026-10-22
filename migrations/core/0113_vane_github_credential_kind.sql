-- Existing unclassified credentials require explicit least-privilege reconnection.
ALTER TABLE vane_instrumentation_github ADD COLUMN credential_kind TEXT NOT NULL DEFAULT '' CHECK(credential_kind IN ('','fine-grained','installation'));
