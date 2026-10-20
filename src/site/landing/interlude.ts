// 05 · Wed, Oct 14: a band of morning cloud sea. The trail runs through it,
// and the morning check stands on a stem over its gold dot.
import { goals } from './data'
import { icons } from './icons'
import { art, bend, trailDot } from './parts'

export const interlude = () => `<section class="interlude" aria-label="Wed, Oct 14, 9:00 am: all ${goals} goals tracking">${art('interlude', { width: 1536, height: 400 })}${bend(500, 'interlude-in')}${bend(505, 'interlude-loop')}${bend(507, 'interlude-under')}`
  + `<div class="morning"><p class="morning-chip"><span class="handled-check">${icons.check}</span><b class="stamp">Wed, Oct 14 · 9:00 am</b><span class="sep">·</span><span>All ${goals} goals tracking</span></p><span class="stem" aria-hidden="true"></span>${trailDot(510, 'gold', 'dot-morning')}</div>`
  + `${bend(520, 'interlude-out')}</section>`
