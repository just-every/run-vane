-- METRIC-006: the deepest scroll reached on a page load, a whole percentage from its engagement pings.
ALTER TABLE vane_events ADD COLUMN scroll INTEGER;
