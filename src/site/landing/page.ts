// The run-vane.com homepage: one launch week at Juniper Coffee, in the order the
// owner approved (page-s1, 17 Oct 2026): the hero, Monday's setup, launch day,
// the 2:12 pm dip, Wednesday's interlude, the orders, the searches, Monday's
// report, how it counts, and the closing.
import { document, footer, header } from '../shell'
import { closing } from './closing'
import { dip } from './dip'
import { funnel } from './funnel'
import { hero } from './hero'
import { interlude } from './interlude'
import { launch, tabsScript } from './launch'
import { monday } from './monday'
import { privacy } from './privacy'
import { report } from './report'
import { search } from './search'
import { trailScript, trailSvg } from './trail'

// Words that read as one never split across lines. A separator or arrow is glued to the words on both sides
// (also when it is its own `.sep` span); a time keeps its am/pm, a date its day, a number its unit, a range its
// ends, a pull request its "#", and a hyphenated word or path its hyphens.
const nb = '\u00a0', wj = '\u2060'
const month = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'
const units = 'visitors?|visits?|online|signups?|hits|goals|orders|subscribed|pageviews'
const rules: [RegExp, string][] = [
  [/ ([·→]) /g, `${nb}$1${nb}`],
  [/(\d) (am|pm)\b/g, `$1${nb}$2`],
  [new RegExp(`\\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(,?) (?=${month} |\\d)`, 'g'), `$1$2${nb}`],
  [new RegExp(`\\b(${month}) (\\d)`, 'g'), `$1${nb}$2`],
  [new RegExp(`(\\d[\\d,.]*%?) (${units})\\b`, 'g'), `$1${nb}$2`],
  [/\b(\d+m) (\d+s)\b/g, `$1${nb}$2`],
  [/(\d)–(\d)/g, `$1${wj}–${wj}$2`],
  [/(\w) #(\d)/g, `$1${nb}#$2`],
  [/([A-Za-z])-([A-Za-z])/g, `$1-${wj}$2`],
]
const glueText = (text: string) => rules.reduce((t, [pattern, to]) => t.replace(pattern, to), text)
const glue = (html: string) => html.replace(/ (<span class="sep">[·→]<\/span>)/g, `${nb}$1`).replace(/(<span class="sep">[·→]<\/span>) /g, `$1${nb}`).replace(/>([^<]+)</g, (_, text: string) => `>${glueText(text)}<`)

export const landingPage = () => document('Vane · See which way the wind blows', 'Cookie-free website analytics: unique visitors, sessions, bounce and duration, real-time and historical traffic, goals, funnels and revenue, scheduled reports and alerts, without a cookie banner. 100% free and open source.',
  glue(`${header()}<main id="main">${hero()}${monday()}${launch()}${dip()}${interlude()}${funnel()}${search()}${report()}${privacy()}${closing()}${trailSvg}</main>${footer()}`),
  { styles: ['landing', 'cards', 'results'], script: `${tabsScript};${trailScript}`, bodyClass: 'site landing' })
