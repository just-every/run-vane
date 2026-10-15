import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, relative, dirname } from 'node:path'

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
  assert.ok(/git clone/.test(run), 'run instructions include the public repository')
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
