// The cell contains only already-declared native event dimensions. Identity is
// separate: counts can merge cells without multiplying visitors across them.
export const ANALYTIC_DIMENSIONS = [
 'path', 'source', 'campaign', 'hostname', 'device', 'browser', 'browser_version',
 'os', 'os_version', 'screen', 'channel', 'referrer', 'utm_source', 'utm_medium',
 'utm_term', 'utm_content', 'country', 'region', 'city', 'metro_code', 'search',
 'transport', 'consent', 'sample_rate', 'import_job',
] as const
export type AnalyticDimension = typeof ANALYTIC_DIMENSIONS[number]
export const cellSql = (prefix = '') => `json_array(${ANALYTIC_DIMENSIONS.map(name => prefix + name).join(',')})`
export const dimensionSql = (name: AnalyticDimension, prefix = '') => `json_extract(${prefix}cell,'$[${ANALYTIC_DIMENSIONS.indexOf(name)}]')`
export const identitySql = (prefix = '') => `CASE WHEN ${prefix}consented_visitor IS NOT NULL THEN ${prefix}site_id||' c '||${prefix}consented_visitor ELSE ${prefix}site_id||' d '||${prefix}day||' '||${prefix}visitor END`
