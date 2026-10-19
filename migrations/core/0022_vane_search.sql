-- DASH-012: the site-search term of a page load, when the owner names a search parameter. An empty
-- string records a search whose term looked personal (an email address, phone number or long number) and was dropped.
ALTER TABLE vane_events ADD COLUMN search TEXT;
