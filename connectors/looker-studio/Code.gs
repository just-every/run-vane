// API-002: Vane's Looker Studio community connector. It reads the Stats API (API-001) with a site's read-only Stats API
// key, so each table shows the dashboard's figures for the report's date range. Deploy it from this folder with clasp
// (appsscript.json is its manifest), then add it in Looker Studio and enter the key, the installation's address and
// the site ID. A chart takes at most one dimension, as /api/v1/stats does.
var DIMENSIONS = { channel: 'Channel', source: 'Source', referrer: 'Referrer', utm_source: 'UTM source', utm_medium: 'UTM medium', utm_campaign: 'UTM campaign', utm_term: 'UTM term', utm_content: 'UTM content', device: 'Device', browser: 'Browser', os: 'Operating system', page: 'Page', entry_page: 'Entry page', exit_page: 'Exit page', hostname: 'Hostname' };
// Each metric's label, Looker Studio type, and its field on a breakdown row of /api/v1/stats.
var METRICS = { visitors: ['Visitors', 'NUMBER', 'visitors'], visits: ['Visits', 'NUMBER', 'visits'], pageviews: ['Pageviews', 'NUMBER', 'pageviews'], bounce_rate: ['Bounce rate', 'PERCENT', 'bounceRate'], visit_duration: ['Visit duration', 'DURATION', 'averageDuration'], conversion_rate: ['Conversion rate', 'PERCENT', 'conversionRate'] };
var KEY = 'vane.statsKey';

function properties() { return PropertiesService.getUserProperties(); }
function getAuthType() { return { type: 'KEY', helpUrl: 'https://github.com/just-every/run-vane#looker-studio' }; }
function setCredentials(request) {
  var key = String(request.key || '');
  if (!/^vane_k_[0-9a-f]{64}$/.test(key)) return { errorCode: 'INVALID_CREDENTIALS' };
  properties().setProperty(KEY, key);
  return { errorCode: 'NONE' };
}
function isAuthValid() { return /^vane_k_[0-9a-f]{64}$/.test(properties().getProperty(KEY) || ''); }
function resetAuth() { properties().deleteProperty(KEY); }
function isAdminUser() { return false; }

function getConfig() {
  return {
    configParams: [
      { type: 'INFO', name: 'about', text: 'Create a Stats API key for the site in Vane (Settings, API keys) and enter it when Looker Studio asks.' },
      { type: 'TEXTINPUT', name: 'origin', displayName: 'Vane address', helpText: 'The installation, such as https://analytics.example.com' },
      { type: 'TEXTINPUT', name: 'site_id', displayName: 'Site ID', helpText: 'From the site’s settings in Vane' }
    ],
    dateRangeRequired: true
  };
}
function fields() {
  var list = [];
  Object.keys(DIMENSIONS).forEach(function (name) { list.push({ name: name, label: DIMENSIONS[name], dataType: 'STRING', semantics: { conceptType: 'DIMENSION' } }); });
  Object.keys(METRICS).forEach(function (name) { list.push({ name: name, label: METRICS[name][0], dataType: 'NUMBER', semantics: { conceptType: 'METRIC', semanticType: METRICS[name][1], isReaggregatable: false } }); });
  return list;
}
function getSchema() { return { schema: fields() }; }

// Looker Studio's range is inclusive; /api/v1/stats takes `to` as the day after, in the site's time zone.
function dayAfter(day) { var d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
function value(name, number) { return METRICS[name][1] === 'PERCENT' && number !== null ? number / 100 : number; }
function getData(request) {
  var names = request.fields.map(function (f) { return f.name; });
  var dimension = names.filter(function (n) { return DIMENSIONS[n]; });
  if (dimension.length > 1) throw new Error('Vane answers one dimension per chart.');
  var metrics = names.filter(function (n) { return METRICS[n]; });
  var origin = String(request.configParams.origin || '').replace(/\/+$/, '');
  var query = ['site_id=' + encodeURIComponent(request.configParams.site_id), 'from=' + request.dateRange.startDate, 'to=' + dayAfter(request.dateRange.endDate), 'metrics=' + (metrics.length ? metrics : ['visitors']).join(',')];
  if (dimension.length) query.push('dimension=' + dimension[0]);
  var response = UrlFetchApp.fetch(origin + '/api/v1/stats?' + query.join('&'), { headers: { Authorization: 'Bearer ' + properties().getProperty(KEY) }, muteHttpExceptions: true });
  var body = JSON.parse(response.getContentText());
  if (response.getResponseCode() !== 200) throw new Error('Vane refused the request: ' + (body.message || body.error));
  var rows = dimension.length
    ? body.breakdown.map(function (row) { return names.map(function (n) { return n === dimension[0] ? row.value : value(n, row[METRICS[n][2]] === undefined ? null : row[METRICS[n][2]]); }); })
    : [names.map(function (n) { return value(n, body.results[n]); })];
  var schema = fields().filter(function (f) { return names.indexOf(f.name) >= 0; }).sort(function (a, b) { return names.indexOf(a.name) - names.indexOf(b.name); });
  return { schema: schema, rows: rows.map(function (values) { return { values: values }; }) };
}
