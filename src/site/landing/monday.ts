// 02 · Mon, Oct 12: the import, the script and the goals, each stamped with the
// time it finished; the trail carries a gold dot over each time.
import { n } from './data'
import { icons } from './icons'
import { bend, card, check, head, trailDot } from './parts'

const imported = [['Pageviews', n(1284610)], ['Sources', n(6402)], ['Goals', '9'], ['History since', 'Mar 2023']]
const importCard = card('Import from Plausible, finished', '<h3>Import from Plausible.</h3><div class="progress"><span class="bar-track"><span style="width:100%"></span></span><span>100%</span></div>'
  + `<ul class="rows">${imported.map(([label, value]) => `<li>${check(label)}<strong>${value}</strong></li>`).join('')}</ul>`
  + '<p class="imported-note"><span class="grey-dot" aria-hidden="true"></span>Mar 2023 – Oct 11 · labelled as imported on charts</p>', 'card-step')

const scriptCard = card('The script, added', `<h3>Add the script.</h3><pre class="snippet"><code>${'&lt;script defer src=&quot;/vane.js&quot;&gt;&lt;/script&gt;'}</code></pre>`
  + `<ul class="rows rows-loose"><li>${check('Shopify · connected')}</li><li>${check('Served from your own domain')}</li><li><span class="state-dot" aria-hidden="true"></span><span>First page load</span><strong>10:42 am</strong></li></ul>`, 'card-step')

const goalRows = [[icons.cart, 'Subscribed · revenue in USD', ''], [icons.user, 'Signup · form on /pricing', '<span class="tag">custom event</span>'], [icons.outbound, 'Outbound links · automatic', ''], [icons.file, 'File downloads · automatic', ''], [icons.warning, '404 pages · automatic', '']]
const goalsCard = card('Goals, named', `<h3>Name your goals.</h3><ul class="goal-rows">${goalRows.map(([icon, text, tag]) => `<li>${icon}<span>${text}</span>${tag}</li>`).join('')}</ul>`, 'card-step')

const step = (order: number, time: string, what: string, drawing: string) => `<li class="setup-step">${trailDot(order, 'gold')}<p class="time-chip"><b>${time}</b><span class="sep">·</span>${what}</p>${drawing}</li>`

export const monday = () => `<section class="story monday" id="before-launch" aria-labelledby="before-launch-title">${bend(200, 'in')}<div class="col">`
  + `<header class="story-head center">${head('before-launch', 'Mon, Oct 12 · Before the launch', 'Ready before launch day.', 'Bring your history from Plausible, add one script, and name the goals that matter.')}</header>`
  + `<div class="setup-wrap">${bend(205, 'setup-left')}<ol class="setup">${step(210, '9:20 am', 'import done', importCard)}${step(220, '10:42 am', 'first page load', scriptCard)}${step(230, '11:05 am', 'goals named', goalsCard)}</ol>${bend(240, 'setup-right')}</div></div>`
  + `${bend(245, 'monday-turn')}${bend(250, 'monday-out')}</section>`
