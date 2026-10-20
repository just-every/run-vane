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

// A separator or arrow between words never starts or ends a line: it is glued to the words on both sides.
const glue = (html: string) => html.replace(/>([^<]+)</g, (_, text: string) => `>${text.replace(/ ([·→]) /g, '\u00a0$1\u00a0')}<`)

export const landingPage = () => document('Vane · See which way the wind blows', 'Cookie-free website analytics: unique visitors, sessions, bounce and duration, real-time and historical traffic, goals, funnels and revenue, scheduled reports and alerts, without a cookie banner. 100% free and open source.',
  glue(`${header()}<main id="main">${hero()}${monday()}${launch()}${dip()}${interlude()}${funnel()}${search()}${report()}${privacy()}${closing()}${trailSvg}</main>${footer()}`),
  { styles: ['landing', 'cards', 'results'], script: `${tabsScript};${trailScript}`, bodyClass: 'site landing' })
