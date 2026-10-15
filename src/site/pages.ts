// The run site `rer build --site` writes: the homepage with its Run action,
// /run, the not-found page and the public files they use. Every Run page
// string and command is in run.json; nothing here reads installation data.
import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild } from '../base/run-site'
import { identity } from '../identity'
import { documentationPages } from './docs/pages'
import { landingPage } from './landing/page'
import run from './run.json'

// Base owns the Run page's command contract; the edition adds only its theme.
const siteStyle = (html: string) => html.replace('</head>', '<link rel="stylesheet" href="/vane-site.css"></head>').replace('<body>', '<body class="vane-site base-site">')

export function sitePages(): SiteBuild {
  const data: RunData = run
  return {
    pages: [
      { path: '/', html: landingPage() },
      { path: '/run', html: siteStyle(runPageHtml(identity, data)) },
      ...documentationPages(),
      { path: '/404', html: siteStyle(siteNotFoundHtml(identity, data)) },
    ],
    assets: ['rer-theme.css', 'vane-site.css', 'fonts', 'brand'],
  }
}
