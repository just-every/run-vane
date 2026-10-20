import { change, changeHead, count, escape, panel } from './html'
import { duration, filterCell, percent, revenueCells, revenueHead, type FilterLink } from './tables'
import { foldCities, foldMetros, FOLD_BELOW } from '../locations'
import { UNKNOWN_LOCATION, UNKNOWN_METRO, type Place } from '../metro-names'
import { metroLabel, ownerNamesNote, unnamedMetro } from './metro-names'
// DASH-005: the country, region and city tables. Each visit counts under its first page load's location, and every row
// shows the selected goal's conversions and conversion rate (CONV-004); a region names its country, a city its region.
// The US metro areas table keys on the metro code: a row shows the owner-approved name, or "Metro NNN (unnamed)" with
// the place most of its visitors were in (display only).
const LEVELS = [['Countries', 'Country', 'countries', 'country'], ['Regions', 'Region', 'regions', 'region'], ['Cities', 'City', 'cities', 'city'], ['US metro areas', 'Metro area', 'metros', 'metro']] as const
const UNLINKED = ['Other cities', 'Other metro areas', UNKNOWN_LOCATION, UNKNOWN_METRO]
type Cell = (row: any) => string
function locationTable(title: string, column: string, rows: any[] = [], cell: Cell, note = ''): string {
  if (!rows.length) return panel(title, '<p class="vane-empty">No timed visits with a location in this period.</p>')
  const within = column !== 'Country' && column !== 'Metro area'
  return panel(title, `<div class="vane-table-scroll" role="region" aria-label="${escape(title)}" tabindex="0"><table data-locations="${escape(title)}"><caption class="vane-sr-only">${escape(title)}</caption><thead><tr><th scope="col">${escape(column)}</th>${within ? '<th scope="col">In</th>' : ''}<th scope="col" class="vane-number">Visitors</th><th scope="col" class="vane-number">Visits</th><th scope="col" class="vane-number">Bounce rate</th><th scope="col" class="vane-number">Visit duration (median / average)</th><th scope="col" class="vane-number">Conversions</th><th scope="col" class="vane-number">Conversion rate</th>${revenueHead(rows)}${changeHead}</tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${cell(row)}</th>${within ? `<td>${escape([row.region, row.country].filter(Boolean).join(', '))}</td>` : ''}<td class="vane-number">${count(row.visitors)}</td><td class="vane-number">${count(row.visits)}</td><td class="vane-number">${percent(row.bounceRate)}</td><td class="vane-number">${duration(row.medianDuration)} / ${duration(row.averageDuration)}</td><td class="vane-number">${count(row.conversions)}</td><td class="vane-number">${percent(row.conversionRate)}</td>${revenueCells(row)}${change(row.visitors, row.previous)}</tr>`).join('')}</tbody></table></div>${note}`)
}
const plainCell = (filter?: FilterLink): Cell => row => UNLINKED.includes(row.label) ? escape(row.label) : filterCell(row.label, filter)
// The signed-in report lists every row; each value filters the report by it (DASH-007), a metro by its code. A footnote
// names the owner's table wherever its names show, and counts the codes in view that have no name.
export function locationTables(report: any, filter: (dimension: string) => FilterLink, siteId?: string): string {
  const metros: any[] = report.metros ?? [], byCode = filter('metro'), places: Record<string, Place> = report.metroPlaces ?? {}
  const metroCell: Cell = row => row.metro_code ? `${filterCell(row.label, () => byCode(row.metro_code))}${row.metro_name ? '' : metroLabel('', places[row.metro_code])}` : escape(row.label)
  const unnamed = metros.filter(r => r.metro_code && !r.metro_name).length
  const note = (metros.some(r => r.metro_name) ? ownerNamesNote(report.metroNames?.labels ?? []) : '') + (unnamed && siteId ? `<p class="vane-help" data-metro-unnamed>${count(unnamed)} metro code${unnamed === 1 ? '' : 's'} in this period ${unnamed === 1 ? 'has' : 'have'} no name. <a href="/app/sites/${encodeURIComponent(siteId)}?section=settings#metro-names">Name US metro areas in settings</a>.</p>` : '')
  return `<div class="vane-breakdowns">${LEVELS.map(([title, column, key, dimension]) => key === 'metros' ? locationTable(title, column, metros, metroCell, note) : locationTable(title, column, report[key], plainCell(filter(dimension)))).join('')}</div>`
}
// Shared links, embeds and the public stats page (SHARE-001, SHARE-002) fold small cities into "Other cities" in their
// region and small metros into "Other metro areas". Owner names show there only when the owner approved them for public
// pages; otherwise a code shows unnamed. An unnamed code's place names its city only when that city's own row is shown.
export function publicLocationTables(report: any, bare: (rows: any[]) => any[]): string {
  const cities = foldCities(report.cities ?? []), shown = new Set(cities.filter(r => r.label !== 'Other cities').map(r => JSON.stringify([r.label, r.region, r.country])))
  const names = report.metroNames?.public === true, places: Record<string, Place> = report.metroPlaces ?? {}
  const metros = bare(foldMetros((report.metros ?? []).map((r: any) => names || !r.metro_name ? r : { ...r, label: unnamedMetro(r.metro_code), metro_name: null })))
  const publicPlace = (place?: Place): Place | null => !place ? null : place.city && shown.has(JSON.stringify([place.city, place.region, 'United States'])) ? place : place.region ? { city: null, region: place.region } : null
  const metroCell: Cell = row => row.metro_code && !row.metro_name ? metroLabel(row.label, publicPlace(places[row.metro_code])) : escape(row.label)
  const note = names && metros.some((r: any) => r.metro_name) ? ownerNamesNote(report.metroNames?.labels ?? []) : ''
  return `${LEVELS.map(([title, column, key]) => key === 'metros' ? locationTable(title, column, metros, metroCell, note) : locationTable(title, column, bare(key === 'cities' ? cities : report[key]), plainCell())).join('')}<p class="vane-help">A city with fewer than ${FOLD_BELOW} unique visitors in this period is counted in its region’s “Other cities” row. US metro areas below the same threshold are counted in “Other metro areas”.</p>`
}
