import { identity } from '../identity'
import run from './run.json'

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

export const brand = () => `<a class="site-brand" href="/" aria-label="Vane home"><img src="${identity.mark}" width="24" height="24" alt=""><span>Vane</span></a>`
export function header(current?: 'docs') {
  return `<a class="skip-link" href="#main">Skip to content</a><header class="site-header wrap">${brand()}<nav aria-label="Main"><a href="/docs"${current === 'docs' ? ' aria-current="page"' : ''}>Docs</a><a href="${escapeHtml(run.repository)}">Source</a></nav></header>`
}
export const footer = () => `<footer class="site-footer wrap"><a class="footer-brand" href="/"><img src="${identity.mark}" width="20" height="20" alt=""><span>Vane · Cookie-free website analytics</span></a><nav aria-label="Footer"><a href="/docs">Docs</a><a href="${escapeHtml(run.repository)}">Source</a><a href="${escapeHtml(run.repository)}/blob/main/LICENSE">MIT licensed</a></nav></footer>`
export const actions = () => '<div class="site-actions"><a class="site-pill" href="/run">Run Vane <span aria-hidden="true">→</span></a><a class="site-pill" href="https://demo.run-vane.com/">Try the demo <span aria-hidden="true">→</span></a><a class="site-link" href="/docs">Read the docs</a></div>'

export function document(title: string, description: string, body: string, script = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="icon" href="${identity.mark}"><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="${identity.theme}"><link rel="stylesheet" href="/vane-site.css"></head><body class="vane-site">${body}${script ? `<script>${script}</script>` : ''}</body></html>`
}
