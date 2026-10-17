// Page 09: the harbor at sunset, the last call to run Vane, and the footer.
import { runButton } from '../shell'
import { n, today } from './data'
import { icons } from './icons'
import { art, skyCard } from './parts'


export const closing = () => `<section class="closing" aria-labelledby="closing-title">${art('closing', { width: 1536, height: 944 })}`
  + `<div class="closing-copy"><h2 id="closing-title">See your site clearly.</h2><p class="closing-sub">Open source website analytics without cookies.</p><div class="closing-actions">${runButton()}<a class="text-link" href="/docs">Read the docs</a></div><p class="closing-note">Free and open source, MIT licensed.</p></div>`
  + `<figure class="sky sky-closing" aria-label="Today on Juniper Coffee">${skyCard('visits', { x: 1018, y: 517, w: 220, r: -3.5 }, `<div class="sky-row">${icons.bars}<span>Today · <strong>${n(today)}</strong> visitors</span></div>`)}`
  + `${skyCard('report', { x: 1353, y: 514, w: 220, r: -3.5 }, `<div class="sky-row"><span class="handled-check">${icons.check}</span><span>Weekly report sent <span class="tick-inline">${icons.tick}</span></span></div>`)}</figure></section>`
