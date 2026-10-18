import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, relative, dirname, extname } from 'node:path'
import { createServer } from 'node:http'

const root = resolve('dist/site')
const files = await readdir(root, { recursive: true })
const pages = files.filter(file => file.endsWith('.html'))
const exists = path => files.includes(path) || files.includes(path + '.html') || files.includes(path + '/index.html')

test('a visitor can follow the public homepage to run instructions and every repository guide', async () => {
  const home = await readFile(resolve(root, 'index.html'), 'utf8')
  const targets = [...home.matchAll(/href="([^"]+)"/g)].map(match => match[1])
  assert.ok(targets.includes('/run'), 'homepage reaches installation instructions')
  assert.ok(targets.includes('/docs'), 'homepage reaches the guide index')
  const run = await readFile(resolve(root, 'run.html'), 'utf8')
  assert.ok(/rer dev/.test(run), 'run instructions reach the real launch command')
  assert.ok(/rer dev just-every\/run-vane/.test(run), 'run instructions include the public repository')
  const docs = pages.filter(page => page.startsWith('docs/'))
  assert.ok(docs.length > 0, 'repository guides are built')
  for (const file of pages) {
    const html = await readFile(resolve(root, file), 'utf8')
    for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(?:https?:|mailto:|data:|#)/.test(href)) continue
      const path = decodeURIComponent(href.split(/[?#]/)[0])
      const target = path.startsWith('/') ? path.slice(1) : relative(root, resolve(root, dirname(file), path))
      assert.ok(exists(target || 'index.html'), `${file} reaches ${href}`)
      assert.ok(!/^\/?(?:app|auth|setup|signin)(?:\/|$)/.test(path), 'run site contains only public routes')
    }
  }
})

test('DOCS-001 each built guide renders its Markdown code blocks, tables and heading anchors, and the copy control copies the block', async () => {
  const guides = (await readdir(resolve('docs'))).filter(file => file.endsWith('.md'))
  let blocks = 0
  for (const guide of guides) {
    const markdown = await readFile(resolve('docs', guide), 'utf8')
    const html = await readFile(resolve(root, 'docs', guide.replace(/\.md$/, '.html')), 'utf8')
    const fences = markdown.match(/^```/gm)?.length ?? 0
    blocks += fences / 2
    assert.equal(html.match(/<div class="docs-code"><div class="code-heading"><span>[^<]+<\/span><button type="button" class="docs-copy" hidden>Copy<\/button><\/div><pre><code>/g)?.length ?? 0, fences / 2, `${guide} code blocks`)
    assert.equal(html.match(/<div class="docs-table" role="region" aria-label="Table" tabindex="0"><table>/g)?.length ?? 0, markdown.match(/^\|(?:\s*:?-+:?\s*\|)+\s*$/gm)?.length ?? 0, `${guide} tables`)
    const ids = new Set([...html.matchAll(/<h[2-6] id="([^"]+)">/g)].map(match => match[1]))
    assert.equal(ids.size, markdown.match(/^#{2,6} /gm)?.length ?? 0, `${guide} heading anchors`)
    const sections = [...html.matchAll(/<nav aria-label="On this page"><p>On this page<\/p>(.*?)<\/nav>/g)].flatMap(match => [...match[1].matchAll(/href="#([^"]+)"/g)].map(link => link[1]))
    assert.equal(sections.length, markdown.match(/^## /gm)?.length ?? 0, `${guide} section links`)
    for (const id of sections) assert.ok(ids.has(id), `${guide} section link #${id} reaches its heading`)
  }
  assert.ok(blocks > 0, 'the guides include code blocks to copy')

  const { chromium } = await import('@playwright/test')
  const types = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/\/$/, '') || '/index'
    for (const file of [path, path + '.html']) {
      try { const body = await readFile(resolve(root, '.' + file)); response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }); return response.end(body) } catch {}
    }
    response.writeHead(404).end()
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    const context = await browser.newContext()
    const base = `http://127.0.0.1:${server.address().port}`
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
    const page = await context.newPage()
    for (const guide of ['commands', 'history']) {
      await page.goto(`${base}/docs/${guide}`)
      const block = page.locator('.docs-code').first()
      await block.getByRole('button', { name: 'Copy' }).click()
      await page.waitForFunction(() => document.querySelector('.docs-copy').textContent === 'Copied')
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await block.locator('code').textContent(), `${guide} copy control copies its block`)
    }
  } finally {
    await browser.close()
    server.close()
  }
})
