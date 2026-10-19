-- ALERT-001: each alert's recipients (people who can open its site, and whether the site's signed webhooks get it) and
-- its quiet hours, as local minutes in the site's time zone.
ALTER TABLE vane_alerts ADD COLUMN recipients_json TEXT NOT NULL DEFAULT '{"people":[],"webhooks":false}';
ALTER TABLE vane_alerts ADD COLUMN quiet_from INTEGER;
ALTER TABLE vane_alerts ADD COLUMN quiet_to INTEGER;
