// 07 · Sun, Oct 18: what they searched. Google's keywords for Oct 13–16 (the
// days Google has sent so far), linked to what those visitors did on the page they landed on.
import { icons } from './icons'
import { bend, byWidth, card, head, trailDot } from './parts'

const queries = [['cold brew subscription', '1,204', '3.1'], ['best cold brew concentrate', '640', '4.8'], ['juniper coffee cold brew', '412', '1.0'], ['cold brew ratio', '288', '6.2']] as const
const google = card('Google search keywords, Oct 13 to 16', `<h3>Google search <span class="sep">·</span> Oct 13–16</h3><table class="keywords"><thead><tr><th scope="col"><span class="sr-only">Linked</span></th><th scope="col">Query</th><th scope="col">Clicks</th><th scope="col">${byWidth('Position', 'Pos.')}</th></tr></thead><tbody>`
  + queries.map(([query, clicks, position], i) => `<tr${i ? '' : ' class="picked"'}><td><span class="row-dot" aria-hidden="true"></span></td><td>${query}</td><td>${clicks}</td><td>${position}${i ? '' : ` <span class="rank-up">${icons.up}5</span>`}</td></tr>`).join('')
  + '</tbody></table>', 'card-google')

const landing = card('What searchers did on /blog/cold-brew-launch', '<h3>Lands on /blog/cold-brew-launch</h3><dl class="landing-stats"><div><dt>of clicks</dt><dd>62%</dd></div><div><dt>average visit</dt><dd>1m 48s</dd></div><div class="gold-stat"><dt>subscribed</dt><dd>4.1%</dd></div></dl>', 'card-landing')

const link = '<svg class="query-link" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0C-7 42-5 90 42 92S93 95 100 100" fill="none" stroke="#2556e8" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>'

export const search = () => `<section class="story searched" id="searched" aria-labelledby="searched-title"><div class="col searched-grid"><div class="search-cards">${google}${link}${bend(725, 'searched-gap')}${landing}</div>`
  + `<header class="story-head">${head('searched', 'Sun, Oct 18 · What they searched', 'What they searched to find you.', 'Google Search Console keywords, next to the pages they landed on and what those visitors did.')}`
  + '<p class="note-chip pending"><span class="pending-ring" aria-hidden="true"></span><span><b>Oct 17–18</b><span class="sep">·</span><span class="muted">arrives at Google\'s next sync</span></span></p></header></div>'
  + `${trailDot(710, 'hollow', 'dot-searched')}${bend(705, 'searched-in')}${bend(720, 'searched-card')}${bend(730, 'searched-landing')}${bend(740, 'searched-out')}</section>`
