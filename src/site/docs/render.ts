import { existsSync, readFileSync } from 'node:fs'
import { dirname, posix, resolve } from 'node:path'
import { Marked } from 'marked'
import run from '../run.json'
import { escapeHtml } from '../shell'
import { docsPages, docHref, type DocsPage } from './manifest'

export interface Heading { id: string; text: string; depth: number }
export interface Article { page: DocsPage; html: string; headings: Heading[] }

// Markdown is read while rer builds the static site. No installation data or
// server-side module is shipped to the browser.
export function renderDocs(root = process.cwd()): Article[] {
  const published = new Map<string, string>(docsPages.map(page => [page.source, docHref(page.slug)]))
  return docsPages.map(page => {
    const headings: Heading[] = []
    const used = new Map<string, number>()
    const markdown = readFileSync(resolve(root, page.source), 'utf8').replace(/^# .+\r?\n/, '')
    const marked = new Marked({ gfm: true, renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens, this.parser.textRenderer)
        const base = text.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-')
        const count = used.get(base) ?? 0
        used.set(base, count + 1)
        const id = count ? `${base}-${count}` : base
        headings.push({ id, text, depth })
        return `<h${depth} id="${escapeHtml(id)}">${this.parser.parseInline(tokens)}</h${depth}>`
      },
      html({ text }) { return escapeHtml(text) },
      link({ href, tokens, title }) {
        let target = href
        if (!/^(https?:|mailto:|#|\/)/i.test(href)) {
          const [path, hash] = href.split('#')
          const source = posix.normalize(posix.join(dirname(page.source), path))
          if (source.startsWith('../') || !existsSync(resolve(root, source))) throw new Error(`${page.source}: missing linked file ${href}`)
          target = (published.get(source) ?? `${run.repository}/blob/main/${source}`) + (hash ? `#${hash}` : '')
        }
        if (!/^(https?:|mailto:|#|\/(?!\/))/i.test(target)) throw new Error(`${page.source}: unsupported link ${href}`)
        return `<a href="${escapeHtml(target)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`
      },
      code({ text, lang }) {
        return `<div class="docs-code"><div class="code-heading"><span>${escapeHtml(lang || 'Code')}</span><button type="button" class="docs-copy" hidden>Copy</button></div><pre><code>${escapeHtml(text)}</code></pre></div>`
      },
    } })
    const html = (marked.parse(markdown, { async: false }) as string)
      .replace(/<table>/g, '<div class="docs-table" role="region" aria-label="Table" tabindex="0"><table>')
      .replace(/<\/table>/g, '</table></div>')
    return { page, html, headings }
  })
}
