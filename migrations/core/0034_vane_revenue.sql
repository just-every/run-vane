-- CONV-006: a custom event's revenue, in millionths of the currency it was sent in (exact at its minor units).
ALTER TABLE vane_custom_events ADD COLUMN revenue_micros INTEGER;
ALTER TABLE vane_custom_events ADD COLUMN currency TEXT;
