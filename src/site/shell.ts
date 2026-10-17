// The run site's frame: the document head, the header lockup, the footer and
// the three homepage actions. Every page of run-vane.com renders through here.
import { identity } from '../identity'
import run from './run.json'

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

export const demo = 'https://demo.run-vane.com/'
const share = `${identity.runSite}/site/share.jpg`

// The swallow beside the wordmark; `light` is the mark with its sticker ring for dark grounds.
export const lockup = (light = false) => `<a class="lockup" href="/" aria-label="Vane home"><img src="/brand/${light ? 'mark-dark' : 'mark'}.svg" width="46" height="34" alt=""><span>Vane</span></a>`

export function header(current?: 'docs') {
  return `<a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="wrap">${lockup()}<nav aria-label="Main"><a href="/docs"${current === 'docs' ? ' aria-current="page"' : ''}>Docs</a><a href="${escapeHtml(run.repository)}">Source</a></nav></div></header>`
}

export const footer = () => `<footer class="site-footer"><div class="wrap">${lockup()}<nav aria-label="Footer"><a href="/docs">Docs</a><a href="${escapeHtml(run.repository)}">Source</a><a href="${escapeHtml(run.repository)}/blob/main/LICENSE">MIT licensed</a></nav></div></footer>`

const arrow = '<span aria-hidden="true">→</span>'
export const runButton = (label = 'Run Vane') => `<a class="run-button" href="/run">${label} ${arrow}</a>`

export function document(title: string, description: string, body: string, options: { styles: string[]; script?: string; bodyClass?: string }) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="theme-color" content="#f5f9fd">`
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="Vane"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}">`
    + `<meta property="og:image" content="${share}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`
    + '<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/brand/favicon-32.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">'
    + '<link rel="preload" href="/fonts/inter-tight/inter-tight-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/inter/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>'
    + `<link rel="stylesheet" href="${identity.theme}">${['site', ...options.styles].map(name => `<link rel="stylesheet" href="/site/${name}.css">`).join('')}</head>`
    + `<body class="${options.bodyClass ?? 'site'}">${body}${options.script ? `<script>${options.script}</script>` : ''}</body></html>`
}
