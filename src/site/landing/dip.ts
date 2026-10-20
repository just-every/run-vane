// 04 · Tue, Oct 13, 2:12 pm: signups stop on /pricing. The agent finds the
// missing script, ships the fix in #218 and the day still ends at 212.
import { signupsChart } from './charts'
import { signupsToday } from './data'
import { icons } from './icons'
import { bend, card, head, trailDot } from './parts'

const log = [
  ['red', '2:31 pm', '/pricing sent no page loads after the 2:12 pm deploy; every other page normal'],
  ['blue', '2:32 pm', 'Hacker News traffic steady: not a demand drop'],
  ['blue', '2:40 pm', 'Cause: the new pricing layout dropped the Vane script, so the signup form on /pricing sent nothing'],
  ['gold', '3:05 pm', 'Shipped pull request #218 · restore the script on /pricing'],
  ['green', '11:59 pm', `<b class="gold">${signupsToday} signups today</b> <span class="tick-green">${icons.tick}</span>`],
] as const

const agent = card('Why signups moved on Tue, Oct 13', '<header class="why-head"><p class="why-label">Why it moved</p><p class="agent-pill">Agent</p></header><h3 class="why-title">No signups recorded from 2:12 pm</h3>'
  + `${signupsChart()}<ol class="log">${log.map(([tone, time, text]) => `<li class="log-${tone}"><span class="log-dot" aria-hidden="true"></span><p><b class="log-time">${time}</b><span class="sep">·</span><span>${text}</span></p></li>`).join('')}</ol>`, 'card-why')

const fix = `<figure class="code-card" aria-label="The fix in pull request #218"><p>pricing.tsx · #218</p><pre><code>+ ${'&lt;script defer src="/vane.js"&gt;&lt;/script&gt;'}</code></pre></figure>`

export const dip = () => `<section class="story dip" id="dip" aria-labelledby="dip-title"><div class="col dip-grid">${agent}`
  + `<header class="story-head">${head('dip', 'Tue, Oct 13 · 2:12 pm', 'Signups dipped. <br>Vane found why.', 'The agent checks your tracking, your traffic and the site itself, ships the fix and measures the result.')}</header>${fix}</div>`
  + `${trailDot(410, 'hollow', 'dot-dip')}${bend(420, 'dip-card')}${bend(430, 'dip-out')}${bend(440, 'dip-low')}</section>`
