import { change, changeHead, count, escape, panel } from './html'
import { duration, filterCell, percent, revenueCells, revenueHead, type FilterLink } from './tables'
import { foldCities, FOLD_BELOW } from '../locations'
// DASH-005: the country, region and city tables. Each visit counts under its first page load's location, and every row
// shows the selected goal's conversions and conversion rate (CONV-004); a region names its country, a city its region.
const LEVELS = [['Countries', 'Country', 'countries', 'country'], ['Regions', 'Region', 'regions', 'region'], ['Cities', 'City', 'cities', 'city']] as const
function locationTable(title: string, column: string, rows: any[] = [], filter?: FilterLink): string {
  if (!rows.length) return panel(title, '<p class="vane-empty">No timed visits with a location in this period.</p>')
  const within = column !== 'Country'
  return panel(title, `<div class="vane-table-scroll" role="region" aria-label="${escape(title)}" tabindex="0"><table data-locations="${escape(title)}"><caption class="vane-sr-only">${escape(title)}</caption><thead><tr><th scope="col">${escape(column)}</th>${within ? '<th scope="col">In</th>' : ''}<th scope="col" class="vane-number">Visitors</th><th scope="col" class="vane-number">Visits</th><th scope="col" class="vane-number">Bounce rate</th><th scope="col" class="vane-number">Visit duration (median / average)</th><th scope="col" class="vane-number">Conversions</th><th scope="col" class="vane-number">Conversion rate</th>${revenueHead(rows)}${changeHead}</tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${row.label === 'Other cities' ? escape(row.label) : filterCell(row.label, filter)}</th>${within ? `<td>${escape([row.region, row.country].filter(Boolean).join(', '))}</td>` : ''}<td class="vane-number">${count(row.visitors)}</td><td class="vane-number">${count(row.visits)}</td><td class="vane-number">${percent(row.bounceRate)}</td><td class="vane-number">${duration(row.medianDuration)} / ${duration(row.averageDuration)}</td><td class="vane-number">${count(row.conversions)}</td><td class="vane-number">${percent(row.conversionRate)}</td>${revenueCells(row)}${change(row.visitors, row.previous)}</tr>`).join('')}</tbody></table></div>`)
}
// The signed-in report lists every city; each value filters the report by it (DASH-007).
export function locationTables(report: any, filter: (dimension: string) => FilterLink): string {
  return `<div class="vane-breakdowns">${LEVELS.map(([title, column, key, dimension]) => locationTable(title, column, report[key], filter(dimension))).join('')}</div>`
}
// Shared links, embeds and the public stats page (SHARE-001, SHARE-002) fold small cities into "Other cities" in their region.
export function publicLocationTables(report: any, bare: (rows: any[]) => any[]): string {
  return `${LEVELS.map(([title, column, key]) => locationTable(title, column, bare(key === 'cities' ? foldCities(report[key] ?? []) : report[key]))).join('')}<p class="vane-help">A city with fewer than ${FOLD_BELOW} unique visitors in this period is counted in its region’s “Other cities” row.</p>`
}
