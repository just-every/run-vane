export const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

export const siteLink = (id: unknown, section = 'report') => `/app/sites/${encodeURIComponent(String(id))}?section=${encodeURIComponent(section)}`
export const hidden = (name: string, value: unknown) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`
export const operation = (name: string, siteId?: unknown) => hidden('operation', name) + (siteId === undefined ? '' : hidden('siteId', siteId))
export const canPrepare = (role: string) => role === 'owner' || role === 'admin'
// TEAM-001: an analyst also saves segments, previews no-code events and proposes goal, funnel and event changes.
export const canAnalyze = (actor: { role: string; access?: string }) => canPrepare(actor.role) || actor.access === 'analyst'
export const count = (value: unknown) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : '0'

export function date(value: unknown): string {
  if (!value) return '—'
  const parsed = new Date(typeof value === 'number' ? value : String(value))
  return Number.isNaN(parsed.getTime()) ? escape(value) : escape(parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }))
}

export function panel(title: string, content: string, description = ''): string {
  return `<section class="vane-panel"><h2>${escape(title)}</h2>${description ? `<p>${escape(description)}</p>` : ''}${content}</section>`
}

export function field(label: string, name: string, value: unknown = '', options = ''): string {
  return `<label>${escape(label)}<input name="${escape(name)}" value="${escape(value)}" ${options}></label>`
}

export function textarea(label: string, name: string, value: unknown, help: string): string {
  return `<label>${escape(label)}<textarea name="${escape(name)}" aria-label="${escape(label)}" rows="4" aria-describedby="${escape(name)}-help">${escape(value)}</textarea><span class="vane-help" id="${escape(name)}-help">${escape(help)}</span></label>`
}

// DASH-008: a row's change against the compared period, absolute and in percent (none when it had nothing then).
export function changeText(current: unknown, previous: unknown): string {
  const now = Number(current) || 0, then = Number(previous) || 0, difference = now - then
  const percent = then ? `${difference > 0 ? '+' : ''}${((difference / then) * 100).toFixed(1)}%` : now ? 'new' : 'no change'
  return `${difference > 0 ? '+' : ''}${count(difference)} (${percent})`
}
export const change = (current: unknown, previous: unknown) => `<td class="vane-number" data-change="${(Number(current) || 0) - (Number(previous) || 0)}">${changeText(current, previous)}</td>`
// CONV-007/CONV-006: an amount in the currency it was recorded in, never converted here.
export const money = (amount: unknown, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount) || 0)
export const changeHead = '<th scope="col" class="vane-number">Change</th>'

export function breakdown(title: string, rows: {label: string; count: number; previous: number}[] = [], filter?: (label: string) => string | null): string {
  if (!rows.length) return panel(title, '<p class="vane-empty">No recorded activity in this period or the compared one.</p>')
  return panel(title, `<div class="vane-table-scroll" role="region" aria-label="${escape(title)}" tabindex="0"><table><caption class="vane-sr-only">${escape(title)}</caption><thead><tr><th scope="col">${escape(title === 'Goals' ? 'Goal' : title === 'Pages' ? 'Path' : title === 'Sources' ? 'Source' : 'Campaign')}</th><th scope="col" class="vane-number">${title === 'Goals' ? 'Conversions' : 'Pageviews'}</th><th scope="col" class="vane-number">Compared period</th>${changeHead}</tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${(href => href ? `<a href="${escape(href)}" data-filter-link>${escape(row.label)}</a>` : escape(row.label))(filter?.(row.label))}</th><td class="vane-number">${count(row.count)}</td><td class="vane-number">${count(row.previous)}</td>${change(row.count, row.previous)}</tr>`).join('')}</tbody></table></div>`)
}

// Display dates for the app shell: "Wed, Oct 14" and "Oct 13 to 19" from ISO days (UTC calendar days).
const calendar = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`)
export const shortDay = (iso: string) => calendar(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
export const monthDay = (iso: string) => calendar(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
// S1: Vane's own text names US dates and never a range's exclusive end: "Oct 14, 2026", "Oct 13 – 19, 2026".
export const usDay = (iso: string) => calendar(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
export function usRange(from: string, to: string, year = true): string {
  const last = new Date(calendar(to).getTime() - 86400000).toISOString().slice(0, 10)
  if (last <= from) return year ? usDay(from) : monthDay(from)
  if (from.slice(0, 4) !== last.slice(0, 4)) return year ? `${usDay(from)} – ${usDay(last)}` : `${monthDay(from)} – ${monthDay(last)}`
  const tail = year ? `, ${last.slice(0, 4)}` : ''
  return from.slice(0, 7) === last.slice(0, 7) ? `${monthDay(from)} – ${Number(last.slice(8, 10))}${tail}` : `${monthDay(from)} – ${monthDay(last)}${tail}`
}
/** The range control's short form: "Oct 13 – 19" or "Sep 28 – Oct 4". */
export const rangeText = (from: string, to: string) => usRange(from, to, false)
/** An instant in UTC as people read it: "Oct 19, 2026, 3:48 PM". */
export const whenUtc = (at: number) => new Date(at).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
export const zoneName = (timeZone: string) => new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longGeneric' }).formatToParts(0).find(part => part.type === 'timeZoneName')?.value ?? timeZone
export const timeOfDay = (at: number, timeZone: string) => new Date(at).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
/** An hour bucket's local hour in US time: "12 AM", "9 AM" or "4 PM". */
export const hourText = (label: string) => { const hour = Number(label.slice(11, 13)); return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}` }
// A chart bucket as people read it: "Tue, Oct 13", "Oct 19, 9 AM CDT", "Week of Oct 12" or "Oct 2026".
export function bucketText(interval: string, label: string): string {
  if (interval === 'day') return shortDay(label)
  if (interval === 'hour') return `${monthDay(label.slice(0, 10))}, ${hourText(label)}${label.slice(16)}`
  if (interval === 'week') return `Week of ${monthDay(label.slice(8))}`
  return calendar(`${label}-01`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export const cutoverField='<label>Cut-over date (optional)<input type="date" name="cutover"></label><p class="vane-help">Import dates before this date. Any day with live collection uses live data alone. Leave blank to review a cut-over immediately after the final source day.</p><label><input type="checkbox" name="preferNew"> Use this source instead on days held by earlier imports</label><p class="vane-help">Only the owner applies this reviewed choice. Earlier imports remain available for undo.</p>'
