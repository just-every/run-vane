import { breakdown, count, escape, field, panel } from './html'
import type { ViewData } from './types'

function comparison(current: number, previous: number): string {
  if (!previous) return current ? 'No activity in the previous period.' : 'No activity in either period.'
  const change = ((current - previous) / previous) * 100
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}% compared with the previous period (${count(previous)}).`
}

export function reportPage(data: ViewData): string {
  const report = data.report
  const filters = `<form method="get" class="vane-filter"><input type="hidden" name="section" value="report">${field('From', 'from', report?.from?.slice(0, 10), 'type="date"')}${field('Until (exclusive)', 'to', report?.to?.slice(0, 10), 'type="date"')}<button type="submit">Update report</button></form>`
  if (!report) return `${panel('Reporting period', filters)}${panel('Report', '<p class="vane-empty">No report is available yet. Install the script and collect eligible page loads to see activity here.</p>')}${limits(data)}`
  const visits = Number(report.visits) || 0
  const goals = Number(report.goals) || 0
  const period = `<p>${escape(report.from)} to ${escape(report.to)}${report.previousFrom ? `. Compared with the preceding period starting ${escape(report.previousFrom)}.` : '.'}</p>`
  const metrics = `<div class="vane-metrics"><section class="vane-panel"><h2>Visits (page loads)</h2><p class="vane-metric">${count(visits)}</p><p>${comparison(visits, Number(report.previousVisits) || 0)}</p></section><section class="vane-panel"><h2>Goal conversions</h2><p class="vane-metric">${count(goals)}</p><p>${comparison(goals, Number(report.previousGoals) || 0)}</p></section></div>`
  const explanation = report.explanation ? `<p>${escape(report.explanation)}</p>` : '<p>There is not enough evidence to explain a change in this period.</p>'
  return `${panel('Reporting period', filters + period)}${!visits && !goals ? '<p class="vane-notice" role="status">No recorded activity for this period. Counts will appear when eligible page loads arrive or supported history is imported.</p>' : ''}${metrics}${panel('Weekly explanation', `${explanation}<p class="vane-help">The referring hostname, campaign, page and goal counts below are the evidence for this period. Changes in recorded activity alone do not establish why people acted.</p>`)}<div class="vane-breakdowns">${breakdown('Referring hostnames', report.sources)}${breakdown('Campaigns', report.campaigns)}${breakdown('Pages', report.pages)}${breakdown('Goals', report.goalBreakdown)}</div>${limits(data)}`
}

function limits(data: ViewData): string {
  const config = data.site?.config ?? {}
  const report = data.report
  return panel('Coverage and collection limits', `<p>Visits are page loads, not unique people or sessions. Repeat loads can be counted again. Vane does not fingerprint visitors.</p><dl><dt>Sample rate</dt><dd>${escape(config.sampleRate ?? 100)}% of eligible page loads; 100% means all eligible loads.</dd><dt>Consent</dt><dd>${config.consent !== 'not-required' ? 'Required. Loads without the consent flag are excluded.' : 'Not required by this site’s configuration.'}</dd><dt>Allowed paths</dt><dd>${escape((config.paths ?? []).join(', ') || 'No paths configured.')}</dd><dt>Retention</dt><dd>${escape(config.retentionDays ?? 90)} days</dd>${report ? `<dt>Imported activity</dt><dd>${count(report.imported)}</dd><dt>Unknown coverage</dt><dd>${count(report.unknownCoverage)}</dd>` : ''}</dl><p>Blocked scripts, missing consent, sampling and unconfigured paths can leave activity unrecorded. Imported history may have different collection coverage. An empty report does not establish that nobody visited.</p>`)
}
