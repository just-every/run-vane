// 03 · Tue, Oct 13: the launch lands. The spike alert in #marketing, then the
// day's live chart with its three pins, and where the visitors came from.
import { onlineChart } from './charts'
import { hackerNews, n, onlineNow, site, today } from './data'
import { icons, swallow } from './icons'
import { bend, byWidth, card, head, trailDot } from './parts'

const slack = card('The spike alert in Slack', `<p class="channel"><span class="channel-hash">${icons.hash}</span>#marketing</p><div class="message"><span class="avatar">${swallow(34)}</span><div><p><strong>Vane</strong> <span class="muted">9:41 am</span></p>`
  + `<p>${byWidth('Traffic spike on /blog/cold-brew-launch · 3.4× a usual Tuesday · first source Hacker News.', 'Traffic spike on /blog/cold-brew-launch · 3.4× a usual Tuesday.')}</p></div></div>`, 'card-slack')

// Each list sums to the day: sources and countries to 4,812 visitors, pages are visitors per page.
const lists = [
  ['sources', 'Sources', [['Hacker News', hackerNews.today], ['Google', 1288], ['Direct', 702], ['Newsletter', 540], ['Reddit', 378]]],
  ['pages', 'Top pages', [['/blog/cold-brew-launch', 3206], ['/pricing', 1140], ['/', 866]]],
  ['countries', 'Countries', [['United States', 52], ['Germany', 9], ['United Kingdom', 8]]],
] as const
const list = ([id, title, rows]: typeof lists[number]) => {
  const top = rows[0][1], percent = id === 'countries'
  return `<section class="breakdown" id="launch-${id}" role="tabpanel" aria-labelledby="launch-tab-${id}"><h3>${title}</h3><ul class="bars">${rows.map(([name, value]) => `<li><span class="bar-name">${name}</span><span class="bar-value">${percent ? `${value}%` : n(value)}</span><span class="bar-track"><span style="width:${(percent ? value : value / top * 75).toFixed(1)}%"></span></span></li>`).join('')}</ul></section>`
}
const tabs = `<div class="tabs" role="tablist" aria-label="Breakdowns">${lists.map(([id, title], i) => `<button type="button" role="tab" id="launch-tab-${id}" aria-controls="launch-${id}" aria-selected="${i === 0}">${title.replace('Top pages', 'Pages')}</button>`).join('')}</div>`

const live = card(`${site} on Tue, Oct 13`, `<header class="live-head"><p><strong>${site}</strong> · Tue, Oct 13</p><p class="live"><span class="live-dot" aria-hidden="true"></span>${onlineNow} online now</p></header>${onlineChart()}`
  + `<div class="breakdowns">${tabs}${lists.map(list).join('')}</div><p class="day-total">${n(today)} visitors today</p>`, 'card-live')

export const launch = () => `<section class="story launch" id="launch-day" aria-labelledby="launch-day-title"><div class="col">`
  + `<div class="launch-top"><header class="story-head">${head('launch-day', 'Tue, Oct 13 · Launch day', 'Watch the launch land.', 'Visitors, sources and pages as they happen, with an alert the moment traffic spikes.')}</header>${slack}${trailDot(310, 'hollow', 'dot-launch')}</div>${live}</div>`
  + `${bend(320, 'launch-card')}${bend(330, 'launch-out')}</section>`

// On a phone the three lists become tabs; without script all three stay listed.
export const tabsScript = "document.querySelectorAll('.breakdowns').forEach(box=>{const tabs=[...box.querySelectorAll('[role=tab]')];box.classList.add('tabbed');const show=tab=>tabs.forEach(t=>{const on=t===tab;t.setAttribute('aria-selected',on);t.tabIndex=on?0:-1;document.getElementById(t.getAttribute('aria-controls')).classList.toggle('shown',on)});tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>show(tab));tab.addEventListener('keydown',e=>{const k={ArrowRight:1,ArrowLeft:-1}[e.key];if(k){const next=tabs[(i+k+tabs.length)%tabs.length];show(next);next.focus()}})});show(tabs[0])})"
