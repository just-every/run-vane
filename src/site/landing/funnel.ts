// 06 · Oct 13–18: from the launch post to a paid subscription. The funnel is
// drawn to scale; each step's rate is of the step before it.
import { n, order } from './data'
import { icons } from './icons'
import { bend, card, head, trailDot } from './parts'

const steps = [['Read the launch post', 6930], ['Viewed /pricing', 2148], ['Started checkout', 704], ['Subscribed', order.subscribed]] as const
const share = (value: number) => value / steps[0][1] * 100

// The pale flow from each bar's top right to the next bar's top left, in a 400 x 100 box (each step is 100 wide, its bar 36).
const top = (i: number) => (100 - share(steps[i][1])).toFixed(2)
const flow = steps.slice(1).map((_, i) => `${i ? 'L' : 'M'}${i * 100 + 68} ${top(i)}L${i * 100 + 132} ${top(i + 1)}`).join('') + 'L332 100L68 100z'

const chart = `<div class="funnel" role="img" aria-label="${steps.map(([step, value], i) => `${step} ${n(value)}${i ? `, ${Math.round(value / steps[i - 1][1] * 100)}% of the step before` : ''}`).join('; ')}">`
  + `<svg class="funnel-flow" viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden="true"><path d="${flow}" fill="#e3eafc"/></svg>`
  + steps.map(([step, value], i) => `<div class="funnel-step${i === steps.length - 1 ? ' step-gold' : ''}"><p class="funnel-name">${step}</p><span class="funnel-bar"><span style="--w:${share(value).toFixed(1)}%;height:${share(value).toFixed(1)}%"></span></span><p class="funnel-count">${n(value)}</p><p class="funnel-rate">${i ? `${Math.round(value / steps[i - 1][1] * 100)}%` : ''}</p></div>`).join('') + '</div>'

const plans = [['plan: monthly', 71], ['plan: quarterly', 29]] as const
const sources = [['green', 'Newsletter', 607, '11.2'], ['blue', 'Hacker News', 3120, '0.9']] as const
const orders = card('Cold brew subscription funnel, Oct 13 to 18', `<h3 class="funnel-title">Cold brew subscription <span class="sep">·</span> Oct 13–18</h3>${chart}`
  + `<div class="order-split"><div class="revenue"><p class="small-label">Revenue</p><p class="revenue-total">${order.revenue}</p><ul class="plans">${plans.map(([plan, value]) => `<li><p><span>${plan}</span><span>${value}%</span></p><span class="bar-track"><span style="width:${value}%"></span></span></li>`).join('')}</ul></div>`
  + `<div class="by-source"><p class="small-label">By source</p><ul>${sources.map(([tone, name, visitors, rate]) => `<li class="source-${tone}"><span class="source-dot" aria-hidden="true"></span><p>${name}<span class="sep">·</span>${n(visitors)} visitors<span class="sep">·</span>${rate}% subscribed</p></li>`).join('')}</ul></div></div>`, 'card-funnel')

const redirect = `<p class="note-chip"><span class="dot-red" aria-hidden="true"></span><span><b>404 on /cold-bew</b><span class="sep">·</span><span class="muted">38 hits from a Reddit link → redirect added</span> <span class="tick-green">${icons.tick}</span></span></p>`

export const funnel = () => `<section class="story orders" id="orders" aria-labelledby="orders-title"><div class="col orders-grid"><header class="story-head">`
  + `${head('orders', 'Oct 13–18 · From visit to order', 'See who actually bought.', 'Funnels, revenue and custom properties show which visitors became subscribers, and where they came from.')}${redirect}</header>${orders}</div>`
  + `${bend(605, 'orders-in')}${trailDot(610, 'hollow', 'dot-orders')}${bend(620, 'orders-card')}${bend(630, 'orders-out')}</section>`
