import { count, date, escape, hidden, operation, shortDay, siteLink, timeOfDay } from './html'
import { icon, type IconName } from './icons'
import { flaggedDays, runningDay } from './chart'
import { commands } from './approvals'
import { ANNOTATION_KINDS } from '../annotations'
import { unitOf, type Mover } from '../explain'
import type { ViewData } from './types'
// REPORT-003 beside the Overview: what changed between the periods (never why), the evidence for it, the change
// waiting for the owner, and whether the latest judged day is back inside its weekday's normal variation.

export const reasons: Record<string, string> = { 'dropped-property': 'Dropped properties', 'consent-declined': 'Declined consent', 'excluded-path': 'Excluded paths', 'excluded-ip': 'Excluded IP addresses', 'excluded-country': 'Excluded countries', bot: 'Bots and automation', 'data-centre': 'Data-centre networks', 'referrer-spam': 'Referrer spam', 'own-browser': 'Own browser (opted out)', 'privacy-signals': 'Privacy signals', imported: 'Imported events' }
const judged: Record<string, string> = { visitors: 'Unique visitors', visits: 'Visits', pageviews: 'Pageviews' }
const signedPercent = (now: number, then: number) => then ? `${now >= then ? '+' : '−'}${Math.abs(Math.round(((now - then) / then) * 1000) / 10)}%` : 'new'
const moverIcon: Record<string, IconName> = { Channel: 'sources', Page: 'pages', Campaign: 'sources', Device: 'devices', Country: 'visitors', Region: 'visitors', City: 'visitors' }
const row = (iconName: IconName, title: string, detail: string, href: string) => `<li><a href="${escape(href)}">${icon(iconName)}<span><strong>${escape(title)}</strong><small>${escape(detail)}</small></span>${icon('chevron', 'vane-chevron')}</a></li>`

export function movedPanel(data: ViewData, report: any): string {
  const e = report.explain, movers: Mover[] = [...(e?.movers ?? [])].sort((a, b) => Math.abs(b.now - b.then) - Math.abs(a.now - a.then))
  // The most unusual finished day leads: the one furthest outside its interval, relative to the interval's edge.
  const flagged = flaggedDays(report), off = (o: { value: number; low: number; high: number }) => o.value < o.low ? (o.low - o.value) / Math.max(1, o.low) : (o.value - o.high) / Math.max(1, o.high)
  const last = [...flagged.entries()].sort((a, b) => off(b[1]) - off(a[1]))[0]
  let finding: string, detail: string
  // A range that is only today judges nothing yet: it says the day is running and sets it against the same hours then.
  const today = report.running && report.from === report.running.day && Date.parse(report.to) - Date.parse(report.from) === 86400000 ? report.running : null
  const by = report.running ? timeOfDay(report.running.at, report.timeZone) : ''
  if (today) {
    const now = Number(report.visitors) || 0, then = Number(report.previousVisitors) || 0
    finding = `Today is still running, so it is not judged yet.`
    detail = `By ${by}: ${count(now)} ${unitOf(now, 'unique visitors')}, against ${count(then)} by the same time on ${shortDay(report.running.thenDay)}.`
  } else if (last) {
    const [day, out] = last
    finding = `${shortDay(day)}: ${(judged[out.metric] ?? out.metric).toLowerCase()} ${out.value < out.low ? 'fell below' : 'rose above'} normal variation.`
    detail = `${count(out.value)} against a normal ${out.low.toLocaleString('en-US')} to ${out.high.toLocaleString('en-US')} for that weekday.`
  } else if (movers.length) {
    const m = movers[0]!
    finding = m.then ? `${m.dimension} ${m.label} ${m.now < m.then ? 'fell' : 'rose'} ${signedPercent(m.now, m.then).replace(/^[+−]/, '')} against the compared period${by ? `, both counted to ${by}` : ''}.` : `${m.dimension} ${m.label} is new against the compared period.`
    detail = `${count(m.then)} → ${count(m.now)} ${unitOf(m.now, m.unit)}, of ${count(m.totalThen)} → ${count(m.totalNow)} in all.`
  } else {
    finding = 'Nothing moved outside normal variation.'
    detail = 'No channel, page, campaign or device changed between the periods.'
  }
  const evidence = [
    ...movers.slice(0, 3).map(m => row(moverIcon[m.dimension] ?? 'overview', `${m.dimension}: ${m.label}`, `${count(m.then)} → ${count(m.now)} ${unitOf(m.now, m.unit)} (${signedPercent(m.now, m.then)})${by ? ' so far' : ''}`, '#explanation')),
    ...(e?.annotations ?? []).slice(0, 1).map((a: any) => row('note', a.text, `${shortDay(a.day)} · ${(ANNOTATION_KINDS as Record<string, string>)[a.kind] ?? a.kind}`, '#notes')),
    ...(e?.coverage ?? []).slice(0, 1).map((c: any) => row('percent', reasons[c.label] ?? c.label, `${count(c.then)} → ${count(c.now)} against the compared period`, '#coverage')),
  ].slice(0, 4)
  // The change waiting for the owner on this site, with the owner's approval in place.
  const site = data.rollup ? null : data.site, waiting = site ? (data.proposals ?? []).filter(p => (p.state === 'pending' || p.state === 'prepared') && (() => { try { return JSON.parse(p.payload_json).siteId === site.id } catch { return false } })()) : []
  const first = waiting[0], erase = first && (String(first.command).includes('erase') || first.command === 'site.delete')
  const proposed = site ? `<h3>Proposed change</h3>${first ? `<div class="vane-proposed">${icon('code')}<span><strong>${escape(commands[first.command] ?? first.command)}</strong><small>Prepared ${date(first.created_at)} by ${escape(first.prepared_name ?? 'someone no longer on the team')}${waiting.length > 1 ? ` · ${waiting.length - 1} more waiting` : ''}</small></span></div><div class="vane-moved-actions">${data.actor.role === 'owner' ? `<form method="post" action="/app/action">${operation('proposal.approve')}${hidden('id', first.id)}<button type="submit"${erase ? ' class="vane-danger"' : ''}>${erase ? 'Approve erasure' : 'Approve change'}</button></form>` : '<p class="vane-help">Waiting for owner approval.</p>'}<a class="vane-button vane-secondary" href="${siteLink(site.id, 'approvals')}">Review change</a></div>` : '<p class="vane-empty">No change is waiting for approval.</p>'}<p class="vane-authority">${icon('lock')}Administrators, analysts and the command API prepare changes; only the owner approves them.</p>` : ''
  // The latest judged day: back within normal variation after a flagged day, still outside, or every day within.
  const running = runningDay(report), days = (e?.variation ?? []).filter((d: any) => d.metrics && d.day !== running), latest = days[days.length - 1]
  let result = ''
  if (latest) {
    const ok = !flagged.has(latest.day), value = latest.metrics.visitors.value
    const title = !ok ? 'Still outside normal variation' : last ? 'Back within normal variation' : 'Every judged day within normal variation'
    const note = !ok || last ? `${shortDay(latest.day)}: ${count(value)} unique visitors` : `${days.length} ${days.length === 1 ? 'day' : 'days'} against the same weekday in the 8 weeks before`
    result = `<a class="vane-result${ok ? '' : ' is-out'}" href="#explanation">${icon(ok ? 'check' : 'percent', 'vane-result-icon')}<span><strong>${escape(title)}</strong><small>${escape(note)}</small></span>${icon('chevron', 'vane-chevron')}</a>`
  }
  return `<aside class="vane-panel vane-moved" aria-labelledby="vane-moved-title"><div class="vane-moved-head"><span class="vane-moved-mark">${icon('sparkle')}</span><h2 id="vane-moved-title">What changed</h2></div><p class="vane-moved-finding">${escape(finding)}</p><p class="vane-moved-detail">${escape(detail)}</p><h3>Evidence</h3>${evidence.length ? `<ul class="vane-evidence">${evidence.join('')}</ul>` : '<p class="vane-empty">No movers, annotations or coverage changes in this range.</p>'}${proposed}${result}</aside>`
}
