// 10 · The closing: the swallow glides over the evening cloud sea, where the
// trail ends behind its tail. The copy and the two chips are HTML over a clean plate.
import { runButton } from '../shell'
import { n, weekVisitors } from './data'
import { icons } from './icons'
import { art, bend, skyCard } from './parts'

export const closing = () => `<section class="closing" aria-labelledby="closing-title">${art('closing', { width: 1536, height: 1024 })}`
  + `<div class="closing-copy"><h2 id="closing-title">See your site clearly.</h2><p class="closing-sub">Open source website analytics without cookies.</p><div class="closing-actions">${runButton()}<a class="text-link" href="/docs">Read the docs</a></div><p class="closing-note">100% free and open source, MIT licensed.</p></div>`
  + `<figure class="sky sky-closing" aria-label="Juniper Coffee's week">${skyCard('report', { x: 345, y: 525, w: 390, r: 0 }, `<div class="sky-row"><span class="handled-check">${icons.check}</span><span><b>Mon, Oct 19</b><span class="sep">·</span><b>Weekly report sent</b> <span class="tick-gold">${icons.tick}</span></span></div>`)}`
  + `${skyCard('visits', { x: 346, y: 600, w: 312, r: 0 }, `<div class="sky-row">${icons.bars}<span>Last week<span class="sep">·</span><b>${n(weekVisitors)} visitors</b></span></div>`)}</figure>`
  + `${bend(1000, 'closing-in')}${bend(1010, 'closing-high')}${bend(1020, 'closing-low')}${bend(1030, 'closing-tail')}</section>`
