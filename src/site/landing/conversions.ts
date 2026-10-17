// Page 03: goals and funnels to checkout, then reports and alerts.
import { hackerNews, n, site } from './data'
import { icons } from './icons'
import { card, feature, handled } from './parts'

// Each step's share is of the first step: 1,412 / 8,240 = 17.1%, 644 = 7.8%, 412 = 5.0%.
const funnel = [['Visited /pricing', 8240], ['Started trial', 1412], ['Added card', 644], ['Paid', 412]] as const
const funnelCard = card('Checkout funnel, last 30 days', '<header class="card-head"><p><strong>Checkout funnel</strong> · Last 30 days</p></header>'
  + `<ol class="funnel">${funnel.map(([step, count]) => { const share = count / funnel[0][1] * 100; return `<li><p>${step} <span class="muted">· ${n(count)} · ${share === 100 ? '100' : share.toFixed(1)}%</span></p><span class="bar-track"><span style="width:${Math.max(share, 4.6).toFixed(1)}%"></span></span></li>` }).join('')}</ol>`
  + `<p class="revenue"><strong>Revenue · $38,108.40</strong><span class="delta">${icons.up}9%</span></p>`, 'card-funnel')

const toggle = '<span class="toggle" aria-hidden="true"><span></span></span><span class="toggle-label">On</span>'
const alertsCard = card('A traffic spike alert, the weekly report and the public stats page', `<div class="alert"><span class="alert-icon">${icons.bell}</span><div><p class="alert-title">Traffic spike · ${hackerNews.post}</p><p class="muted">Fri, Oct 16 · 9:14 am</p><p class="alert-body">${n(hackerNews.lastHour)} visitors in the last hour · 6x usual<br>Top source: Hacker News</p></div></div>`
  + `<ul class="settings"><li>${icons.mail}<p>Weekly report <span class="muted">· Mondays 8:00 am · 4 recipients</span></p>${toggle}</li><li>${icons.link}<p>Public stats page <span class="muted">· ${site}/stats</span></p>${toggle}</li></ul>`, 'card-alerts')

const redDot = '<span class="handled-lead"><span class="dot-red" aria-hidden="true"></span><svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg></span>'

export const conversions = () => feature({
  id: 'goals', eyebrow: 'Goals and funnels', title: 'Follow them to <br>checkout.',
  body: 'Goals, funnels and revenue with real order values, custom event properties, and outbound links, file downloads and 404s tracked on their own.',
  drawing: funnelCard + handled('404 · /pricng · 37 visits · redirect to /pricing added', redDot),
}) + feature({
  id: 'reports', eyebrow: 'Reports and alerts', title: 'Hear it first.', flip: true,
  body: 'Scheduled email reports, spike and drop alerts, shared dashboards for your team, and a public page when you want one.',
  drawing: alertsCard + handled('Saturday 2–3 am drop held <span class="muted">· scheduled maintenance</span>'),
})
