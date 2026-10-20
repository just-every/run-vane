// Page 01: the weather vane in an open sky, with the day's traffic drawn as
// wind. The copy and the six cards are HTML over a clean plate of the painting;
// cards and the dots on the wind sit at the desk's positions in 1536 x 1024
// units (--x, --y center; --w width; --r tilt), so they stay on the wind at
// every desktop width.
import { runButton, demo } from '../shell'
import { hackerNews, lastTuesday, n, signupsToday, today } from './data'
import { icons } from './icons'
import { art, skyCard } from './parts'


const spark = '<svg class="sky-spark" viewBox="0 0 196 52" aria-hidden="true"><defs><linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d58f0" stop-opacity=".18"/><stop offset="1" stop-color="#1d58f0" stop-opacity="0"/></linearGradient></defs><path d="M2 44C14 40 22 30 34 33s20 9 32 1 18-17 30-13 16 15 26 14 18-12 30-17 18-1 26-6 10-10 14-12V52H2z" fill="url(#spark-fill)"/><path d="M2 44C14 40 22 30 34 33s20 9 32 1 18-17 30-13 16 15 26 14 18-12 30-17 18-1 26-6 10-10 14-12" fill="none" stroke="#3b78f2" stroke-width="2.2" stroke-linecap="round"/><circle cx="122" cy="35" r="3.2" fill="#1d58f0"/><circle cx="192" cy="2.6" r="3.2" fill="#1d58f0"/></svg>'

// Leaders from each card down to its dot on the wind; the pink dot is the dip.
const wind = '<svg class="sky-wind" viewBox="0 0 1536 1024" preserveAspectRatio="none" aria-hidden="true"><g stroke="#fff" stroke-width="1.6" stroke-dasharray="4 4" opacity=".9"><path d="M733 541v24"/><path d="M906 391l20 38"/><path d="M1085 347v17"/><path d="M1310 293v10"/></g>'
  + '<g fill="#fff"><circle cx="928" cy="436" r="11" opacity=".35"/><circle cx="1084" cy="371" r="11" opacity=".35"/><circle cx="1310" cy="288" r="11" opacity=".35"/><circle cx="928" cy="436" r="6.5"/><circle cx="1084" cy="371" r="6.5"/><circle cx="1310" cy="288" r="6.5"/></g>'
  + '<circle cx="733" cy="572" r="9" fill="#fff"/><circle cx="733" cy="572" r="6.5" fill="#f0506e"/></svg>'

const cards = [
  skyCard('dip', { x: 715, y: 485, w: 198, r: -5.2 }, '<p class="sky-date">Tue, Oct 13</p><p class="sky-text">Tuesday dip: tracking script missing on /pricing · fixed</p>'),
  skyCard('source', { x: 884, y: 344, w: 176, r: -5.5 }, `<p class="sky-label">Top source</p><div class="sky-row"><span class="tile tile-orange" aria-hidden="true">HN</span><p class="sky-stack"><strong>Hacker News</strong><span>${n(hackerNews.today)} visitors</span></p></div>`),
  skyCard('goal', { x: 1090, y: 301, w: 173, r: -5 }, `<p class="sky-label">Goal · Signups</p><div class="sky-row"><span class="tile tile-green" aria-hidden="true">${icons.usersSolid}</span><strong class="sky-num">${signupsToday}</strong><span class="delta">${icons.up}4.4%</span></div>`),
  skyCard('today', { x: 1310, y: 208, w: 228, r: -4.5 }, `<p class="sky-label">Visitors today</p><div class="sky-row"><strong class="sky-big">${n(today)}</strong><span class="delta delta-big">${icons.up}${Math.round((today / lastTuesday - 1) * 100)}%</span></div>${spark}`),
  skyCard('why', { x: 1393, y: 347, w: 184, r: -3.8 }, `<div class="sky-row sky-row-top">${icons.bulb}<p class="sky-stack"><span class="sky-label">Why it moved</span><strong>Launch post on Hacker News</strong></p></div>`),
  skyCard('cookies', { x: 1381, y: 453, w: 216, r: 0 }, `<div class="sky-row">${icons.shield}<span>No cookies · no banner</span></div>`),
].join('')

export const hero = () => `<section class="hero" aria-labelledby="hero-title">${art('hero', { width: 1536, height: 1024 }, true)}`
  + '<div class="wrap hero-copy"><h1 id="hero-title">See which way <br>the wind blows.</h1>'
  + '<p class="hero-sub">Vane counts your visitors without cookies, shows where they came from and what they did, and tells you why the numbers moved.</p>'
  + '<p class="hero-alt">100% free, open source alternative to <strong>Plausible</strong>, <strong>Fathom</strong> and <strong>Matomo</strong></p>'
  + `<div class="hero-actions">${runButton()}<a class="text-link" href="${demo}">Try the demo</a><a class="text-link" href="/docs">Read the docs</a></div></div>`
  + `<figure class="sky" aria-label="A day of traffic on Juniper Coffee's website">${wind}${cards}</figure></section>`
