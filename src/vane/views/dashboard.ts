import { canPrepare, count, escape, field, money, rangeText, siteLink } from './html'
import { definition, decimal, duration, filterCell, percent, tile, type FilterLink } from './tables'
import { filterBy, reportQuery } from './filters'
import { icon, type IconName } from './icons'
import { COMPARISONS, INTERVALS, PERIODS } from '../periods'
import { METRICS } from '../series'
import type { ViewData } from './types'
// The Overview's own pieces: the top bar, the metric cards that pick the chart's metric, and the four short tables.

const choice = (label: string, name: string, value: string, options: Record<string, string>) => `<label>${escape(label)}<select name="${escape(name)}" aria-label="${escape(label)}">${Object.entries(options).map(([key, title]) => `<option value="${escape(key)}"${key === value ? ' selected' : ''}>${escape(title)}</option>`).join('')}</select></label>`
const quiet = (label: string, name: string, value: string, options: Record<string, string>, extra = '') => `<label class="vane-bar-select">${extra}<span class="vane-sr-only">${escape(label)}</span><select name="${escape(name)}" aria-label="${escape(label)}">${Object.entries(options).map(([key, title]) => `<option value="${escape(key)}"${key === value ? ' selected' : ''}>${escape(title)}</option>`).join('')}</select></label>`

// The range, comparison and chart options in one GET form; the less used ones fold under More options.
export function rangeBar(data: ViewData, report: any): string {
  const goals = [...Object.keys(data.site?.config?.goals ?? {}), ...Object.keys(data.site?.config?.scrollGoals ?? {})]
  const more = `<details class="vane-more"><summary>More options</summary><div class="vane-more-body">${field('From', 'from', report?.period === 'custom' ? report.from : '', 'type="date"')}${field('Until (exclusive)', 'to', report?.period === 'custom' ? report.to : '', 'type="date" aria-describedby="range-help"')}<span class="vane-help" id="range-help">Filled dates make a custom range; leave them empty to use the chosen range. Days start at midnight in the site’s time zone.</span>${field('Compared from', 'compareFrom', report?.compare === 'custom' ? report.previousFrom : '', 'type="date"')}${field('Compared until (exclusive)', 'compareTo', report?.compare === 'custom' ? report.previousTo : '', 'type="date"')}<label class="vane-check"><input type="checkbox" name="weekdays" value="on"${report?.weekdays ? ' checked' : ''}> Match weekdays</label>${data.rollup ? `<label class="vane-check"><input type="checkbox" name="split" value="site"${report?.rollup?.split ? ' checked' : ''}> Split by site</label>` : ''}${choice('Chart by', 'interval', report?.interval ?? '', { '': 'Automatic', ...INTERVALS })}${choice('Chart metric', 'metric', report?.metric ?? 'visitors', METRICS)}${field('Group pages', 'group', report?.group, 'placeholder="/blog/*" aria-describedby="group-help"')}<span class="vane-help" id="group-help">Optional: path prefixes such as /blog/*, or a rename such as /blog/*=/articles, separated by commas.</span><label>Hostname<select name="hostOp" aria-label="Hostname filter">${[['is', 'is'], ['is_not', 'is not'], ['contains', 'contains'], ['matches', 'matches']].map(([value, title]) => `<option value="${value}"${report?.host?.op === value ? ' selected' : ''}>${title}</option>`).join('')}</select></label>${field('Hostname value', 'host', report?.host?.value ?? '', 'placeholder="blog.example.com or *.example.com"')}<label>Conversion goal<select name="goal" aria-label="Conversion goal"><option value="">Any goal</option>${goals.map(name => `<option value="${escape(name)}"${report?.goal === name ? ' selected' : ''}>${escape(name)}</option>`).join('')}</select></label></div></details>`
  const dates = report ? `<span class="vane-range-dates">${escape(rangeText(report.from, report.to))}</span>` : ''
  const form = `<form method="get" class="vane-range" aria-label="Reporting period"><input type="hidden" name="section" value="report"><div class="vane-range-pick">${quiet('Range', 'period', report?.period ?? '7d', { ...PERIODS, custom: 'Custom (From and Until)' }, icon('calendar'))}${dates}</div>${quiet('Compare with', 'compare', report?.compare ?? 'previous', COMPARISONS)}${more}<button type="submit" class="vane-secondary">Update report</button></form>`
  // DASH-007: each active filter as a chip that removes it; the full filter panel opens from Filter.
  const params: string[] = report?.filterParams ?? []
  const chips = (report?.filters ?? []).map((f: any) => { const encoded = `${f.dimension}:${f.op}:${f.value}`; return params.includes(encoded) ? `<a class="vane-chip" href="${escape(`?${reportQuery(report, params.filter(p => p !== encoded))}`)}">${escape(f.text)}<span aria-hidden="true">×</span><span class="vane-sr-only"> (remove)</span></a>` : `<span class="vane-chip">${escape(f.text)}</span>` }).join('') + (report?.segment ? `<span class="vane-chip">Segment: ${escape(report.segment.name)}</span>` : '')
  const share = data.site && !data.rollup && canPrepare(data.actor.role) ? `<a class="vane-button vane-secondary vane-share" href="${siteLink(data.site.id, 'settings')}#share">${icon('share')}Share</a>` : ''
  return `<div class="vane-topbar">${form}${report ? `<div class="vane-chips">${chips}<a class="vane-button vane-secondary" href="#filters">${icon('filter')}Filter${params.length ? ` <span class="vane-count">${params.length}</span>` : ''}</a></div>` : ''}${share}</div>`
}

const against: Record<string, string> = { previous: 'the previous period', year: 'the same period last year', custom: 'the custom period' }
// While the range holds today, every total and its compared period count to the same time (DASH-008, like with like).
const sameTime = (report: any) => report.running ? ' to the same time' : ''
export function comparison(current: number, previous: number, mode = 'previous', soFar = ''): string {
  if (!previous) return current ? `No activity in ${against[mode]}${soFar}.` : 'No activity in either period.'
  const change = ((current - previous) / previous) * 100
  return `<span class="vane-change">${change > 0 ? '+' : ''}${change.toFixed(1)}%</span> compared with ${against[mode]} (${count(previous)})${soFar}.`
}
const trend = (now: number, then: number, lowerIsBetter = false) => !then || now === then ? 'is-flat' : (now > then) !== lowerIsBetter ? 'is-good' : 'is-bad'
const arrow = (now: number, then: number) => !then || now === then ? '' : now > then ? ' is-up' : ' is-down'

// One metric card: its figure, change and definition; the whole card picks the chart's metric.
function card(report: any, metric: string, iconName: IconName, title: string, value: string, help: string, delta: string, extra = ''): string {
  const selected = report.metric === metric
  const href = `?${(query => { query.set('metric', metric); return query })(reportQuery(report, report.filterParams ?? []))}`
  return `<section class="vane-panel vane-kpi${selected ? ' is-selected' : ''}">${icon(iconName, 'vane-kpi-icon')}<h2>${escape(title)}</h2><p class="vane-metric">${escape(value)}</p><p class="vane-help">${help}</p>${delta}${extra}<a class="vane-kpi-link" href="${escape(href)}"${selected ? ' aria-current="true"' : ''}><span class="vane-sr-only">Chart ${escape(title.toLowerCase())}</span></a></section>`
}
const delta = (now: number, then: number, text: string, lowerIsBetter = false) => `<p class="vane-delta ${trend(now, then, lowerIsBetter)}${arrow(now, then)}">${text}</p>`

export function metricCards(report: any, summed: string): string {
  const visitors = Number(report.visitors) || 0, visits = Number(report.visits) || 0, goals = Number(report.goals) || 0
  const before = { visitors: Number(report.previousVisitors) || 0, visits: Number(report.previousVisits) || 0, goals: Number(report.previousGoals) || 0 }
  const bounce = report.bounceRate === null || report.bounceRate === undefined ? null : Number(report.bounceRate), bounceThen = report.previousBounceRate === null || report.previousBounceRate === undefined ? null : Number(report.previousBounceRate)
  const points = bounce === null || bounceThen === null ? `<p class="vane-delta is-flat">${bounceThen === null ? `No visits in ${against[report.compare]}.` : 'No visits in this period.'}</p>` : delta(bounce, bounceThen, `<span class="vane-change">${bounce - bounceThen > 0 ? '+' : bounce < bounceThen ? '−' : ''}${Math.abs(bounce - bounceThen).toFixed(1)} pts</span> compared with ${against[report.compare]} (${percent(bounceThen)})${sameTime(report)}.`, true)
  const median = Number(report.medianDuration) || 0, medianThen = Number(report.previousMedianDuration) || 0
  const lasted = medianThen ? delta(median, medianThen, `<span class="vane-change">${median > medianThen ? '+' : ''}${(((median - medianThen) / medianThen) * 100).toFixed(1)}%</span> compared with ${against[report.compare]} (${duration(medianThen)})${sameTime(report)}.`) : `<p class="vane-delta is-flat">No timed visits in ${against[report.compare]}.</p>`
  const revenue = Number(report.revenue?.total) || 0
  return `<div class="vane-metrics">${card(report, 'visitors', 'visitors', `Unique visitors${summed}`, count(visitors), `Distinct daily visitor hashes, summed over the days in the range.${definition('unique-visitors')}`, delta(visitors, before.visitors, comparison(visitors, before.visitors, report.compare, sameTime(report))))}${card(report, 'visits', 'visits', `Visits${summed}`, count(visits), `Runs of one visitor hash’s page loads with no gap over ${report.visitTimeout === null ? 'each site’s visit timeout' : `${escape(report.visitTimeout)} minutes`}.${definition('visits')}`, delta(visits, before.visits, comparison(visits, before.visits, report.compare, sameTime(report))))}${card(report, 'bounceRate', 'percent', 'Bounce rate', percent(report.bounceRate), `Visits with one page load and no engagement ping.${definition('bounce-rate')}`, points)}${card(report, 'duration', 'clock', 'Visit duration', duration(report.medianDuration), `Median; average ${duration(report.averageDuration)}. From the first page load to the last engagement signal.${definition('visit-duration')}`, lasted)}${card(report, 'conversions', 'goals', 'Goal conversions', count(goals), `Converting visitors: ${count(report.converters)} (${percent(report.conversionRate)} of unique visitors).${definition('conversions')}`, delta(goals, before.goals, comparison(goals, before.goals, report.compare, sameTime(report))), revenue ? `<p class="vane-kpi-extra" data-revenue-total>${escape(money(revenue, report.revenue.currency))} revenue</p>` : '')}</div>`
}

// Pageviews and pages per visit, the chart's companions; each still picks its metric where it has one.
export function moreMetrics(report: any): string {
  const pageviews = Number(report.pageviews) || 0
  return `<div class="vane-metrics-more"><section class="vane-panel"><h2>Pageviews</h2><p class="vane-metric">${count(pageviews)}</p><p>${comparison(pageviews, Number(report.previousPageviews) || 0, report.compare, sameTime(report))}</p><p class="vane-help">Accepted page loads.${definition('pageviews')}</p></section>${tile('Pages per visit', decimal(report.pagesPerVisit), `Views per visitor: ${decimal(report.viewsPerVisitor)}.`, 'pages-per-visit')}</div>`
}

// A short table of the top five rows with thin bars; the full table is further down the page.
interface Short { label: string; visitors: number; second: string; flag?: string }
const tones = 5, toneOf = (label: string) => [...label].reduce((n, c) => n + c.charCodeAt(0), 0) % tones
const bar = (share: number) => `<svg class="vane-bar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect class="vane-bar-track" width="100" height="4" rx="2"/><rect class="vane-bar-fill" width="${Math.max(1, Math.round(share * 100))}" height="4" rx="2"/></svg>`
function shortTable(title: string, column: string, secondHead: [string, string], rows: Short[], filter: FilterLink | undefined, more: { href: string; text: string }, avatars = false): string {
  const id = `top-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`, max = Math.max(1, ...rows.map(r => r.visitors))
  const [first, second] = secondHead
  const body = rows.length ? `<table class="vane-short"><caption class="vane-sr-only">${escape(title)}, top ${rows.length}</caption><thead><tr><th scope="col">${escape(column)}</th><th scope="col" class="vane-number">Visitors<span class="vane-short-sub">${escape(first)}</span></th></tr></thead><tbody>${rows.map(row => `<tr${row.flag ? ' data-flagged' : ''}><th scope="row"><span class="vane-short-label">${avatars ? `<span class="vane-avatar vane-tone-${toneOf(row.label)}" aria-hidden="true">${escape(Array.from(row.label.replace(/^www\./, ''))[0]?.toUpperCase() ?? '?')}</span>` : ''}<span class="vane-short-name" title="${escape(row.label)}">${filterCell(row.label, filter)}</span>${row.flag ? `<span class="vane-flag" title="${escape(row.flag)}">!<span class="vane-sr-only"> ${escape(row.flag)}</span></span>` : ''}</span>${bar(row.visitors / max)}</th><td class="vane-number">${count(row.visitors)}<span class="vane-short-sub"><span class="vane-sr-only">${escape(second)} </span>${escape(row.second)}</span></td></tr>`).join('')}</tbody></table>` : '<p class="vane-empty">No visits with this detail in this period.</p>'
  return `<section class="vane-panel vane-short-card" aria-labelledby="${id}"><h2 id="${id}" class="vane-short-title">${escape(title)}</h2>${body}<a class="vane-more-link" href="${escape(more.href)}">${escape(more.text)}${icon('arrow')}</a></section>`
}

export function shortTables(report: any, group: (name: string) => string): string {
  // REPORT-003: the page among the largest movers that fell furthest carries a flag.
  const falling = (report.explain?.movers ?? []).filter((m: any) => m.dimension === 'Page' && m.now < m.then).sort((a: any, b: any) => (a.now - a.then) - (b.now - b.then))[0]
  const fell = new Map<string, string>(falling ? [[falling.label, `Pageviews down ${Math.round(((falling.then - falling.now) / falling.then) * 100)}% against the compared period`]] : [])
  const rate = (row: any) => percent(row.conversionRate)
  const pages: Short[] = (report.topPages ?? []).slice(0, 5).map((r: any) => ({ label: r.path, visitors: Number(r.visitors), second: rate(r), flag: fell.get(r.path) }))
  const sources: Short[] = (report.sourceVisits ?? []).slice(0, 5).map((r: any) => ({ label: r.label, visitors: Number(r.visitors), second: rate(r) }))
  const channels: Short[] = (report.channels ?? []).slice(0, 5).map((r: any) => ({ label: r.label, visitors: Number(r.visitors), second: rate(r) }))
  const browserTotal = (report.browsers ?? []).reduce((n: number, r: any) => n + Number(r.visitors), 0)
  const browsers: Short[] = (report.browsers ?? []).slice(0, 5).map((r: any) => ({ label: String(r.label).trim(), visitors: Number(r.visitors), second: browserTotal ? `${((Number(r.visitors) / browserTotal) * 100).toFixed(0)}%` : '—' }))
  return `<div class="vane-shorts">${shortTable('Top pages', 'Page', ['Conv. rate', 'conversion rate'], pages, report.group ? undefined : filterBy(report, 'page'), { href: group('pages'), text: 'View all pages' })}${shortTable('Sources', 'Source', ['Conv. rate', 'conversion rate'], sources, filterBy(report, 'source'), { href: group('sources'), text: 'View all sources' }, true)}${shortTable('Channels', 'Channel', ['Conv. rate', 'conversion rate'], channels, filterBy(report, 'channel'), { href: group('sources'), text: 'View all channels' })}${shortTable('Browsers', 'Browser', ['Share', 'share of visitors'], browsers, filterBy(report, 'browser'), { href: group('devices'), text: 'View all devices' })}</div>`
}
