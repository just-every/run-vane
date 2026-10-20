// 09 · Every day: how a visitor is counted. Four inputs hash into today's
// visitor id; at midnight Eastern the salt is replaced, so the same person gets
// a new id and days can't be linked (METRIC-001).
import { site } from './data'
import { icons } from './icons'
import { bend, head, trailDot } from './parts'

const inputs = [[icons.key, 'Salt · Tue, Oct 13'], [icons.globe, site], [icons.pin, '203.0.113.24'], [icons.laptop, 'Safari · macOS']]
const join = '<svg class="hash-join" viewBox="0 0 40 240" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30H14C26 30 26 40 26 60V100C26 116 30 120 40 120M0 98C16 98 26 104 26 120M0 166C16 166 26 160 26 140M0 234H14C26 234 26 224 26 204V140C26 124 30 120 40 120" fill="none" stroke="#2556e8" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>'
const arrow = '<svg class="hash-arrow" viewBox="0 0 48 14" aria-hidden="true"><path d="M0 7h44M38 1.5 44.5 7 38 12.5" fill="none" stroke="#2556e8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'

const diagram = '<figure class="hash" aria-label="How a visitor is counted: a salt, the site, the IP address and the browser become a visitor id that is counted once a day; at midnight a new salt makes a new id">'
  + `<ul class="hash-inputs">${inputs.map(([icon, label]) => `<li>${icon}<span>${label}</span></li>`).join('')}</ul>${join}`
  + `<p class="hash-id"><code>visitor a91f…3c07</code></p>${arrow}<p class="hash-counted"><span class="ring-gold">${icons.ring}</span>Counted once today</p>`
  + '<div class="hash-night"><p class="night-label">12:00 am ET · new salt</p><p class="salt-old"><s>Salt · Tue, Oct 13</s></p><p class="salt-new">Salt · Wed, Oct 14</p><svg class="night-down" viewBox="0 0 14 46" preserveAspectRatio="none" aria-hidden="true"><path d="M7 0v44M1.5 38.5 7 44.5l5.5-6" fill="none" stroke="#2556e8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg><p class="hash-id next-id"><code>visitor 7e20…b915</code></p><p class="night-note">same person, new id: days can\'t be linked</p></div></figure>'

const owned = [[icons.account, 'Your own account'], [icons.shieldLine, 'No third-party analytics processor'], [icons.download, 'Export to CSV or your warehouse']]

export const privacy = () => `<section class="story private" id="private" aria-labelledby="private-title"><div class="col">`
  + `<header class="story-head center">${head('private', 'Every day · How it counts', 'Private by design.', 'Each visit becomes a daily hash of a secret salt, your site, the IP address and the browser. <br class="wide-only">A new salt at midnight in your time zone; the old one is deleted. No cookies, no banner.')}</header>`
  + `${diagram}<p class="never">${icons.eyeOff}<span><b>Never recorded.</b> No session replays, per-visitor logs or person profiles.</span><a href="/docs/collection">Read the method <span aria-hidden="true">→</span></a></p>`
  + `<ul class="owned">${owned.map(([icon, text]) => `<li>${icon}<span>${text}</span></li>`).join('')}</ul></div>`
  + `${bend(910, 'private-in')}${trailDot(920, 'hollow', 'dot-private')}${bend(930, 'private-out')}</section>`
