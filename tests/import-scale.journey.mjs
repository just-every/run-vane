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

// CI always uses the complete acceptance export. A smaller explicit local run
// calibrates runtime; its diagnostics do not claim the two-million-row proof.
const ROWS = Number(process.env.VANE_IMPORT_SCALE_ROWS ?? 2_000_000), PAGE_ROWS = 500
assert.ok(Number.isSafeInteger(ROWS) && ROWS >= 1000 && ROWS % 1000 === 0, 'scale rows must be a positive multiple of 1000')
const PAGES = ROWS / PAGE_ROWS
const cli = new URL('../scripts/import-export.mjs', import.meta.url)
function command(args) {
 return new Promise((resolve, reject) => {
  // The full acceptance input exceeds this heap: reading it all at once cannot pass.
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

// Inspect absence at the real storage edge. Each result contains only counts
// and a rowid cursor, never analytics rows or retained plans. Rowid chunks keep
// the scan bounded as import custody grows to millions of rows.
async function assertPrivateCustody(db) {
 const quoted = name => '"' + name.replaceAll('"', '""') + '"'
 const tables = (await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results
 let inspected = 0
 for (const table of tables) {
  const columns = (await db.prepare(`PRAGMA table_info(${quoted(table.name)})`).all()).results
  const leak = `EXISTS(SELECT 1 FROM json_each(?) needle WHERE ${columns.map(column => `instr(CAST(sample.${quoted(column.name)} AS TEXT),needle.value)>0`).join(' OR ')})`
  if (/WITHOUT\s+ROWID/i.test(table.sql)) {
   // The report-keeping ledger has no rowid; it is empty in this import flow.
   const result = await db.prepare(`SELECT COUNT(*) AS rows,COALESCE(SUM(${leak}),0) AS leaks FROM ${quoted(table.name)} sample`).bind(JSON.stringify(secrets)).first()
   assert.equal(result.leaks, 0, table.name + ' contains no source identifiers'); inspected += result.rows
   continue
  }
  let cursor = -1
  while (true) {
   const result = await db.prepare(`SELECT COUNT(*) AS rows,MAX(sample.__inspection_rowid) AS cursor,COALESCE(SUM(${leak}),0) AS leaks FROM (SELECT rowid AS __inspection_rowid,* FROM ${quoted(table.name)} WHERE rowid>? ORDER BY rowid LIMIT 1000) sample`).bind(JSON.stringify(secrets), cursor).first()
   assert.equal(result.leaks, 0, table.name + ' contains no source identifiers')
   inspected += result.rows
   if (!result.rows) break
   assert.ok(result.cursor > cursor); cursor = result.cursor
  }
 }
 return inspected
}

test('IMPORT-006 two-million-row Umami CSV preview and publication resume after one million rows, preserving exact anonymous totals under a bounded CLI heap', { timeout: 210 * 60_000 }, async t => {
 const root = await mkdtemp(join(tmpdir(), 'vane-umami-scale-'))
 t.after(() => rm(root, { recursive: true, force: true }))
 const input = join(root, 'website_event.csv'), cookie = join(root, 'session'), review = join(root, 'review')
 const source = await open(input, 'wx', 0o600)
 try {
  await source.writeFile('event_id,created_at,url_path,event_type,session_id,website_id,visit_id,page_title,url_query,client_ip\n')
  for (let first = 0; first < ROWS; first += 5000) {
   let chunk = ''
   for (let i = first; i < Math.min(ROWS, first + 5000); i++) chunk += `raw-scale-${i},2024-03-${i % 2 ? '14' : '13'} 09:00:00,${i % 2 ? '/pricing' : '/about'},1,private-session,private-website,private-visit,private-title,utm_source=newsletter&utm_campaign=launch&private=private-query,198.51.100.77\n`
   await source.writeFile(chunk)
  }
 } finally { await source.close() }
 if (ROWS === 2_000_000) assert.ok((await stat(input)).size > 128 * 1024 * 1024, 'the actual export exceeds the CLI heap')
 let a, interrupt = true, previewCalls = 0, rowsReceived = 0, interruptPublication = false, publicationCalls = 0, committedRows = 0, lostJob
 const committed = new Map()
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
   if (req.url === '/api/vane/import-apply' && response.ok) {
    publicationCalls++
    const result = await response.clone().json()
    assert.equal(result.job.total, PAGE_ROWS)
    const before = committed.get(result.job.id) ?? 0
    assert.ok(result.job.checkpoint >= before)
    committedRows += result.job.checkpoint - before; committed.set(result.job.id, result.job.checkpoint)
    // Lose a real committed response at the midpoint of publication. The CLI
    // must discover the completed job again from its previous checkpoint.
    if (interruptPublication && committedRows >= ROWS / 2) {
     assert.equal(committedRows, ROWS / 2)
     assert.equal(result.complete, true)
     lostJob = result.job.id; req.socket.destroy(); return
    }
   }
   res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) { t.diagnostic(error.message); res.writeHead(500); res.end() }
 })
 server.listen(0, '127.0.0.1'); await once(server, 'listening')
 t.after(() => new Promise(resolve => server.close(resolve)))
 const origin = `http://127.0.0.1:${server.address().port}`
 a = await installation({ origin }); t.after(() => a.close())
 const site = await a.addSite({ paths: [], goals: {}, retainForever: true })
 await writeFile(cookie, a.owner, { mode: 0o600 })
 const args = ['preview', '--origin', origin, '--site', site, '--cutover','2024-03-15','--format', 'umami', '--input', input, '--cookie-file', cookie, '--review-dir', review]
 const interrupted = await command(args)
 assert.notEqual(interrupted.code, 0); assert.match(interrupted.stderr, /IMPORT_ERROR HTTP_503/)
 let manifest = JSON.parse(await readFile(join(review, 'manifest.json'), 'utf8'))
 assert.equal(manifest.complete, false); assert.equal(manifest.rows, ROWS / 2); assert.equal(manifest.pages.length, PAGES / 2)
 assert.equal((await a.inspectDb.prepare('SELECT COUNT(*) AS n FROM vane_import_events').first()).n, 0, 'interrupted preview publishes nothing')
 const refused = await command(['apply', '--review-dir', review, '--cookie-file', cookie, '--yes'])
 assert.notEqual(refused.code, 0); assert.match(refused.stderr, /PREVIEW_INCOMPLETE/)
 interrupt = false
 const resumed = await command(args); assert.equal(resumed.code, 0, resumed.stderr)
 manifest = JSON.parse(await readFile(join(review, 'manifest.json'), 'utf8'))
 assert.equal(manifest.complete, true); assert.equal(manifest.rows, ROWS); assert.equal(manifest.normalizedRows, ROWS)
 assert.equal(manifest.pages.length, PAGES); assert.equal(previewCalls, PAGES + 1); assert.equal(rowsReceived, ROWS, 'completed pages never reach the Worker twice')
 assert.equal((await readdir(review)).filter(name => name.startsWith('page-')).length, PAGES)
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
  assert.equal(page.carry.format, 'vane-cutover-preview/1'); assert.equal(page.carry.cutover, '2024-03-15')
  for (const event of page.carry.document.events) {
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
 assert.equal((await a.inspectDb.prepare('SELECT COUNT(*) AS n FROM vane_import_events').first()).n, 0, 'completed preview publishes nothing')
 assert.equal((await a.inspectDb.prepare('SELECT COUNT(*) AS n FROM vane_import_approvals').first()).n, 0)
 const apply = ['apply', '--review-dir', review, '--cookie-file', cookie, '--yes']
 interruptPublication = true
 const started = Date.now(), lost = await command(apply)
 assert.notEqual(lost.code, 0); assert.match(lost.stderr, /IMPORT_ERROR HTTP_REQUEST_FAILED/)
 assert.ok(lostJob, 'the transport interruption follows the midpoint commit')
 assert.equal((await a.inspectDb.prepare('SELECT COUNT(*) AS n FROM vane_import_events').first()).n, ROWS / 2)
 manifest = JSON.parse(await readFile(join(review, 'manifest.json'), 'utf8'))
 assert.equal(manifest.pages.filter(page => page.complete).length, PAGES / 2 - 1)
 assert.equal(manifest.pages[PAGES / 2 - 1].complete, false, 'the committed completion response was lost before local checkpointing')
 const journalResponse = await a.request(`/api/vane/import-journal?siteId=${site}&jobId=${lostJob}`, { headers: { cookie: a.owner } })
 assert.equal(journalResponse.status, 200)
 const journal = await journalResponse.json()
 assert.equal(journal.job.state, 'completed'); assert.equal(journal.job.checkpoint, PAGE_ROWS)
 assert.equal(journal.provenance.length, PAGE_ROWS, 'ordinary custody exists for the lost committed response')
 interruptPublication = false
 const published = await command(apply); assert.equal(published.code, 0, published.stderr)
 manifest = JSON.parse(await readFile(join(review, 'manifest.json'), 'utf8'))
 assert.ok(manifest.pages.every(page => page.complete && page.jobId))
 assert.equal(manifest.pages[PAGES / 2 - 1].jobId, lostJob, 'resume reuses the committed job')
 assert.equal(committedRows, ROWS)
 const callsAfterPublication = publicationCalls, publishedAgain = await command(apply)
 assert.equal(publishedAgain.code, 0, publishedAgain.stderr)
 assert.equal(publicationCalls, callsAfterPublication, 'a completed application does not publish again')
 const summaryResponse = await a.request(`/api/vane/summary?siteId=${site}&from=2024-03-13&to=2024-03-15&interval=day`, { headers: { cookie: a.owner } })
 assert.equal(summaryResponse.status, 200)
 const report = await summaryResponse.json()
 assert.equal(report.pageviews, ROWS); assert.equal(report.imported, ROWS); assert.equal(report.unknownCoverage, ROWS)
 assert.deepEqual(report.series.map(bucket => [bucket.label, bucket.pageviews]), [['2024-03-13', ROWS / 2], ['2024-03-14', ROWS / 2]])
 assert.deepEqual(report.pages.map(row => [row.label, row.count]).sort(), [['/about', ROWS / 2], ['/pricing', ROWS / 2]])
 assert.equal((await a.inspectDb.prepare('SELECT COUNT(*) AS n FROM vane_import_events').first()).n, ROWS, 'resume and repeat never duplicate committed rows')
 assert.equal((await a.inspectDb.prepare('SELECT COUNT(*) AS n FROM vane_import_approvals').first()).n, PAGES)
 const inspected = await assertPrivateCustody(a.inspectDb)
 for (const output of [interrupted, refused, resumed, repeated, lost, published, publishedAgain]) assert.ok(!(output.stdout + output.stderr).includes(a.owner))
 t.diagnostic(`IMPORT-006 ${ROWS === 2_000_000 ? 'full acceptance' : 'LOCAL CALIBRATION ONLY'}: ${ROWS} distinct published rows; ${manifest.pages.length} pages; preview and publication interrupted at ${ROWS / 2}; ${publicationCalls} publication requests; publication ${Math.round((Date.now() - started) / 1000)}s; ${inspected} custody rows checked without transferring their contents; source bytes ${(await stat(input)).size}; CLI heap 128 MiB`)
})
