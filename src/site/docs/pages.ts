import { document, escapeHtml, footer, header } from '../shell'
import { docHref, docsPages } from './manifest'
import { renderDocs, type Article } from './render'

function navigation(current?: string) {
  return [...new Set(docsPages.map(page => page.section))].map(section => `<div class="docs-nav-group"><p>${section}</p>${docsPages.filter(page => page.section === section).map(page => `<a href="${docHref(page.slug)}"${current === page.slug ? ' aria-current="page"' : ''}>${page.title}</a>`).join('')}</div>`).join('')
}
const copyScript = `if(navigator.clipboard){document.querySelectorAll('.docs-copy').forEach(button=>{button.hidden=false;button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(button.closest('.docs-code').querySelector('code').textContent);button.textContent='Copied';setTimeout(()=>button.textContent='Copy',1600)}catch{button.textContent='Select code to copy'}})})}`

function articlePage(article: Article, index: number) {
  const { page, html, headings } = article
  const toc = headings.filter(heading => heading.depth === 2).map(heading => `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a>`).join('')
  const neighbours = [docsPages[index - 1], docsPages[index + 1]].map((other, position) => other ? `<a href="${docHref(other.slug)}"><small>${position ? 'Next' : 'Previous'}</small><span>${other.title} <span aria-hidden="true">${position ? '→' : '←'}</span></span></a>` : '<span></span>').join('')
  return document(`${page.title} · Vane docs`, page.summary, `${header('docs')}<div class="docs-layout wrap"><aside class="docs-sidebar"><nav aria-label="Documentation">${navigation(page.slug)}</nav></aside><main id="main" class="docs-main"><details class="docs-mobile-nav"><summary>Documentation</summary><nav aria-label="Documentation pages">${navigation(page.slug)}</nav></details><article><header class="docs-page-heading"><p class="eyebrow">${page.section}</p><h1>${page.title}</h1></header>${toc ? `<details class="docs-mobile-toc"><summary>On this page</summary><nav>${toc}</nav></details>` : ''}<div class="docs-prose">${html}</div></article><nav class="docs-pager" aria-label="Adjacent documentation">${neighbours}</nav></main><aside class="docs-toc"><nav aria-label="On this page"><p>On this page</p>${toc}</nav></aside></div>${footer()}`, copyScript)
}

export function documentationPages() {
  const articles = renderDocs()
  const index = document('Documentation · Vane', 'Set up Vane, understand your reports and keep your analytics portable.', `${header('docs')}<main id="main" class="docs-index wrap"><p class="eyebrow">Documentation</p><h1>A clear view of your website.</h1><p class="docs-intro">Add your website, understand the counts, and keep your history yours.</p><a class="site-pill" href="/docs/getting-started">Your first website <span aria-hidden="true">→</span></a><div class="docs-index-grid">${docsPages.map(page => `<a class="docs-index-card" href="${docHref(page.slug)}"><p class="eyebrow">${page.section}</p><h2>${page.title} <span aria-hidden="true">→</span></h2><p>${page.summary}</p></a>`).join('')}</div></main>${footer()}`)
  return [{ path: '/docs', html: index }, ...articles.map((article, i) => ({ path: docHref(article.page.slug), html: articlePage(article, i) }))]
}
