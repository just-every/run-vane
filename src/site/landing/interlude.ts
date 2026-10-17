// Page 04: gulls riding a gust across open sky, with the morning's check above them.
import { goals } from './data'
import { art } from './parts'
import { icons } from './icons'

export const interlude = () => `<section class="interlude" aria-label="All goals tracking"><p class="handled handled-solo"><span class="handled-check">${icons.check}</span><span>All ${goals} goals tracking <span class="muted-dot">·</span> checked 9:00 am</span></p>${art('interlude', { width: 1536, height: 560 })}</section>`
