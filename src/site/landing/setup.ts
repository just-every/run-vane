// Page 06: install on any site, then bring history across. Platforms are plain
// lettered tiles, never their trademarks.
import { escapeHtml } from '../shell'
import { goals, n, site } from './data'
import { icons } from './icons'
import { card, feature, handled } from './parts'

const platforms = [['WordPress', 'W', true], ['Shopify', 'S', true], ['Webflow', 'Wf', false], ['Squarespace', 'Sq', false]] as const
const installCard = card(`Install on ${site}`, `<header class="card-head"><p class="card-title">Install · ${site}</p></header><pre class="snippet"><code>${escapeHtml('<script defer src="/stats/v.js"></script>')}</code></pre>`
  + `<ul class="platforms">${platforms.map(([name, letters, used]) => `<li><span class="tile tile-plain" aria-hidden="true">${letters}</span><p>${name} <span class="${used ? 'state-on' : 'muted'}">· ${used ? 'connected' : 'not used'}</span></p><span class="${used ? 'state-check' : 'state-off'}">${used ? icons.check : icons.minus}</span></li>`).join('')}</ul>`, 'card-install')

const imported = [['Pageviews', n(2184302)], ['Visitors', n(611940)], ['Sources', n(1416)], ['Goals', String(goals)], ['History', 'since Mar 2022']]
const importCard = card('Importing from Plausible', '<header class="card-head"><p class="card-title">Importing from Plausible</p></header><div class="progress"><span class="bar-track"><span style="width:100%"></span></span><span>100%</span></div>'
  + `<ul class="imported">${imported.map(([label, value]) => `<li><span class="state-check">${icons.check}</span><p>${label}</p><strong>${value}</strong></li>`).join('')}`
  + `<li class="imported-note">${icons.file}<p>Jun 3–4, 2024 · overlap with Google Analytics 4 skipped</p><span class="state-check">${icons.check}</span></li></ul>`, 'card-import')

export const setup = () => feature({
  id: 'install', eyebrow: 'Install', title: 'Live on <br>any site.',
  body: 'Add one small script, or install for WordPress, Shopify, Webflow or Squarespace. A first-party proxy keeps ad blockers from erasing your numbers.',
  drawing: installCard + handled('Ad blocker on 1 in 5 visits · counted through /stats'),
}) + feature({
  id: 'move-in', eyebrow: 'Move in', title: 'Bring your <br>history with you.', flip: true,
  body: 'Import your past traffic from Google Analytics 4, Plausible, Fathom or Matomo. Your charts start full on day one.',
  drawing: importCard,
})
