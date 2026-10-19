CREATE TABLE vane_audit(id TEXT PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL, detail TEXT NOT NULL);
CREATE INDEX vane_audit_at ON vane_audit(at);
-- Every native, review, OIDC, password or dev session is a sign-in, whichever door created it.
CREATE TRIGGER vane_audit_sign_in AFTER INSERT ON oa_sessions BEGIN
 INSERT INTO vane_audit(id,at,actor,action,subject,detail) VALUES(lower(hex(randomblob(16))),NEW.created_at,NEW.operator_id,'sign-in',NEW.operator_id,NEW.kind||' session');
END;
