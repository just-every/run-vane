-- Installation-local authenticator credentials. All timestamps are epoch milliseconds.
CREATE TABLE vane_totp_credentials (
 operator_id TEXT PRIMARY KEY REFERENCES oa_operators(id) ON DELETE CASCADE,
 secret_sealed TEXT NOT NULL,
 last_step INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE vane_totp_pending (
 operator_id TEXT PRIMARY KEY REFERENCES oa_operators(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL,
 secret_sealed TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE vane_totp_recovery (
 operator_id TEXT NOT NULL REFERENCES vane_totp_credentials(operator_id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL,
 PRIMARY KEY(operator_id,code_hash)
);
-- Keep only the current aligned window per operator/session, rather than one row per guess.
CREATE TABLE vane_second_step_attempts (
 scope TEXT NOT NULL CHECK(scope IN ('operator','session')),
 subject TEXT NOT NULL,
 window INTEGER NOT NULL,
 count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 5),
 PRIMARY KEY(scope,subject)
);
-- Deliberately no session FK: the native auth migrations may rebuild oa_sessions.
-- Admission must still join the current, unrevoked session and operator version.
CREATE TABLE vane_second_step_sessions (
 session_id TEXT PRIMARY KEY,
 operator_id TEXT NOT NULL REFERENCES oa_operators(id) ON DELETE CASCADE,
 verified_at INTEGER NOT NULL
);
