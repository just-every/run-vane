import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installation } from './harness.mjs'

// This intentionally separate, manual journey proves scale of PREVIEW only.
// IMPORT-006 stays partial until two million rows are also published/resumed.
const ROWS = 2_000_000, PAGE_ROWS = 500
const cli = new URL('../scripts/import-export.mjs', import.meta.url)
function command(args) {
 return new Promise((resolve, reject) => {
  // The input is larger than this heap: reading it all at once cannot pass.
  const child = spawn(process.execPath, ['--max-old-space-size=128', cli.pathname, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', data => { stdout += data }); child.stderr.on('data', data => { stderr += data })
  child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }))
 })
}
const hash = value => createHash('sha256').update(value).digest('hex')
const secrets = ['raw-scale-', 'private-session', 'private-website', 'private-visit', 'private-title', 'private-query', '198.51.100.77']
function assertPrivate(value) {
 const text = JSON.stringify(value)
 for (const secret of secrets) assert.ok(!text.includes(secret), `${secret} must not enter review or custody`)
}

test('IMPORT-006 two-million-row Umami CSV preview resumes at one million rows with exact anonymous records under a bounded CLI heap (publication still unproven)', { timeout: 25 * 60_000 }, async t => {
 const root = await mkdtemp(join(tmpdir(), 'vane-umami-scale-'))
 t.after(() => rm(root, { recursive: true, force: true }))
 const input = join(root, 'website_event.csv'), cookie = join(root, 'session'), review = join(root, 'review')
 const source = await open(input, 'wx', 0o600)
 try {
  await source.writeFile('event_id,created_at,url_path,event_type,session_id,website_id,visit_id,page_title,url_query,client_ip\n')
  for (let first = 0; first < ROWS; first += 5000) {
   let chunk = ''
   for (let i = first; i < first + 5000; i++) chunk += `raw-scale-${i},2024-03-${i % 2 ? '14' : '13'} 09:00:00,${i % 2 ? '/pricing' : '/about'},1,private-session,private-website,private-visit,private-title,utm_source=newsletter&utm_campaign=launch&private=private-query,198.51.100.77\n`
   await source.writeFile(chunk)
  }
 } finally { await source.close() }
 assert.ok((await stat(input)).size > 128 * 1024 * 1024, 'the actual export exceeds the CLI heap')
 let a, interrupt = true, previewCalls = 0, rowsReceived = 0
 const server = createServer(async (req, res) => {
  try {
   const chunks = []; for await (const chunk of req) chunks.push(chunk)
   const body = Buffer.concat(chunks), headers = { ...req.headers }; delete headers.host
   if (req.url === '/api/vane/import-preview') {
    previewCalls++
    const { document } = JSON.parse(body)
    assert.ok(Buffer.byteLength(document) <= 2_000_000)
    assert.equal(document.trimEnd().split('\n').length - 1, PAGE_ROWS)
    // Inject only a transport failure. Every successful preview is the real Worker.
    if (interrupt && previewCalls === ROWS / PAGE_ROWS / 2 + 1) { res.writeHead(503); res.end(); return }
    rowsReceived += PAGE_ROWS
   }
   const response = await a.request(req.url, { method: req.method, headers, ...(body.length ? { body } : {}) })
   res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) { t.diagnostic(error.message); res.writeHead(500); res.end() }
 })
 server.listen(0, '127.0.0.1'); await once(server, 'listening')
 t.after(() => new Promise(resolve => server.close(resolve)))
 const origin = `http://127.0.0.1:${server.address().port}`
 a = await installation({ origin }); t.after(() => a.close())
 const site = await a.addSite({ paths: [], goals: {}, retainForever: true })
 await writeFile(cookie, a.owner, { mode: 0o600 })
 const args = ['preview', '--origin', origin, '--site', site, '--format', 'umami', '--input', input, '--cookie-file', cookie, '--review-dir', review]
 const interrupted = await command(args)
 assert.notEqual(interrupted.code, 0); assert.match(interrupted.stderr, /IMPORT_ERROR HTTP_503/)
 let manifest = JSON.parse(await readFile(join(review, 'manifest.json'), 'utf8'))
 assert.equal(manifest.complete, false); assert.equal(manifest.rows, ROWS / 2); assert.equal(manifest.pages.length, 2000)
 assert.equal((await a.dump()).vane_import_events.length, 0, 'interrupted preview publishes nothing')
 const refused = await command(['apply', '--review-dir', review, '--cookie-file', cookie, '--yes'])
 assert.notEqual(refused.code, 0); assert.match(refused.stderr, /PREVIEW_INCOMPLETE/)
 interrupt = false
 const resumed = await command(args); assert.equal(resumed.code, 0, resumed.stderr)
 manifest = JSON.parse(await readFile(join(review, 'manifest.json'), 'utf8'))
 assert.equal(manifest.complete, true); assert.equal(manifest.rows, ROWS); assert.equal(manifest.normalizedRows, ROWS)
 assert.equal(manifest.pages.length, 4000); assert.equal(previewCalls, 4001); assert.equal(rowsReceived, ROWS, 'completed pages never reach the Worker twice')
 assert.equal((await readdir(review)).filter(name => name.startsWith('page-')).length, 4000)
 assertPrivate(manifest)
 const totals = { '2024-03-13': 0, '2024-03-14': 0 }
 for (const [index, entry] of manifest.pages.entries()) {
  const page = JSON.parse(await readFile(join(review, entry.file), 'utf8'))
  assertPrivate(page); assert.equal(entry.rows, PAGE_ROWS); assert.equal(entry.normalizedRows, PAGE_ROWS)
  assert.equal(page.counts.input, PAGE_ROWS); assert.equal(page.counts.unique, PAGE_ROWS); assert.equal(page.counts.effects, PAGE_ROWS)
  assert.equal(page.discarded.sourceEventIds, PAGE_ROWS); assert.equal(page.discarded.sessionIds, PAGE_ROWS * 2)
  assert.equal(page.discarded.websiteIds, PAGE_ROWS); assert.equal(page.discarded.pageTitles, PAGE_ROWS); assert.equal(page.discarded.rawQueries, PAGE_ROWS)
  const expected = new Map(Array.from({ length: PAGE_ROWS }, (_, offset) => {
   const i = index * PAGE_ROWS + offset
   return [hash(JSON.stringify(['vane-umami-event', site, `raw-scale-${i}`])), i]
  }))
  for (const event of page.carry.events) {
   assert.ok(expected.has(event.id), 'each distinct source row has exactly its anonymous identity')
   const i = expected.get(event.id); expected.delete(event.id)
   assert.deepEqual(Object.keys(event).sort(), ['campaign', 'consent', 'day', 'id', 'kind', 'path', 'sample_rate', 'source'])
   assert.equal(event.day, i % 2 ? '2024-03-14' : '2024-03-13'); totals[event.day]++
   assert.equal(event.path, i % 2 ? '/pricing' : '/about'); assert.equal(event.kind, 'pageview')
   assert.equal(event.source, 'newsletter'); assert.equal(event.campaign, 'launch')
   assert.equal(event.consent, null); assert.equal(event.sample_rate, null)
  }
  assert.equal(expected.size, 0)
 }
 assert.deepEqual(totals, { '2024-03-13': ROWS / 2, '2024-03-14': ROWS / 2 })
 const calls = previewCalls, repeated = await command(args)
 assert.equal(repeated.code, 0, repeated.stderr); assert.equal(previewCalls, calls, 'a completed review is reusable without re-upload')
 const custody = await a.dump(); assert.equal(custody.vane_import_events.length, 0); assert.equal(custody.vane_import_approvals.length, 0); assertPrivate(custody)
 for (const output of [interrupted, refused, resumed, repeated]) assert.ok(!(output.stdout + output.stderr).includes(a.owner))
 t.diagnostic(`IMPORT-006 preview only: ${ROWS} distinct rows; ${manifest.pages.length} pages; interrupted at ${ROWS / 2}; source bytes ${(await stat(input)).size}; CLI heap 128 MiB; no analytics published`)
})
