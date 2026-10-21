-- Historical rows have unknown transport; only newly admitted page loads are classified.
ALTER TABLE vane_events ADD COLUMN transport TEXT CHECK(transport IN ('direct','proxy'));
