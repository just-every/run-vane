-- Owner-issued SCIM authority is scoped to one exact federation issuer. Only a
-- digest is stored; replacement immediately invalidates the preceding bearer.
CREATE TABLE vane_scim_credentials (
 issuer TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 created_by TEXT NOT NULL REFERENCES oa_operators(id), created_at INTEGER NOT NULL,
 revoked_at INTEGER
);

-- An old association recorded no issuer, so it cannot authorize federation.
-- Keep it as an inaccessible tombstone rather than infer authority from email.
ALTER TABLE vane_scim_users RENAME TO vane_scim_users_legacy;
CREATE TABLE vane_scim_users (
 operator_id TEXT PRIMARY KEY REFERENCES oa_operators(id),
 issuer TEXT NOT NULL, external_id TEXT, created_at INTEGER NOT NULL,
 deactivated_at INTEGER, transition_id TEXT,
 UNIQUE(issuer,external_id)
);
INSERT INTO vane_scim_users(operator_id,issuer,external_id,created_at,deactivated_at)
 SELECT operator_id,'',external_id,created_at,created_at FROM vane_scim_users_legacy;
DROP TABLE vane_scim_users_legacy;

-- Native admission may establish ordinary accounts from a verified email. A
-- SCIM-managed person instead has exactly the binding the owner authorized.
CREATE TRIGGER vane_scim_fixed_federation BEFORE INSERT ON oa_external_identities
 WHEN EXISTS(SELECT 1 FROM vane_scim_users s WHERE s.operator_id=NEW.operator_id
 AND (s.issuer!=NEW.issuer OR s.external_id IS NOT NEW.subject))
 BEGIN SELECT RAISE(IGNORE); END;

-- Owner removal is durable even if an older provision request arrives later.
CREATE TRIGGER vane_scim_owner_removal AFTER UPDATE OF status ON oa_operators
 WHEN NEW.status='inactive' AND OLD.status!='inactive'
 BEGIN UPDATE vane_scim_users SET deactivated_at=COALESCE(deactivated_at,CAST(strftime('%s','now') AS INTEGER)*1000),
 transition_id=COALESCE(transition_id,lower(hex(randomblob(16)))) WHERE operator_id=NEW.id; END;
