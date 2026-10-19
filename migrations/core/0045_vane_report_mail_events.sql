-- REPORT-001: the mail provider's signed delivery events (Base's D1 event store: receipts and per-recipient state),
-- each report send's provider message ID and the newest provider-reported state, and the addresses that get no
-- further report email after a permanent bounce, a spam complaint or a provider suppression.
CREATE TABLE IF NOT EXISTS rer_mail_event_receipts (
  provider TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  event_namespace TEXT NOT NULL,
  event_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  event_json TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  conflict INTEGER NOT NULL DEFAULT 0 CONSTRAINT rer_mail_event_identity_conflict CHECK (conflict = 0),
  PRIMARY KEY (provider, tenant_id, event_namespace, event_id)
);
CREATE TABLE IF NOT EXISTS rer_mail_event_states (
  provider TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  event_namespace TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  terminal INTEGER NOT NULL CHECK (terminal IN (0, 1)),
  PRIMARY KEY (provider, tenant_id, event_namespace, provider_message_id, recipient)
);
ALTER TABLE vane_report_sends ADD COLUMN provider_message_id TEXT;
ALTER TABLE vane_report_sends ADD COLUMN provider_status TEXT;
ALTER TABLE vane_report_sends ADD COLUMN provider_at INTEGER;
CREATE INDEX vane_report_sends_message ON vane_report_sends(provider_message_id);
CREATE TABLE vane_mail_stops(email TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('bounced','complained','rejected')), occurred_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
