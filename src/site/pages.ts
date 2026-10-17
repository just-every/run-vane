// The run site `rer build --site` writes: the homepage with its Run action,
// /run, the docs, the not-found page and the public files they use. Every Run
// page string and command is in run.json; nothing here reads installation data.
import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild } from '../base/run-site'
import { identity } from '../identity'
import { documentationPages } from './docs/pages'
import { landingPage } from './landing/page'
import run from './run.json'

// Base owns the Run page's command contract; the edition adds its favicons and theme.
const siteStyle = (html: string) => html
  .replace(/<link rel="icon" href="[^"]*">/, '<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/brand/favicon-32.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">')
  .replace('</head>', '<link rel="stylesheet" href="/site/run.css"></head>')

export function sitePages(): SiteBuild {
  const data: RunData = run
  return {
    pages: [
      { path: '/', html: landingPage() },
      { path: '/run', html: siteStyle(runPageHtml(identity, data)) },
      ...documentationPages(),
      { path: '/404', html: siteStyle(siteNotFoundHtml(identity, data)) },
    ],
    assets: ['rer-theme.css', 'fonts', 'brand', 'site', 'favicon.ico', 'apple-touch-icon.png'],
  }
}
