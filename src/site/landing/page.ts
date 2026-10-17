// The run-vane.com homepage: the design desk's nine pages, in order.
import { document, footer, header } from '../shell'
import { closing } from './closing'
import { conversions } from './conversions'
import { quietDetails } from './details'
import { hero } from './hero'
import { insight } from './insight'
import { interlude } from './interlude'
import { copyScript, ownership } from './ownership'
import { setup } from './setup'
import { traffic } from './traffic'

export const landingPage = () => document('Vane · See which way the wind blows', 'Cookie-free website analytics: unique visitors, sources, goals, funnels and revenue, reports and alerts, without a cookie banner. 100% free and open source.',
  `${header()}<main id="main">${hero()}${traffic()}${conversions()}${interlude()}${insight()}${setup()}${ownership()}${quietDetails()}${closing()}</main>${footer()}`,
  { styles: ['landing', 'cards'], script: copyScript, bodyClass: 'site landing' })
