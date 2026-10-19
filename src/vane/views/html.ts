export const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

export const siteLink = (id: unknown, section = 'report') => `/app/sites/${encodeURIComponent(String(id))}?section=${encodeURIComponent(section)}`
export const hidden = (name: string, value: unknown) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`
export const operation = (name: string, siteId?: unknown) => hidden('operation', name) + (siteId === undefined ? '' : hidden('siteId', siteId))
export const canPrepare = (role: string) => role === 'owner' || role === 'admin'
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

export function breakdown(title: string, rows: {label: string; count: number; previous: number}[] = []): string {
  if (!rows.length) return panel(title, '<p class="vane-empty">No recorded activity in this period or the previous one.</p>')
  return panel(title, `<div class="vane-table-scroll" role="region" aria-label="${escape(title)}" tabindex="0"><table><caption class="vane-sr-only">${escape(title)}</caption><thead><tr><th scope="col">${escape(title === 'Goals' ? 'Goal' : title === 'Pages' ? 'Path' : title === 'Referring hostnames' ? 'Referring hostname' : 'Campaign')}</th><th scope="col" class="vane-number">${title === 'Goals' ? 'Conversions' : 'Pageviews'}</th><th scope="col" class="vane-number">Previous period</th><th scope="col" class="vane-number">Change</th></tr></thead><tbody>${rows.map(row => { const change = Number(row.count) - Number(row.previous); return `<tr><th scope="row">${escape(row.label)}</th><td class="vane-number">${count(row.count)}</td><td class="vane-number">${count(row.previous)}</td><td class="vane-number">${change > 0 ? '+' : ''}${count(change)}</td></tr>` }).join('')}</tbody></table></div>`)
}
