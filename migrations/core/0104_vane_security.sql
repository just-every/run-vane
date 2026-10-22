CREATE TABLE vane_security_policy (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 require_sso INTEGER NOT NULL DEFAULT 0 CHECK(require_sso IN (0,1)),
 require_second INTEGER NOT NULL DEFAULT 0 CHECK(require_second IN (0,1))
);
