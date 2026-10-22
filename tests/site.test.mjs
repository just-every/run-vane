import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join, resolve, relative, dirname, extname } from 'node:path'
import { createServer } from 'node:http'

const root = resolve('dist/site')
const files = await readdir(root, { recursive: true })
const pages = files.filter(file => file.endsWith('.html'))
const exists = path => files.includes(path) || files.includes(path + '.html') || files.includes(path + '/index.html')

// The built run site served over HTTP to a real headless browser.
async function serve() {
  const { chromium } = await import('@playwright/test')
  const types = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.jpg': 'image/jpeg' }
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/\/$/, '') || '/index'
    for (const file of [path, path + '.html']) {
      try { const body = await readFile(resolve(root, '.' + file)); response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }); return response.end(body) } catch {}
    }
    response.writeHead(404).end()
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  return { browser, server, base: `http://127.0.0.1:${server.address().port}` }
}

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

  const { browser, server, base } = await serve()
  try {
    const context = await browser.newContext()
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
    const page = await context.newPage()
    for (const guide of ['commands', 'history', 'first-party-proxy']) {
      await page.goto(`${base}/docs/${guide}`)
      if(guide==='first-party-proxy')for(const width of [1440,390]){
        await page.setViewportSize({width,height:1000});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        if(process.env.VANE_SCREEN_DIR){await mkdir(process.env.VANE_SCREEN_DIR,{recursive:true});await page.screenshot({path:join(process.env.VANE_SCREEN_DIR,`proxy-guide-${width}.png`)});}
      }

      const block = page.locator('.docs-code').first()
      await block.getByRole('button', { name: 'Copy' }).click()
      await page.waitForFunction(() => document.querySelector('.docs-copy').textContent === 'Copied')
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await block.locator('code').textContent(), `${guide} copy control copies its block`)
    }
    for (const guide of ['agency', 'collection', 'collection-scale', 'sign-in-security', 'instrumentation', 'movement']) {
      await page.goto(`${base}/docs/${guide}`)
      await page.locator('h1').waitFor()
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${guide} fits at ${width} px`)
        if (process.env.VANE_SCREEN_DIR) {
          await mkdir(process.env.VANE_SCREEN_DIR, { recursive: true })
          await page.screenshot({ path: join(process.env.VANE_SCREEN_DIR, `${guide}-guide-${width}.png`), fullPage: true })
        }
      }
    }
  } finally {
    await browser.close()
    server.close()
  }
})

test('HOME-001 at 390 px the hero cards and every section drawing stack under their copy without sideways scrolling, sit beside it at 1440 px, and the wind trail runs down the page', async () => {
  const { browser, server, base } = await serve()
  try {
    const layout = async width => {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), origins = new Set(), failed = []
      page.on('request', request => origins.add(new URL(request.url()).origin))
      page.on('response', response => { if (response.status() >= 400) failed.push(response.url()) })
      await page.goto(base + '/', { waitUntil: 'networkidle' })
      await page.evaluate(() => document.fonts.ready)
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
      const result = await page.evaluate(() => {
        const box = element => element.getBoundingClientRect()
        const below = (copy, drawing) => box(drawing).top >= box(copy).bottom - 1
        const sections = [...document.querySelectorAll('section.story')].map(section => {
          const copy = section.querySelector('.story-head'), drawings = [...section.querySelectorAll('.card, .code-card, figure.hash')].filter(d => box(d).width > 0)
          return { id: section.id, drawings: drawings.length, below: drawings.every(d => below(copy, d)), beside: drawings.some(d => !below(copy, d)) }
        })
        const hero = document.querySelector('.hero-copy'), cards = [...document.querySelectorAll('.hero .sky-card')].filter(card => box(card).width > 0)
        const fonts = [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family.replace(/"/g, ''))
        const trail = document.querySelector('.trail'), path = trail.querySelector('.trail-line')
        return { fonts, sections, cards: cards.length, cardsBelow: cards.every(card => below(hero, card)), scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          trail: getComputedStyle(trail).display === 'none' ? 0 : path.getTotalLength(), page: document.documentElement.scrollHeight }
      })
      await page.close()
      return { ...result, origins: [...origins], failed }
    }
    const phone = await layout(390), desk = await layout(1440)
    assert.ok(phone.sections.length >= 7, 'the homepage has the week of sections')
    for (const section of phone.sections) assert.ok(section.drawings > 0 && section.below, `${section.id} drawings stack under its copy at 390 px`)
    assert.ok(phone.cards >= 4 && phone.cardsBelow, 'hero cards stack under the hero copy at 390 px')
    assert.equal(phone.scroll, 0, 'no sideways scrolling at 390 px')
    for (const id of ['launch-day', 'dip', 'orders', 'searched', 'report']) assert.ok(desk.sections.find(section => section.id === id).beside, `${id} drawing sits beside its copy at 1440 px`)
    assert.equal(desk.scroll, 0)
    assert.ok(desk.trail > desk.page * 0.6, 'the wind trail runs down most of the page at 1440 px')
    assert.equal(phone.trail, 0, 'phones show no trail')
    for (const view of [phone, desk]) {
      assert.deepEqual(view.origins, [base], 'fonts, artwork and styles are served by the run site itself')
      assert.deepEqual(view.failed, [], 'every font, image and style the page requests is served')
      for (const family of ['Inter Tight', 'Inter']) assert.ok(view.fonts.includes(family), `${family} loads`)
    }
  } finally {
    await browser.close()
    server.close()
  }
})
