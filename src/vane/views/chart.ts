import { count, escape, panel } from './html'
import { duration, percent } from './tables'
import { METRICS, type Bucket, type Metric } from '../series'
import { INTERVALS, type Interval } from '../periods'
// DASH-002: the main chart is a server-drawn line of the chosen metric per bucket, with its data table:
// every bucket's figures in a captioned table that a screen reader can read in place of the drawing.
const W = 640, H = 180, PAD = 8
const shown = (metric: Metric, value: number | null) => value === null ? '—' : metric === 'bounceRate' ? percent(value) : metric === 'duration' ? duration(value) : count(value)

export function chartPanel(report: any): string {
  const metric = report.metric as Metric, interval = report.interval as Interval, buckets: Bucket[] = report.series ?? []
  const values = buckets.map(b => b[metric] as number | null), max = Math.max(0, ...values.map(v => v ?? 0))
  const x = (i: number) => buckets.length < 2 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (buckets.length - 1)
  const y = (v: number) => H - PAD - (max ? (v / max) * (H - 2 * PAD) : 0)
  // A bucket without visits has no bounce rate or duration, so the line breaks there instead of dropping to zero.
  const runs: string[][] = [[]]
  values.forEach((v, i) => v === null ? runs.push([]) : runs[runs.length - 1]!.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`))
  const title = `${METRICS[metric]} by ${INTERVALS[interval].toLowerCase().replace(/ \(.*\)/, '')}, ${report.from} to ${report.to} (end exclusive, ${report.timeZone})`
  const svg = `<svg class="vane-chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="vane-chart-title"><title id="vane-chart-title">${escape(title)}</title><line class="vane-chart-axis" x1="0" y1="${H - PAD}" x2="${W}" y2="${H - PAD}"/>${runs.filter(r => r.length).map(r => `<polyline class="vane-chart-line" points="${r.join(' ')}"/>`).join('')}${values.map((v, i) => v === null ? '' : `<circle class="vane-chart-point" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" data-bucket="${escape(buckets[i]!.label)}" data-value="${v}"><title>${escape(buckets[i]!.label)}: ${escape(shown(metric, v))}</title></circle>`).join('')}</svg>`
  const scale = `<p class="vane-help">Scale 0 to ${escape(shown(metric, max))}. ${buckets.length ? `${escape(buckets[0]!.label)} to ${escape(buckets[buckets.length - 1]!.label)}.` : ''}${interval === 'hour' ? ' Hours are real hours from local midnight, labelled with the zone in effect; imported history has no time of day and appears in daily, weekly and monthly charts.' : interval === 'week' ? ' Weeks start on Monday; the first and last weeks are cut to the range.' : interval === 'month' ? ' The first and last months are cut to the range.' : ''}</p>`
  const head = (Object.keys(METRICS) as Metric[]).map(m => `<th scope="col" class="vane-number">${escape(METRICS[m])}</th>`).join('')
  const body = buckets.map(b => `<tr><th scope="row">${escape(b.label)}</th>${(Object.keys(METRICS) as Metric[]).map(m => `<td class="vane-number" data-metric="${m}">${escape(shown(m, b[m] as number | null))}</td>`).join('')}</tr>`).join('')
  const table = `<details class="vane-chart-data"><summary>Data table</summary><div class="vane-table-scroll" role="region" aria-label="Chart data" tabindex="0"><table><caption>${escape(title)}</caption><thead><tr><th scope="col">${escape(INTERVALS[interval].replace(/ \(.*\)/, ''))}</th>${head}</tr></thead><tbody>${body}</tbody></table></div></details>`
  return panel('Over time', `<figure class="vane-chart-figure">${svg}<figcaption>${scale}</figcaption></figure>${table}<p class="vane-help">Visitors are each bucket’s daily unique visitors summed over its days (an hour counts its distinct visitor hashes). A visit, its bounce and its duration belong to the bucket of its first page load; pageviews and goal conversions count where they happened. Revenue joins the chart when revenue goals exist.</p>`)
}
