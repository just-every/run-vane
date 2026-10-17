// /docs and one page per guide, built from the repository's Markdown in the landing's look.
import { document, escapeHtml, footer, header } from '../shell'
import { docHref, docsPages } from './manifest'
import { renderDocs, type Article } from './render'

function navigation(current?: string) {
  return [...new Set(docsPages.map(page => page.section))].map(section => `<div class="docs-nav-group"><p>${section}</p>${docsPages.filter(page => page.section === section).map(page => `<a href="${docHref(page.slug)}"${current === page.slug ? ' aria-current="page"' : ''}>${page.title}</a>`).join('')}</div>`).join('')
}
const copyScript = "document.querySelectorAll('.docs-copy').forEach(b=>{b.hidden=false;b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.closest('.docs-code').querySelector('code').textContent);b.textContent='Copied';setTimeout(()=>{b.textContent='Copy'},1600)}catch{}})})"

function articlePage(article: Article, index: number) {
  const { page, html, headings } = article
  const toc = headings.filter(heading => heading.depth === 2).map(heading => `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a>`).join('')
  const neighbours = [docsPages[index - 1], docsPages[index + 1]].map((other, position) => other ? `<a class="docs-pager-${position ? 'next' : 'prev'}" href="${docHref(other.slug)}"><small>${position ? 'Next' : 'Previous'}</small><span>${other.title} <span aria-hidden="true">${position ? '→' : '←'}</span></span></a>` : '<span></span>').join('')
  return document(`${page.title} · Vane docs`, page.summary, `${header('docs')}<div class="docs-layout wrap"><aside class="docs-sidebar"><nav aria-label="Documentation">${navigation(page.slug)}</nav></aside>`
    + `<main id="main" class="docs-main"><details class="docs-mobile-nav"><summary>All guides</summary><nav aria-label="Documentation pages">${navigation(page.slug)}</nav></details><article><header class="docs-page-heading"><p class="eyebrow">${page.section}</p><h1>${page.title}</h1><p class="docs-summary">${page.summary}</p></header>`
    + `${toc ? `<details class="docs-mobile-toc"><summary>On this page</summary><nav>${toc}</nav></details>` : ''}<div class="docs-prose">${html}</div></article><nav class="docs-pager" aria-label="Adjacent guides">${neighbours}</nav></main>`
    + `<aside class="docs-toc">${toc ? `<nav aria-label="On this page"><p>On this page</p>${toc}</nav>` : ''}</aside></div>${footer()}`, { styles: ['docs'], script: copyScript })
}

export function documentationPages() {
  const articles = renderDocs()
  const index = document('Docs · Vane', 'Run Vane, add your website, read the counts and keep your history yours.', `${header('docs')}<main id="main" class="docs-index"><div class="wrap"><p class="eyebrow">Documentation</p><h1>Set up Vane in an afternoon.</h1>`
    + '<p class="docs-intro">Run it, add your website, read the counts, and keep your history yours. Every guide describes what Vane does today.</p>'
    + `<div class="docs-index-actions"><a class="run-button" href="/docs/getting-started">Your first website <span aria-hidden="true">→</span></a><a class="text-link" href="/run">Run Vane</a></div>`
    + `<ol class="docs-index-grid">${docsPages.map((page, i) => `<li><a class="docs-index-card" href="${docHref(page.slug)}"><span class="docs-index-num">${String(i + 1).padStart(2, '0')}</span><p class="docs-index-section">${page.section}</p><h2>${page.title}</h2><p>${page.summary}</p><span class="docs-index-go" aria-hidden="true">→</span></a></li>`).join('')}</ol></div></main>${footer()}`, { styles: ['docs'] })
  return [{ path: '/docs', html: index }, ...articles.map((article, i) => ({ path: docHref(article.page.slug), html: articlePage(article, i) }))]
}
