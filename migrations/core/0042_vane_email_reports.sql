-- REPORT-001: email report subscriptions (a team member's own address, or an external recipient the owner adds) and
-- each scheduled send. A send's id is its delivery ID on every attempt; only the SHA-256 of a subscription's
-- unsubscribe token is kept.
CREATE TABLE vane_report_subscriptions(id TEXT PRIMARY KEY, site_id TEXT NOT NULL, segment_id TEXT, email TEXT NOT NULL, operator_id TEXT, frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekly','monthly')), weekday INTEGER NOT NULL, hour INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, next_at INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(site_id,email,frequency));
CREATE TABLE vane_report_sends(id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, site_id TEXT NOT NULL, email TEXT NOT NULL, period_from TEXT NOT NULL, period_to TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','sent','failed')), attempts INTEGER NOT NULL, next_at INTEGER NOT NULL, reason TEXT, created_at INTEGER NOT NULL, sent_at INTEGER);
CREATE INDEX vane_report_due ON vane_report_sends(state,next_at);
