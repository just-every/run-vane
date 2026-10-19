-- PERF-001: a page load's Core Web Vitals and load time, as the script last reported them: largest contentful paint,
-- interaction to next paint and load time in milliseconds, cumulative layout shift as a unitless score.
ALTER TABLE vane_events ADD COLUMN lcp INTEGER;
ALTER TABLE vane_events ADD COLUMN inp INTEGER;
ALTER TABLE vane_events ADD COLUMN cls REAL;
ALTER TABLE vane_events ADD COLUMN load_ms INTEGER;
