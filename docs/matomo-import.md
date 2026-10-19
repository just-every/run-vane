# Move Matomo history into Vane

Open a site's **Data history**, then **Read Matomo history**. This works with
Matomo Cloud or a publicly reachable Matomo installation. Enter its HTTPS
Reporting API address (usually `https://analytics.example.com/index.php`),
numeric site ID, the source site's local date, its currency and a Reporting API
token with view access. Use a token you control; Vane uses it for that request
and never saves it or puts it in the preview, journal or archive.

Vane requests daily aggregate JSON reports through `API.getBulkRequest`, with
`format_metrics=0`, `flat=1` and `filter_limit=-1`. It reads visits and unique
visitors, actions and pages, referrers and campaigns, country/region/city,
device/browser/system, goals and ecommerce SKU reports. It never calls `Live`
or reads visitor logs. HTTP redirects, private endpoint addresses, source
errors, unsupported report types and responses larger than 2 MB are refused before
anything is applied. A request accepts up to 500 report rows; choose a smaller
source site/report export when more are needed.

Review the source report tables and definitions. **Apply import** approves that
exact sanitized fingerprint. A larger import may need **Apply import** again
to finish; repeating it resumes the same job without counting a row twice.
The journal downloads from the same page. **Undo import** removes the imported
rows; repeat while undo is in progress. Approved native goals are settings and
remain when history is undone.

Every aggregate table keeps its source measures and definition. Matomo's visits,
unique visitors, actions, goal conversions, source rates and currency remain
Matomo's. Independent breakdowns are never summed together and Vane never
fabricates visitor hashes or event rows from counts. Coverage is unknown.
Source reports appear alongside native totals in the selected date range;
merging source totals into native charts is the separate IMPORT-007 clause.

Goals show their source names and conditions. Prepare a supported exact URL or
case-sensitive event-name goal, then review it in **Approvals**. Approval makes
that native goal count future matching page loads or custom events. Revenue
goals match an event carrying revenue in the confirmed currency. Conditions
that cannot be represented exactly appear under **Needs completion**, with the
source predicate, for a person to complete. Nothing silently widens a source
condition or approves itself.

An offline report bundle may also be uploaded through **Import a document**:
`{"format":"vane-matomo-reports/1","day":"2026-10-01","currency":"USD","reports":{...},"goals":{...}}`.
Each `reports` key is the exact Matomo API method, containing its unformatted
JSON response; `goals` is the `Goals.getGoals` response. The repository fixture
`tests/fixtures/matomo-reports.json` shows this transport format. It is not a
Matomo visitor-log export.

Source schema: [Matomo Reporting API](https://developer.matomo.org/api-reference/api)
and [Goals module](https://developer.matomo.org/guides/reporting-api#module-goals).

For report CSV exports, use **Import Matomo report CSV**. Choose the exact
Reporting API method, local date and currency, and upload the unformatted flat
CSV. A summary report contains one data row; a breakdown contains one per
label. Repeat for each report. No column names are guessed or mapped to a
different source metric.
