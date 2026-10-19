-- CONV-007: the product lines of the standard ecommerce events (product view, add to cart, begin checkout, purchase),
-- each with the custom event it belongs to, its site and day; prices in the currency's minor units.
CREATE TABLE vane_ecommerce_lines(event_id TEXT NOT NULL, site_id TEXT NOT NULL, day TEXT NOT NULL, line INTEGER NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL, category TEXT, quantity INTEGER NOT NULL, price_minor INTEGER NOT NULL, currency TEXT NOT NULL, PRIMARY KEY(event_id,line));
CREATE INDEX vane_ecommerce_lines_site_day ON vane_ecommerce_lines(site_id,day);
