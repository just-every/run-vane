-- An immutable import approval can resume by job ID only under its reviewed site policy.
-- Older approvals keep using the existing sanitized-document review door.
ALTER TABLE vane_import_approvals ADD COLUMN policy_version INTEGER;
ALTER TABLE vane_import_approvals ADD COLUMN policy_json TEXT;
