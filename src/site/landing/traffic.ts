// Page 02: visitors without cookies, then where they came from.
import { n, site, week, weekVisitors } from './data'
import { icons } from './icons'
import { card, feature, handled } from './parts'

// A smooth line through the week (Catmull-Rom as cubic Béziers), built at site build time.
function weekChart() {
  const w = 640, h = 104, top = 10, low = 2800, high = 5000
  const pts = week.map((day, i) => [20 + i * (w - 40) / (week.length - 1), top + (high - day.visitors) / (high - low) * (h - top - 6)])
  let d = `M${pts[0][0]} ${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[Math.max(i - 1, 0)], pts[i], pts[i + 1], pts[Math.min(i + 2, pts.length - 1)]]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${c1.map(v => v.toFixed(1)).join(' ')} ${c2.map(v => v.toFixed(1)).join(' ')} ${p2[0]} ${p2[1].toFixed(1)}`
  }
  const dots = pts.map(([x, y]) => `<circle cx="${x}" cy="${y.toFixed(1)}" r="4.2"/>`).join('')
  const labels = week.map(day => `<span>${day.day}</span>`).join('')
  return `<div class="week-chart"><svg viewBox="0 0 ${w} ${h + 6}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="week-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d58f0" stop-opacity=".12"/><stop offset="1" stop-color="#1d58f0" stop-opacity="0"/></linearGradient></defs><path d="${d}L${pts[pts.length - 1][0]} ${h + 6}H${pts[0][0]}z" fill="url(#week-fill)"/><path d="${d}" fill="none" stroke="#1d58f0" stroke-width="2.4"/></svg><svg class="week-dots" viewBox="0 0 ${w} ${h + 6}" preserveAspectRatio="none" aria-hidden="true"><g fill="#1d58f0">${dots}</g></svg><div class="week-days">${labels}</div><p class="sr-only">Daily unique visitors, Saturday to Friday: ${week.map(day => `${day.day} ${n(day.visitors)}`).join(', ')}.</p></div>`
}

const stat = (label: string, value: string, extra = '') => `<div class="stat"><p>${label}</p><strong>${value}</strong>${extra}</div>`

const visitorsCard = card(`${site}, last 7 days`, `<header class="card-head"><p><strong>${site}</strong> · Last 7 days</p><p class="live"><span class="live-dot" aria-hidden="true"></span>38 online now</p></header>`
  + `<div class="stats">${stat('Unique visitors', n(weekVisitors), `<span class="delta">${icons.up}12%</span>`)}${stat('Visits', '41,903')}${stat('Bounce rate', '38%')}${stat('Visit duration', '2m 14s')}</div>${weekChart()}`, 'card-visitors')

const sources = [
  ['Google', 9812, '#1d58f0'], ['Direct', 3904, '#1fa463'], ['Hacker News', 2206, '#f7931e'], ['Newsletter <span class="muted">· utm_source=weekly</span>', 2140, '#8b4fe0'], ['Reddit', 1388, '#f0503c'],
] as const
const sourcesCard = card('Top sources, Oct 1 to 16, United States', `<header class="card-head"><p><strong>Top sources</strong> · Oct 1–16 <span class="compare-chip">vs Sep 1–16</span></p><p class="select-chip">Country: United States ${'<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'}</p></header>`
  + `<ul class="bars">${sources.map(([name, value, color]) => `<li><span class="bar-dot" style="background:${color}"></span><span class="bar-name">${name}</span><span class="bar-track"><span style="width:${(value / sources[0][1] * 69).toFixed(1)}%"></span></span><span class="bar-value">${n(value)}</span></li>`).join('')}</ul>`, 'card-sources')

export const traffic = () => feature({
  id: 'visitors', eyebrow: 'Visitors', title: 'Every visitor,<br> no cookies.',
  body: 'Vane counts unique visitors, visits, bounce rate and visit duration with a salted hash that resets every day. No cookies, no banner, and the method is published.',
  drawing: visitorsCard + handled("Salt rotated at midnight · yesterday's visitors can't be linked"),
}) + feature({
  id: 'sources', eyebrow: 'Sources and pages', title: 'See where they <br>came from.', flip: true,
  body: 'Sources, pages, campaigns, countries, devices and browsers, live and over any period, with filters and comparisons.',
  drawing: sourcesCard + handled('android-app://com.slack.android grouped as Slack'),
})
