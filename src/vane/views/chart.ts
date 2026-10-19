import { count, escape, money, shortDay } from './html'
import { duration, percent } from './tables'
import { METRICS, type Bucket, type Metric } from '../series'
import { bucketKey, INTERVALS, type Interval } from '../periods'
import type { Annotation } from '../definitions'
import type { VariationDay } from '../explain'
// DASH-002: the main chart is a server-drawn line of the chosen metric per bucket, with its data table:
// every bucket's figures in a captioned table that a screen reader can read in place of the drawing.
// The plot stretches to its card (preserveAspectRatio none, fixed height); strokes and dots keep their size with
// non-scaling strokes, and the axis labels are HTML beside it, so no text is ever drawn scaled.
const W = 1000, H = 220, TOP = 12, BOTTOM = 8
// METRIC-004: a visit-definition version changes visits, bounce rate and visit duration, so it annotates those charts.
const VISIT_METRICS: Metric[] = ['visits', 'bounceRate', 'duration']
const shown = (metric: Metric, value: number | null, currency = 'USD') => value === null ? '—' : metric === 'bounceRate' ? percent(value) : metric === 'duration' ? duration(value) : metric === 'revenue' ? money(value, currency) : count(value)
const compact = (metric: Metric, value: number, currency: string) => metric === 'bounceRate' ? `${value}%` : metric === 'duration' ? duration(value) : metric === 'revenue' ? money(value, currency).replace(/\.00$/, '') : value >= 1000 ? `${Number((value / 1000).toFixed(1))}K` : String(value)
// Four even steps up to a round top (1 to 8 times a power of ten); counts step by whole numbers.
function scaleTop(max: number, whole: boolean): number {
  if (!max) return whole ? 4 : 1
  const raw = max / 4, power = 10 ** Math.floor(Math.log10(raw)), step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(f => f * power).find(s => s >= raw)!
  return (whole ? Math.max(1, Math.ceil(step)) : step) * 4
}
// A preset range that runs to the end of today ends on a day still running, which no baseline can judge yet.
const UNTIL_TODAY = ['today', '7d', '30d', '90d', 'month', 'year', '12mo', 'all']
export const runningDay = (report: any): string | null => UNTIL_TODAY.includes(report.period) ? new Date(Date.parse(`${report.to}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : null
// REPORT-003: the finished days the day-of-week baseline judged outside normal variation, by the first metric that left it.
export function flaggedDays(report: any): Map<string, { metric: string; value: number; low: number; high: number }> {
  const flagged = new Map<string, { metric: string; value: number; low: number; high: number }>(), running = runningDay(report)
  for (const day of (report.explain?.variation ?? []) as VariationDay[]) {
    if (day.day === running) continue
    const out = Object.entries(day.metrics ?? {}).find(([, interval]) => !interval.within)
    if (out) flagged.set(day.day, { metric: out[0], ...out[1] })
  }
  return flagged
}
const judgedNames: Record<string, string> = { visitors: 'unique visitors', visits: 'visits', pageviews: 'pageviews' }

export function chartPanel(report: any, companions = ''): string {
  const currency: string = report.revenue?.currency ?? 'USD'
  const metric = report.metric as Metric, interval = report.interval as Interval, buckets: Bucket[] = report.series ?? [], before: Bucket[] = report.previousSeries ?? []
  // DASH-008: the compared period is overlaid bucket by bucket (its first bucket beside the range's first), as a dashed line.
  const values = buckets.map(b => b[metric] as number | null), then = before.map(b => b[metric] as number | null), max = Math.max(0, ...values.map(v => v ?? 0), ...then.map(v => v ?? 0))
  const top = scaleTop(max, !['bounceRate', 'duration', 'revenue'].includes(metric))
  const slots = Math.max(buckets.length, before.length), x = (i: number) => slots < 2 ? W / 2 : (i * W) / (slots - 1)
  const y = (v: number) => H - BOTTOM - (v / top) * (H - TOP - BOTTOM)
  // A bucket without visits has no bounce rate or duration, so the line breaks there instead of dropping to zero.
  const runs = (series: (number | null)[]) => { const all: [number, number][][] = [[]]; series.forEach((v, i) => v === null ? all.push([]) : all[all.length - 1]!.push([x(i), y(v)])); return all.filter(r => r.length) }
  const points = (run: [number, number][]) => run.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const line = (series: (number | null)[], kind: string) => runs(series).map(r => `<polyline class="${kind}" points="${points(r)}"/>`).join('')
  // A day still running ends the line with a dashed segment: its figure is only what has arrived so far.
  const running = interval === 'day' && buckets.length > 1 && buckets[buckets.length - 1]!.key === runningDay(report) && values[values.length - 2] !== null && values[values.length - 1] !== null
  const settled = running ? [...values.slice(0, -1), null] : values, n = values.length
  const tail = running ? `<polyline class="vane-chart-running" points="${x(n - 2).toFixed(1)},${y(values[n - 2]!).toFixed(1)} ${x(n - 1).toFixed(1)},${y(values[n - 1]!).toFixed(1)}"/>` : ''
  const area = runs(settled).map(r => `<path class="vane-chart-area" d="M${r[0]![0].toFixed(1)},${H - BOTTOM} L${points(r).replace(/ /g, ' L')} L${r[r.length - 1]![0].toFixed(1)},${H - BOTTOM} Z"/>`).join('')
  // DASH-009: every annotation marks the chart, except a definition version outside the visit metrics.
  const notes: Annotation[] = (report.annotations ?? []).filter((note: Annotation) => note.kind !== 'definition' || VISIT_METRICS.includes(metric))
  const marks = notes.map(note => { const i = buckets.findIndex(b => b.key === bucketKey(interval, note.day, report.from, report.timeZone)); return i < 0 ? '' : `<line class="vane-chart-annotation" x1="${x(i).toFixed(1)}" y1="0" x2="${x(i).toFixed(1)}" y2="${H - BOTTOM}" data-annotation="${escape(note.day)}"><title>${escape(note.day)}: ${escape(note.text)}</title></line>` }).join('')
  const annotations = notes.length ? `<ul class="vane-annotations" aria-label="Chart annotations">${notes.map(note => `<li data-annotation-day="${escape(note.day)}" data-annotation-kind="${escape(note.kind)}"><time datetime="${escape(note.day)}">${escape(note.day)}</time> ${note.site ? `${escape(note.site)}: ` : ''}${escape(note.text)}${note.kind === 'definition' ? ' <a href="/methodology#visits">Definition</a>' : ''}</li>`).join('')}</ul>` : ''
  // REPORT-003: a day outside its weekday's normal variation is marked coral on a daily chart.
  const flagged = interval === 'day' ? flaggedDays(report) : new Map()
  const dot = (i: number, v: number, kind: string) => `<line class="${kind}" x1="${x(i).toFixed(1)}" y1="${y(v).toFixed(1)}" x2="${x(i).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`
  const title = `${METRICS[metric]} by ${INTERVALS[interval].toLowerCase().replace(/ \(.*\)/, '')}, ${report.from} to ${report.to} (end exclusive, ${report.timeZone})`
  const grid = [1, 2, 3, 4].map(n => `<line class="vane-chart-grid" x1="0" y1="${y((top * n) / 4).toFixed(1)}" x2="${W}" y2="${y((top * n) / 4).toFixed(1)}"/>`).join('')
  const svg = `<svg class="vane-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-labelledby="vane-chart-title"><title id="vane-chart-title">${escape(title)}</title><defs><linearGradient id="vane-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d58f0" stop-opacity=".16"/><stop offset="1" stop-color="#1d58f0" stop-opacity="0"/></linearGradient></defs>${grid}<line class="vane-chart-axis" x1="0" y1="${H - BOTTOM}" x2="${W}" y2="${H - BOTTOM}"/>${marks}${area}${line(then, 'vane-chart-compare')}${line(settled, 'vane-chart-line')}${tail}${then.map((v, i) => v === null ? '' : `${dot(i, v, 'vane-chart-compare-dot')}<circle class="vane-chart-compare-point" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="6" data-bucket="${escape(before[i]!.label)}" data-value="${v}"><title>${escape(before[i]!.label)} (compared): ${escape(shown(metric, v))}</title></circle>`).join('')}${values.map((v, i) => { if (v === null) return ''; const flag = flagged.get(buckets[i]!.key); return `${dot(i, v, flag ? 'vane-chart-dot vane-chart-flag' : 'vane-chart-dot')}<circle class="vane-chart-point" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="6" data-bucket="${escape(buckets[i]!.label)}" data-value="${v}"${flag ? ' data-flag="outside"' : ''}><title>${escape(buckets[i]!.label)}: ${escape(shown(metric, v))}${flag ? `; ${escape(judgedNames[flag.metric] ?? flag.metric)} outside normal variation` : ''}</title></circle>` }).join('')}</svg>`
  // HTML axes: y ticks spread over the plot height, x labels spread over its width (every bucket; at most eight labelled).
  const yAxis = `<div class="vane-chart-y" aria-hidden="true">${[4, 3, 2, 1, 0].map(n => `<span>${escape(compact(metric, (top * n) / 4, currency))}</span>`).join('')}</div>`
  const every = Math.max(1, Math.ceil(buckets.length / 8))
  const xLabel = (b: Bucket, i: number) => i % every ? '' : interval === 'day' ? `${escape(shortDay(b.key).split(',')[0]!)}<br>${escape(shortDay(b.key).split(', ')[1]!)}` : interval === 'hour' ? escape(b.label.slice(11, 16)) : interval === 'week' ? escape(b.label.replace('Week of ', '')) : escape(b.label)
  const xAxis = `<div class="vane-chart-x" aria-hidden="true">${buckets.map((b, i) => `<span${flagged.has(b.key) ? ' class="is-flagged"' : ''}>${xLabel(b, i)}${running && i === n - 1 ? '<br>so far' : ''}</span>`).join('')}</div>`
  const scale = `<p class="vane-help">Scale 0 to ${escape(shown(metric, max, currency))}. ${buckets.length ? `${escape(buckets[0]!.label)} to ${escape(buckets[buckets.length - 1]!.label)}.` : ''}${interval === 'hour' ? ' Hours are real hours from local midnight, labelled with the zone in effect; imported history has no time of day and appears in daily, weekly and monthly charts.' : interval === 'week' ? ' Weeks start on Monday; the first and last weeks are cut to the range.' : interval === 'month' ? ' The first and last months are cut to the range.' : ''}</p>`
  const head = (Object.keys(METRICS) as Metric[]).map(m => `<th scope="col" class="vane-number">${escape(METRICS[m])}</th>`).join('')
  const body = Array.from({ length: slots }, (_, i) => { const b = buckets[i], c = before[i]; return `<tr><th scope="row">${escape(b?.label ?? '—')}</th>${(Object.keys(METRICS) as Metric[]).map(m => `<td class="vane-number"${b ? ` data-metric="${m}"` : ''}>${b ? escape(shown(m, b[m] as number | null, currency)) : '—'}</td>`).join('')}<td>${escape(c?.label ?? '—')}</td><td class="vane-number"${c ? ' data-compare="1"' : ''}>${c ? escape(shown(metric, c[metric] as number | null, currency)) : '—'}</td></tr>` }).join('')
  const legend = `<p class="vane-help vane-chart-dates"><span class="vane-chart-key"></span> ${escape(report.from)} to ${escape(report.to)} · <span class="vane-chart-key vane-chart-key-compare"></span> compared with ${escape(report.previousFrom)} to ${escape(report.previousTo)}${report.weekdays ? ', matching weekdays' : ''}</p>`
  const table = `<details class="vane-chart-data"><summary>Data table and notes</summary>${legend}${scale}<p class="vane-help">Visitors are each bucket’s daily unique visitors summed over its days (an hour counts its distinct visitor hashes). A visit, its bounce and its duration belong to the bucket of its first page load; pageviews and goal conversions count where they happened. Revenue counts in the bucket of the page load it was sent on, in the site currency.</p><div class="vane-table-scroll" role="region" aria-label="Chart data" tabindex="0"><table><caption>${escape(title)}</caption><thead><tr><th scope="col">${escape(INTERVALS[interval].replace(/ \(.*\)/, ''))}</th>${head}<th scope="col">Compared with</th><th scope="col" class="vane-number">${escape(METRICS[metric])} then</th></tr></thead><tbody>${body}</tbody></table></div></details>`
  // The first flagged day, with its value against the compared bucket beside it.
  const firstFlag = buckets.findIndex(b => flagged.has(b.key)), flagValue = firstFlag < 0 ? null : values[firstFlag], flagThen = firstFlag < 0 ? null : then[firstFlag]
  const callout = firstFlag < 0 || flagValue === null ? '' : `<p class="vane-chart-callout" data-flag-day="${escape(buckets[firstFlag]!.key)}"><strong>${escape(shortDay(buckets[firstFlag]!.key))}</strong> ${escape(shown(metric, flagValue, currency))}${flagThen ? ` <span>${flagValue < flagThen ? '↓' : '↑'} ${escape(Math.abs(Math.round(((flagValue - flagThen) / flagThen) * 100)))}% against the compared day</span>` : ''} · outside normal variation</p>`
  const key = `<p class="vane-chart-legend" aria-hidden="true"><span class="vane-legend-now">This period</span><span class="vane-legend-then">Compared period</span></p>`
  return `<section class="vane-panel vane-chart-panel"><div class="vane-chart-head"><h2>${escape(METRICS[metric])}</h2>${key}</div>${callout}<figure class="vane-chart-figure"><div class="vane-plot">${yAxis}<div class="vane-plot-area">${svg}${xAxis}</div></div>${annotations ? `<figcaption>${annotations}</figcaption>` : ''}</figure><div class="vane-chart-foot">${companions}${table}</div></section>`
}
