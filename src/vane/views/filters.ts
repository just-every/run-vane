import { canAnalyze, escape, field, hidden, operation, panel } from './html'
import { DIMENSIONS, dimensionOf, FILTER_OPS } from '../segments'
import type { ViewData } from './types'

// DASH-007: the report's own query, so a filter link or form keeps the range, comparison and other choices.
export function reportQuery(report: any, filters: string[], segment: string | null = report?.segment?.id ?? null): URLSearchParams {
  const query = new URLSearchParams({ section: 'report' })
  if (report.period === 'custom') { query.set('from', report.from); query.set('to', report.to) } else query.set('period', report.period)
  if (report.compare && report.compare !== 'previous') query.set('compare', report.compare)
  if (report.compare === 'custom') { query.set('compareFrom', report.previousFrom); query.set('compareTo', report.previousTo) }
  if (report.weekdays) query.set('weekdays', 'on')
  for (const key of ['metric', 'group', 'goal']) if (report[key]) query.set(key, report[key])
  if (report.host) { query.set('hostOp', report.host.op); query.set('host', report.host.value) }
  if (segment) query.set('segment', segment)
  for (const filter of filters) query.append('filter', filter)
  return query
}
// A table's row value links to the report filtered by that value (is), added to the filters already applied.
export function filterBy(report: any, dimension: string): (label: string) => string | null {
  return label => {
    const value = dimension === 'page' || dimension === 'entry' ? label.slice(Math.max(0, label.indexOf('/'))) : label
    if (!value || (dimension === 'utm_campaign' && value === 'none') || ((dimension === 'page' || dimension === 'entry') && !value.startsWith('/'))) return null
    const filter = `${dimension}:is:${value}`
    return (report.filters ?? []).some((f: any) => `${f.dimension}:${f.op}:${f.value}` === filter) ? null : `?${reportQuery(report, [...(report.filterParams ?? []), filter])}#filters`
  }
}

export function filterPanel(data: ViewData, report: any): string {
  const active: any[] = report.filters ?? [], params: string[] = report.filterParams ?? [], saved = data.segments ?? []
  const carried = (filters: string[], segment: string | null) => [...reportQuery(report, filters, segment)].map(([key, value]) => hidden(key, value)).join('')
  const remove = (encoded: string) => `?${reportQuery(report, params.filter(p => p !== encoded))}#filters`
  const list = active.length ? `<ul class="vane-annotations" data-active-filters>${active.map(f => { const encoded = `${f.dimension}:${f.op}:${f.value}`; return `<li data-filter="${escape(encoded)}">${escape(f.text)}${params.includes(encoded) ? ` <a href="${escape(remove(encoded))}" aria-label="Remove the filter ${escape(f.text)}">Remove</a>` : ' (from the segment)'}</li>` }).join('')}</ul>` : '<p class="vane-empty">No filters: the report counts every visit.</p>'
  const add = `<form method="get" class="vane-filter" action="#filters">${carried(params, report.segment?.id ?? null)}<label>Dimension<select name="filterDimension" aria-label="Filter dimension">${Object.entries(DIMENSIONS).map(([key, d]) => `<option value="${key}">${escape(d.label)}</option>`).join('')}<option value="prop">Property (name below)</option></select></label>${field('Property name', 'filterKey', '', 'maxlength="40" placeholder="plan"')}<label>Comparison<select name="filterOp" aria-label="Filter comparison">${Object.entries(FILTER_OPS).map(([key, title]) => `<option value="${key}">${escape(title)}</option>`).join('')}</select></label>${field('Filter value', 'filterValue', '', 'required maxlength="200" placeholder="Organic Search or /blog/*"')}<button type="submit">Add filter</button></form>`
  const choose = saved.length ? `<form method="get" class="vane-filter" action="#filters">${carried(params, null).replace(/<input type="hidden" name="segment"[^>]*>/, '')}<label>Saved segment<select name="segment" aria-label="Saved segment"><option value="">None</option>${saved.map(s => `<option value="${escape(s.id)}"${report.segment?.id === s.id ? ' selected' : ''}>${escape(s.name)}</option>`).join('')}</select></label><button type="submit">Apply segment</button></form>` : ''
  const manage = data.site && canAnalyze(data.actor)
  const save = manage && active.length ? `<form action="/app/action" method="post" class="vane-filter">${operation('segment.save', data.site.id)}${hidden('filters', active.map(f => `${f.dimension}:${f.op}:${f.value}`).join('\n'))}${field('Segment name', 'name', report.segment?.name ?? '', 'required maxlength="60" placeholder="Organic mobile"')}<button>Save as segment</button></form>` : ''
  const segmentsList = saved.length ? `<ul class="vane-annotations" data-segments>${saved.map(s => `<li data-segment="${escape(s.name)}"><strong>${escape(s.name)}</strong>: ${escape(s.filters.map(f => `${dimensionOf(f.dimension)?.label ?? f.dimension} ${(FILTER_OPS as Record<string, string>)[f.op] ?? f.op} ${f.value}`).join('; '))}${manage ? `<form action="/app/action" method="post" class="vane-inline-form">${operation('segment.delete', data.site.id)}${hidden('id', s.id)}<button aria-label="Delete the segment ${escape(s.name)}">Delete</button></form>` : ''}</li>`).join('')}</ul>` : ''
  const help = '<p class="vane-help">A filter keeps whole visits. Channel, source, referring page, UTM, entry page and device filters judge each visit’s first page load; page, hostname, site-search and goal filters keep visits where any page load matches, or with is not and does not contain, where none does. Filters combine with AND. is and is not compare exactly (on pages with the goal wildcards * and **); contains ignores case; matches is a regular expression. Imported history and automatic events have no visit, so a filtered report leaves them out; coverage counts stay site-wide. Owners and administrators save segments for the team; everyone can apply them.</p>'
  return `<section class="vane-panel" id="filters"><h2>Filters and segments</h2>${report.segment ? `<p data-segment-applied>Segment: <strong>${escape(report.segment.name)}</strong>.</p>` : ''}${list}${add}${save}${choose}${segmentsList}${help}</section>`
}
