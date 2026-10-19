import type { AggregateRecord, ImportedDefinition } from './aggregate-types.ts';
import type { ImportSite, SitePolicy } from './types.ts';
import { MoveinError } from './types.ts';
import { keptValue, pathAllowed, storedPath } from '../paths';
import { csvRows } from './csv'
import { eventName } from '../properties';

// The Vane wrapper bundles unformatted, single-site, period=day JSON responses.
// Request format_metrics=0, flat=1, filter_limit=-1. Never export Live visitor logs.
// https://developer.matomo.org/api-reference/api
// https://developer.matomo.org/guides/reporting-api#module-goals
// https://github.com/matomo-org/matomo/blob/5.x-dev/plugins/Goals/API.php
// https://github.com/matomo-org/matomo/blob/5.x-dev/plugins/Goals/Goals.php
type RecordInput = Omit<AggregateRecord, 'id'>;
type Row = Record<string, unknown>;
const reports: Record<string, string | null> = {
  'VisitsSummary.get': null, 'Actions.get': null, 'Actions.getPageUrls': 'path',
  'Referrers.getWebsites': 'referrer', 'Referrers.getCampaigns': 'campaign',
  'UserCountry.getCountry': 'country', 'UserCountry.getRegion': 'region', 'UserCountry.getCity': 'city',
  'DevicesDetection.getType': 'device', 'DevicesDetection.getBrowsers': 'browser',
  'DevicesDetection.getOsFamilies': 'os', 'DevicesDetection.getOsVersions': 'os',
  'Goals.get': null, 'Goals.getItemsSku': 'sku', 'Goals.getItemsName': 'product',
  'Goals.getItemsCategory': 'category', 'Goals.getGoals': null,
};
const traffic = ['nb_visits','nb_uniq_visitors','nb_users','nb_actions','nb_visits_converted','bounce_count',
  'sum_visit_length','max_actions','nb_actions_per_visit','avg_time_on_site','bounce_rate','conversion_rate'];
const actions = ['nb_pageviews','nb_uniq_pageviews','nb_downloads','nb_uniq_downloads','nb_outlinks',
  'nb_uniq_outlinks','nb_searches','nb_keywords','hits'];
const pages = ['nb_hits','nb_visits','nb_uniq_visitors','sum_time_spent','avg_time_on_page','bounce_rate',
  'entry_nb_visits','entry_nb_uniq_visitors','entry_nb_actions','entry_sum_visit_length','entry_bounce_count',
  'exit_nb_visits','exit_nb_uniq_visitors','exit_rate','avg_time_generation','sum_time_generation','nb_hits_with_time_generation'];
const goals = ['nb_conversions','nb_visits_converted','conversion_rate','revenue','revenue_subtotal',
  'revenue_tax','revenue_shipping','revenue_discount','items','avg_order_revenue'];
const products = ['revenue','quantity','orders','abandoned_carts','avg_price','avg_quantity','nb_visits',
  'conversion_rate','nb_uniq_visitors','nb_hits'];
const fail = (code: string): never => { throw new MoveinError(`MATOMO_${code}`); };
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Row : fail('OBJECT_REQUIRED');
const label = (value: unknown) => keptValue(value) ?? '[redacted]';
function currency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) return fail('CURRENCY_REQUIRED');
  return value;
}
function allowedMetric(report: string, key: string): boolean {
  if (report === 'Goals.getGoals') return false;
  if (report === 'Goals.get') return goals.includes(key) || key === 'nb_visits' || /^goal_\d+_(nb_conversions|nb_visits_converted|conversion_rate|revenue)$/.test(key);
  if (report.startsWith('Goals.getItems')) return products.includes(key);
  if (report === 'Actions.get') return actions.includes(key);
  if (report === 'Actions.getPageUrls') return pages.includes(key);
  return traffic.includes(key) || goals.includes(key);
}
function metrics(report: string, row: Row): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(row)) {
    if (!allowedMetric(report, key)) continue;
    if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(raw))) fail('NUMERIC_METRIC_REQUIRED');
    const value = Number(raw);
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || (value < 0 && !key.includes('revenue'))) fail('INVALID_METRIC');
    if (/^(?:goal_\d+_)?(?:entry_|exit_)?nb_(?!actions_per_visit)/.test(key) && !Number.isSafeInteger(value)) fail('INVALID_COUNT');
    result[key] = value;
  }
  return result;
}
function path(value: unknown, site: ImportSite, policy: SitePolicy): string {
  if (typeof value !== 'string' || !value) return fail('PAGE_URL_REQUIRED');
  let raw = value;
  if (/^https?:\/\//i.test(raw)) {
    let url: URL; try { url = new URL(raw); } catch { return fail('INVALID_PAGE_URL'); }
    if (![site.origin, ...(policy.origins ?? [])].some(origin => new URL(origin).origin === url.origin)) return fail('FOREIGN_PAGE_URL');
    raw = url.pathname;
  }
  raw = raw.split(/[?#]/, 1)[0]!;
  if (!/^\/(?!\/)[^\s]*$/.test(raw)) return fail('FLAT_PAGE_URL_REQUIRED');
  return storedPath(policy, raw);
}
function dimension(key: string, value: unknown, site: ImportSite, policy: SitePolicy): string {
  if (key === 'path') return path(value, site, policy);
  if (key === 'referrer') {
    if (typeof value !== 'string') return fail('REFERRER_REQUIRED');
    let host: string; try { host = new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase(); } catch { return fail('INVALID_REFERRER'); }
    if (!/^(?:[a-z0-9-]+\.)+[a-z0-9-]{2,63}$/.test(host) || host.length > 253) return fail('INVALID_REFERRER');
    return host;
  }
  return label(value);
}
function validateDefinition(input: unknown, site: ImportSite, policy: SitePolicy): ImportedDefinition {
  const row = object(input), kind = row.kind;
  if (kind !== 'event' && kind !== 'pageview' && kind !== 'revenue') return fail('INVALID_DEFINITION');
  const result: ImportedDefinition = { name: eventName(row.name), kind, currency: currency(row.currency) };
  if (row.pattern !== undefined) {
    result.pattern = kind === 'pageview' ? path(row.pattern, site, policy) : eventName(row.pattern);
  }
  if (row.incomplete !== undefined) result.incomplete = label(row.incomplete);
  if (kind === 'pageview' && !result.pattern && !result.incomplete) return fail('DEFINITION_PATTERN_REQUIRED');
  return result;
}
function goalDefinitions(input: unknown, money: string, site: ImportSite, policy: SitePolicy): ImportedDefinition[] {
  if (input === undefined) return [];
  const entries = Array.isArray(input) ? input : Object.values(object(input));
  if (entries.length > 100) return fail('TOO_MANY_GOALS');
  return entries.map(value => {
    const goal = object(value), name = eventName(goal.name), attribute = goal.match_attribute;
    const definition: ImportedDefinition = { name, kind: attribute === 'url' ? 'pageview' : 'event', currency: money };
    // The display name and matched event name are separate source fields.
    if (attribute === 'event_name' && goal.pattern_type === 'exact') {
      definition.pattern = eventName(goal.pattern);
      if (goal.case_sensitive !== 1 && goal.case_sensitive !== '1') definition.incomplete = 'Review the source goal’s case-insensitive event-name match.';
      return definition;
    }
    if (attribute === 'url' && goal.pattern_type === 'exact' && typeof goal.pattern === 'string' && !/[?#*]/.test(goal.pattern)) {
      definition.pattern = path(goal.pattern, site, policy);
      if (goal.case_sensitive !== 1 && goal.case_sensitive !== '1') definition.incomplete = 'Review the source goal’s case-insensitive URL match.';
      return definition;
    }
    const attributes = ['url','title','file','external_website','manually','visit_duration','event_action','event_category','event_name'];
    if (typeof attribute !== 'string' || !attributes.includes(attribute)) return fail('UNSUPPORTED_GOAL_PREDICATE');
    const operator = typeof goal.pattern_type === 'string' && ['exact','contains','regex','greater_than'].includes(goal.pattern_type) ? goal.pattern_type : 'manual';
    definition.incomplete = `Source ${attribute} uses ${operator}; choose a native conversion condition.`;
    return definition;
  });
}
function validateRecord(input: unknown, site: ImportSite, policy: SitePolicy): RecordInput | null {
  const row = object(input), report = String(row.report);
  if (row.provider !== 'matomo' || !Object.hasOwn(reports, report) || typeof row.day !== 'string') return fail('INVALID_RECORD');
  const dimensions: Record<string, string> = {}, expected = reports[report];
  const supplied = object(row.dimensions);
  if (Object.keys(supplied).some(key => key !== expected && key !== 'currency') || (expected && !Object.hasOwn(supplied, expected))) return fail('INVALID_DIMENSIONS');
  if (expected) dimensions[expected] = dimension(expected, supplied[expected], site, policy);
  if (supplied.currency !== undefined) dimensions.currency = currency(supplied.currency);
  if (dimensions.path && !pathAllowed(policy, dimensions.path)) return null;
  const suppliedMetrics = object(row.metrics);
  if (Object.keys(suppliedMetrics).some(key => !allowedMetric(report, key))) return fail('UNKNOWN_METRIC');
  if (!Array.isArray(row.definitions) || row.definitions.length > 100) return fail('INVALID_DEFINITIONS');
  const values = metrics(report, suppliedMetrics);
  if (Object.keys(values).some(key => /revenue|price/.test(key)) && !dimensions.currency) return fail('CURRENCY_REQUIRED');
  if (!Object.keys(values).length && report !== 'Goals.getGoals') return fail('METRICS_REQUIRED');
  return { day: row.day, provider: 'matomo', report, dimensions, metrics: values,
    definitions: row.definitions.map(item => validateDefinition(item, site, policy)) };
}
function reportCsv(input:string,scalar:boolean):unknown {
 const [header,...data]=csvRows(input.replace(/^\uFEFF/,''));if(!header?.length||new Set(header).size!==header.length||data.some(row=>row.length!==header.length)||data.length>500)return fail('INVALID_CSV');
 const rows=data.map(cells=>Object.fromEntries(header.map((key,i)=>[key,cells[i]])));
 if(scalar&&rows.length!==1)return fail('SUMMARY_REQUIRES_ONE_ROW');return scalar?rows[0]:rows;
}
export function normalizeMatomo(input: unknown, site: ImportSite, policy: SitePolicy): RecordInput[] | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const wrapper = input as Row;
  if (wrapper.format === 'vane-matomo-normalized/1') {
    if (!Array.isArray(wrapper.records) || !wrapper.records.length || wrapper.records.length > 500) return fail('REQUIRES_1_TO_500_ROWS');
    return wrapper.records.map(row => validateRecord(row, site, policy)).filter((row): row is RecordInput => row !== null);
  }
  if (wrapper.format !== 'vane-matomo-reports/1') return null;
  if (typeof wrapper.day !== 'string') return fail('DAY_REQUIRED');
  const money = currency(wrapper.currency), source = object(wrapper.reports), result: RecordInput[] = [];
  if (Object.keys(source).length > 25) return fail('TOO_MANY_REPORTS');
  let count = 0;
  for (const [report, response] of Object.entries(source)) {
    if (!Object.hasOwn(reports, report) || report === 'Goals.getGoals') return fail('UNSUPPORTED_REPORT');
    const expected = reports[report];
    const content=typeof response==='string'?reportCsv(response,!expected):response;
    const rows = expected ? (Array.isArray(content) ? content : fail('REPORT_ARRAY_REQUIRED')) : [object(content)];
    for (const raw of rows) {
      if (++count > 500) return fail('REQUIRES_1_TO_500_ROWS');
      const row = object(raw);
      if (Object.keys(row).some(key => /^(?:idvisit|idvisitor|visitorId|visitIp|userId|actionDetails|subtable)$/i.test(key))) return fail('AGGREGATE_REPORT_REQUIRED');
      const dimensions: Record<string, string> = {};
      if (expected) dimensions[expected] = dimension(expected, expected === 'path' ? row.url ?? row.label : row.label, site, policy);
      if (dimensions.path && !pathAllowed(policy, dimensions.path)) continue;
      const values = metrics(report, row);
      if (!Object.keys(values).length) return fail('METRICS_REQUIRED');
      if (Object.keys(values).some(key => /revenue|price/.test(key))) dimensions.currency = money;
      result.push({ day: wrapper.day, provider: 'matomo', report, dimensions, metrics: values, definitions: [] });
    }
  }
  const definitions = goalDefinitions(wrapper.goals, money, site, policy);
  if (Object.keys(source).some(report => report.startsWith('Goals.getItems'))) definitions.push({ name: 'Purchase', kind: 'revenue', pattern: 'Purchase', currency: money });
  if (definitions.length > 100) return fail('TOO_MANY_GOALS');
  if (!result.length && definitions.length) result.push({ day: wrapper.day, provider: 'matomo', report: 'Goals.getGoals', dimensions: {}, metrics: {}, definitions: [] });
  if (!result.length) return fail('REQUIRES_1_TO_500_ROWS');
  result[0]!.definitions = definitions;
  return result;
}
