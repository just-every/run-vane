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
/** The range from a first day to an exclusive end, as people read it: "Oct 13 to 19" or "Sep 28 to Oct 4". */
export function rangeText(from: string, to: string): string {
  const last = new Date(calendar(to).getTime() - 86400000).toISOString().slice(0, 10)
  if (last <= from) return monthDay(from)
  return from.slice(0, 7) === last.slice(0, 7) ? `${monthDay(from)} to ${Number(last.slice(8, 10))}` : `${monthDay(from)} to ${monthDay(last)}`
}
