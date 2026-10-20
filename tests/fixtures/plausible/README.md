# Plausible definition fixtures

These synthetic counts and names use the current upstream dashboard CSV layout:
- https://github.com/plausible/analytics/blob/master/test/plausible_web/controllers/CSVs/30d/conversions.csv
- https://github.com/plausible/analytics/blob/master/test/plausible_web/controllers/CSVs/30d/custom_props.csv

`dashboard.zip` contains those two CSV files, deflated at the top level. Conversion
CSV has no revenue columns. The fixture page supplies accepted live USD revenue;
the independent Stats v2 fixture supplies EUR money objects. The JSON listings
follow https://plausible.io/docs/sites-api and https://plausible.io/docs/stats-api.
No fixture contains a real account, key or visitor history.
