// 08 · Mon, Oct 19: the weekly report arrives on its own. The email, the
// public stats page with the week's sparkline, and the same numbers from the Stats API.
import { weekSparkline } from './charts'
import { hackerNews, n, order, site, weekVisitors } from './data'
import { icons, swallow } from './icons'
import { bend, byWidth, card, head, trailDot } from './parts'

const stats = [['Unique visitors', n(weekVisitors), `<span class="delta">${icons.up}38%</span>`], ['Visits', '29,115', ''], ['Bounce rate', '41%', ''], ['Visit duration', '1m 52s', '']]
// Each row and the phone plan's shorter wording of it.
const fixed = `<b class="gold">fixed in #218 <span class="tick-inline">${icons.tick}</span></b>`
const moved = [
  ['blue', `Launch post on Hacker News · ${n(hackerNews.week)} visitors`, 'Launch post on Hacker News'],
  ['coral', `Tracking gap on /pricing, Tue 2:12–3:05 pm · ${fixed}`, `Tracking gap on /pricing · ${fixed}`],
  ['green', 'Newsletter readers subscribe at 11.2% · resend to non-openers drafted for Thu 9:00 am', 'Resend to non-openers drafted for Thu 9:00 am'],
]
const email = card('The weekly report email', `<header class="mail-head"><span class="avatar">${swallow(40)}</span><p><span>From Vane</span><span class="muted">To the Juniper team · Mon 8:00 am</span></p></header>`
  + `<h3 class="title-split">${site}<span class="sep">·</span><span class="keep">Week of Oct 12</span></h3><dl class="mail-stats">${stats.map(([label, value, extra]) => `<div><dt>${label}</dt><dd>${value}</dd>${extra}</div>`).join('')}</dl>`
  + `<p class="subs"><span class="small-label">Subscriptions</span><span class="subs-total">${order.subscribed} <span class="sep">·</span> <b class="gold">${order.revenue}</b></span></p>`
  + `<p class="moved-title">What moved</p><ul class="moved">${moved.map(([tone, wide, phone]) => `<li class="moved-${tone}"><span class="moved-dot" aria-hidden="true"></span><p>${byWidth(wide, phone)}</p></li>`).join('')}</ul>`, 'card-mail')

const pages = [['/blog/cold-brew-launch', 6930], ['/pricing', 3512], ['/', 2104]] as const
const publicPage = card('The public stats page', `<header class="browser-bar"><span class="browser-dots" aria-hidden="true"><i></i><i></i><i></i></span><p>stats.${site}</p><span class="public-pill">Public</span></header>`
  + `<div class="public-body"><p class="small-label"><span>Visitors</span><span class="sep">·</span><span class="muted">last 7 days</span></p><p class="public-total">${n(weekVisitors)}</p>${weekSparkline()}`
  + `<p class="small-label top-pages">Top pages</p><ul class="page-rows">${pages.map(([path, value]) => `<li><span>${path}</span><span>${n(value)}</span></li>`).join('')}</ul><p class="indexing">Search engines · not indexed</p></div>`, 'card-public')

const api = '<figure class="code-card api-card" aria-label="The same week from the Stats API"><p class="api-title">Stats API</p><pre><code><span class="verb">GET</span> /api/v1/stats?site_id=jc&amp;period=7d\n'
  + `{ <span class="key">"results"</span>: { <span class="key">"visitors"</span>: <span class="num">${weekVisitors}</span>,\n  <span class="key">"visits"</span>: <span class="num">29115</span>, <span class="key">"bounce_rate"</span>: <span class="num">41</span> } }</code></pre></figure>`

export const report = () => `<section class="story report" id="report" aria-labelledby="report-title"><div class="col report-grid"><header class="story-head">`
  + `${head('report', 'Mon, Oct 19 · The weekly report', 'Monday\'s report, already sent.', 'A scheduled email for your team: the numbers, what moved them, and what the agent changed.')}</header><div class="mail-wrap">${email}${trailDot(840, 'gold', 'dot-report')}</div><div class="report-side">${publicPage}${api}</div></div>`
  + `${bend(810, 'report-in')}${bend(820, 'report-side')}${bend(830, 'report-under')}${bend(850, 'report-out')}</section>`
