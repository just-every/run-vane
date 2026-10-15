import { actions, document, footer, header } from '../shell'
import { heroDrawing, included } from './drawings'
import { featureSections } from './sections'

// Integrated from the approved HERO-PICK 12ui conversion. SPEC governs the
// typography, shared vector band, mobile stack and exact lower-page content.
export function landingPage() {
  return document('Vane — See where your visits come from', 'Cookie-free website analytics. One script tag counts page loads, sources, campaigns and goals. 100% free and open source.', `${header()}<main id="main"><section class="site-hero" aria-labelledby="hero-title"><div class="hero-chart" aria-hidden="true"></div><div class="hero-copy wrap"><h1 id="hero-title">See where your visits come from.</h1><p class="hero-subhead">Vane counts page loads, sources, campaigns and goals with one script tag, and no cookies.</p><p class="hero-alternative">100% free, open source alternative to <strong>Google Analytics</strong>, <strong>Plausible</strong> and <strong>Fathom</strong></p>${actions()}<p class="hero-licence">Free and open source, MIT licensed.</p></div>${heroDrawing()}</section>${featureSections()}${included()}<section class="site-closing"><div class="wrap"><h2>Know where they came from.</h2>${actions()}</div></section></main>${footer()}`)
}
