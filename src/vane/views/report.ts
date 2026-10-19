import { breakdown, count, escape, field, panel } from './html'
import { storage } from '../privacy-signals'
import type { ViewData } from './types'

function comparison(current: number, previous: number): string {
  if (!previous) return current ? 'No activity in the previous period.' : 'No activity in either period.'
  const change = ((current - previous) / previous) * 100
  return `<span class="vane-change">${change > 0 ? '+' : ''}${change.toFixed(1)}%</span> compared with the previous period (${count(previous)}).`
}

export function reportPage(data: ViewData): string {
  const report = data.report
  const filters = `<form method="get" class="vane-filter"><input type="hidden" name="section" value="report">${field('From', 'from', report?.from?.slice(0, 10), 'type="date"')}${field('Until (exclusive)', 'to', report?.to?.slice(0, 10), 'type="date"')}<button type="submit">Update report</button></form>`
  if (!report) return `${panel('Reporting period', filters)}${panel('Report', '<p class="vane-empty">No report is available yet. Install the script and collect eligible page loads to see activity here.</p>')}${limits(data)}`
  const pageviews = Number(report.pageviews) || 0
  const goals = Number(report.goals) || 0
  const period = `<p>${escape(report.from)} to ${escape(report.to)}${report.previousFrom ? `. Compared with the preceding period starting ${escape(report.previousFrom)}.` : '.'}</p>`
  const metrics = `<div class="vane-metrics"><section class="vane-panel"><h2>Unique visitors</h2><p class="vane-metric">${count(report.visitors)}</p><p>${comparison(Number(report.visitors) || 0, Number(report.previousVisitors) || 0)}</p><p class="vane-help">Distinct daily visitor hashes, summed over the days in the range.</p></section><section class="vane-panel"><h2>Visits</h2><p class="vane-metric">${count(report.visits)}</p><p>${comparison(Number(report.visits) || 0, Number(report.previousVisits) || 0)}</p><p class="vane-help">Runs of one visitor hash’s page loads with no gap over 30 minutes.</p></section><section class="vane-panel"><h2>Pageviews</h2><p class="vane-metric">${count(pageviews)}</p><p>${comparison(pageviews, Number(report.previousPageviews) || 0)}</p></section><section class="vane-panel"><h2>Goal conversions</h2><p class="vane-metric">${count(goals)}</p><p>${comparison(goals, Number(report.previousGoals) || 0)}</p></section>${tile('Pages per visit', decimal(report.pagesPerVisit), `Views per visitor: ${decimal(report.viewsPerVisitor)}.`)}${tile('Bounce rate', percent(report.bounceRate), 'Visits with one page load and no engagement ping.')}${tile('Visit duration', duration(report.medianDuration), `Median; average ${duration(report.averageDuration)}. From the first page load to the last engagement signal.`)}</div>`
  const explanation = report.explanation ? `<p>${escape(report.explanation)}</p>` : '<p>There is not enough evidence to explain a change in this period.</p>'
  return `${panel('Reporting period', filters + period)}${!pageviews && !goals ? '<p class="vane-notice" role="status">No recorded activity for this period. Counts will appear when eligible page loads arrive or supported history is imported.</p>' : ''}${metrics}${panel('Weekly explanation', `${explanation}<p class="vane-help">The referring hostname, campaign, page and goal counts below are the evidence for this period. Changes in recorded activity alone do not establish why people acted.</p>`)}<div class="vane-breakdowns">${breakdown('Referring hostnames', report.sources)}${breakdown('Campaigns', report.campaigns)}${breakdown('Pages', report.pages)}${breakdown('Goals', report.goalBreakdown)}</div>${engagementTable(report.engagement)}${limits(data)}`
}

const decimal = (value: unknown) => value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
const percent = (value: unknown) => value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`
const duration = (value: unknown) => value === null || value === undefined ? '—' : `${Math.floor(Number(value) / 60)}m ${String(Number(value) % 60).padStart(2, '0')}s`
const tile = (title: string, value: string, help: string) => `<section class="vane-panel"><h2>${escape(title)}</h2><p class="vane-metric">${escape(value)}</p><p class="vane-help">${escape(help)}</p></section>`

// METRIC-003: per page, the visits that entered there (bounce rate, visit duration) and the time spent on it.
function engagementTable(rows: any[] = []): string {
  if (!rows.length) return panel('Engagement by page', '<p class="vane-empty">No timed visits in this period. Visits, bounce rate and durations count page loads collected with a time and visitor hash.</p>')
  return panel('Engagement by page', `<div class="vane-table-scroll" role="region" aria-label="Engagement by page" tabindex="0"><table><caption class="vane-sr-only">Engagement by page</caption><thead><tr><th scope="col">Path</th><th scope="col" class="vane-number">Pageviews</th><th scope="col" class="vane-number">Visits entering</th><th scope="col" class="vane-number">Bounce rate</th><th scope="col" class="vane-number">Visit duration (median / average)</th><th scope="col" class="vane-number">Time on page (median / average)</th></tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${escape(row.path)}</th><td class="vane-number">${count(row.pageviews)}</td><td class="vane-number">${count(row.entries)}</td><td class="vane-number">${percent(row.bounceRate)}</td><td class="vane-number">${duration(row.medianDuration)} / ${duration(row.averageDuration)}</td><td class="vane-number">${duration(row.medianTimeOnPage)} / ${duration(row.averageTimeOnPage)}</td></tr>`).join('')}</tbody></table></div>`, 'Time on a page runs to the next page load of the visit; on the last page, to its last engagement ping.')
}

function limits(data: ViewData): string {
  const config = data.site?.config ?? {}
  const report = data.report
  return panel('Coverage and collection limits', `<p>Pageviews are page loads; repeat loads are counted again. Visits and unique visitors come from a daily-rotating salted hash that is never stored with an IP address or user agent, so a visitor cannot be followed across days.</p><dl><dt>Sample rate</dt><dd>${escape(config.sampleRate ?? 100)}% of eligible page loads; 100% means all eligible loads.</dd><dt>Consent</dt><dd>${config.consent !== 'not-required' ? 'Required. Loads without the consent flag are excluded.' : 'Not required by this site’s configuration.'}</dd><dt>Allowed paths</dt><dd>${escape((config.paths ?? []).join(', ') || 'No paths configured.')}</dd><dt>Retention</dt><dd>${escape(config.retentionDays ?? 90)} days</dd><dt>Browser storage</dt><dd>${storage.map(escape).join(' ')}</dd>${report ? `<dt>Privacy signals</dt><dd>${report.signalCounter ? `${count(report.privacySignals)} page loads sent Global Privacy Control or Do Not Track and were not collected (${report.privacySignals ? ((Number(report.privacySignals) / (Number(report.privacySignals) + Number(report.pageviews))) * 100).toFixed(1) : '0.0'}% of observed page loads).` : 'Honoured; not counted. Turn on the privacy-signal counter in settings to see their share.'}</dd><dt>Imported activity</dt><dd>${count(report.imported)}</dd><dt>Unknown coverage</dt><dd>${count(report.unknownCoverage)}</dd>` : ''}</dl><p>Blocked scripts, missing consent, sampling and unconfigured paths can leave activity unrecorded. Imported history may have different collection coverage. An empty report does not establish that nobody visited.</p>`)
}
