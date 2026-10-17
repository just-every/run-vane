// The run site `rer build --site` writes: the homepage with its Run action,
// /run, the docs, /contract from CONTRACT.md, the not-found page and the public files they use. Every Run
// page string and command is in run.json; nothing here reads installation data.
import { contractPageHtml } from '../base/contract-page'
import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { documentationPages } from './docs/pages'
import { landingPage } from './landing/page'
import run from './run.json'

// Base owns the Run page's command contract; the edition adds its favicons and theme.
const siteIcons = (html: string) => html
  .replace(/<link rel="icon" href="[^"]*">/, '<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/brand/favicon-32.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">')
const siteStyle = (html: string) => siteIcons(html)
  .replace('</head>', '<link rel="stylesheet" href="/site/run.css"></head>')

export function sitePages({ contract }: Partial<SiteContext> = {}): SiteBuild {
  const data: RunData = run
  return {
    pages: [
      { path: '/', html: landingPage() },
      { path: '/run', html: siteStyle(runPageHtml(identity, data, contract)) },
      ...(contract ? [{ path: '/contract', html: siteIcons(contractPageHtml(identity, data, contract)) }] : []),
      ...documentationPages(),
      { path: '/404', html: siteStyle(siteNotFoundHtml(identity, data, contract)) },
    ],
    assets: ['rer-theme.css', 'fonts', 'brand', 'site', 'favicon.ico', 'apple-touch-icon.png'],
  }
}
