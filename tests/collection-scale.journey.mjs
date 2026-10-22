import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { execFileSync } from 'node:child_process'
import { installation } from './harness.mjs'

// This journey is deliberately excluded from push Verify. Lower explicit counts
// exercise the real doors, but never establish the full acceptance volume.
const MONTHLY = Number(process.env.VANE_COLLECTION_SCALE_MONTHLY ?? 10_000_000)
const MONTHS = Number(process.env.VANE_COLLECTION_SCALE_MONTHS ?? 12)
const CONCURRENCY = Number(process.env.VANE_COLLECTION_SCALE_CONCURRENCY ?? 32)
const BURST_SECONDS = Number(process.env.VANE_COLLECTION_SCALE_BURST_SECONDS ?? 10)
for (const [name, value, min, max] of [['monthly', MONTHLY, 1, 100_000_000], ['months', MONTHS, 1, 12], ['concurrency', CONCURRENCY, 1, 500], ['burst seconds', BURST_SECONDS, 2, 120]]) {
 assert.ok(Number.isSafeInteger(value) && value >= min && value <= max, `${name} is outside the journey's documented bounds`)
}
const fullVolume = MONTHLY >= 10_000_000 && MONTHS === 12
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const isoDay = time => new Date(time).toISOString().slice(0, 10)

test('COLLECT-004 genuine monthly pageviews, a paced 500/second burst, concurrent replay, and complete twelve-month public dashboard timing', { timeout: 350 * 60_000 }, async t => {
 const a = await installation()
 t.after(() => a.close())
 const measurements = { sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fullVolume, claim: 'NOT PROVEN', monthly: MONTHLY, months: MONTHS, submitted: 0, accepted: 0, burst: {}, reports: [], capacity: null }
 const save = async () => t.diagnostic(JSON.stringify(measurements))
 t.after(save)
 t.diagnostic(fullVolume ? 'FULL VOLUME REQUESTED: 120M+ actual native pageviews; capacity and all assertions must pass.' : 'SMOKE ONLY: this count does not establish COLLECT-004 monthly volume or twelve-month scale.')
 await a.clock(Date.parse('2025-01-01T12:00:00Z'))
 const origins = ['https://synthetic-vane-1.example', 'https://synthetic-vane-2.example']
 const ids = await Promise.all(origins.map((origin, i) => a.addSite({ name: `synthetic-vane-${i + 1}`, origin, goals: {}, retention: '13m' })))
 const expected = ids.map(() => 0), pages = new Map(), monthExpected = new Map()
 async function send(site, n, payload) {
  const event = payload ?? a.event(ids[site], { path: `/scale/${n % 3}`, campaign: `synthetic-vane-${n % 2}` })
  measurements.submitted++
  const response = await a.post('/api/vane/collect', event, '', { origin: origins[site], 'cf-connecting-ip': `203.0.113.${n % 10 + 1}`, 'user-agent': 'Synthetic Browser scale' })
  const body = await response.json()
  assert.equal(response.status, 202, JSON.stringify({ status: response.status, body }))
  assert.equal(body.accepted, true); assert.notEqual(body.duplicate, true)
  measurements.accepted++; expected[site]++; pages.set(event.path, (pages.get(event.path) ?? 0) + 1)
  return event
 }
 // More than the removed daily ceiling, independent of the optional volume.
 for (let first = 0; first < 10_001; first += CONCURRENCY) {
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, 10_001 - first) }, (_, i) => send(0, first + i)))
 }
 monthExpected.set('2025-01', 10_001)
 const raceEvent = a.event(ids[0], { path: '/scale/0' })
 const race = await Promise.all(Array.from({ length: 16 }, () => a.collect(raceEvent, origins[0])))
 const answers = await Promise.all(race.map(async response => ({ status: response.status, ...await response.json() })))
 assert.equal(answers.filter(r => r.status === 202 && !r.duplicate).length, 1, 'one concurrent request admits the ID')
 assert.equal(answers.filter(r => r.status === 200 && r.duplicate === true).length, 15, 'all simultaneous retries acknowledge the admitted event')
 measurements.submitted += 16; measurements.accepted++; expected[0]++; pages.set('/scale/0', (pages.get('/scale/0') ?? 0) + 1)
 monthExpected.set('2025-01', monthExpected.get('2025-01') + 1)
 const replay = await a.collect(raceEvent, origins[0]); assert.equal(replay.status, 200); assert.equal((await replay.json()).duplicate, true)
 measurements.submitted++

 // Paced starts, not Promise.all(500) inaccurately called 500 events/second.
 // Record actual dispatch and completion times; do not retry failed admissions.
 const starts = [], pending = [], burstAt = performance.now()
 for (let n = 0; n < BURST_SECONDS * 500; n++) {
  const wait = burstAt + n * 2 - performance.now(); if (wait > 0) await sleep(wait)
  starts.push(performance.now() - burstAt)
  pending.push(send(n % 2, n).then(value => ({ value }), error => ({ error })))
 }
 const burstResults = await Promise.all(pending)
 for (const result of burstResults) if (result.error) throw result.error
 const burstElapsed = performance.now() - burstAt
 measurements.burst = { events: pending.length, offeredPerSecond: pending.length / ((starts.at(-1) + 2) / 1000), completedPerSecond: pending.length / (burstElapsed / 1000), elapsedMs: burstElapsed, maxDispatchLagMs: Math.max(...starts.map((at, n) => at - n * 2)) }
 assert.ok(measurements.burst.offeredPerSecond >= 490, 'the runner actually offered the requested paced rate')
 assert.ok(measurements.burst.completedPerSecond >= 490, 'the receiver kept up with the burst')
 monthExpected.set('2025-01', monthExpected.get('2025-01') + pending.length)

 for (let month = 0; month < MONTHS; month++) {
  const label = isoDay(Date.UTC(2025, month, 1)).slice(0, 7)
  // All months have at least 28 days. Spread actual events across those dates;
  // the product clock moves only after all outstanding admissions complete.
  for (let day = 1; day <= 28; day++) {
   await a.clock(Date.UTC(2025, month, day, 12))
   const firstOfDay = Math.floor(MONTHLY * (day - 1) / 28), endOfDay = Math.floor(MONTHLY * day / 28)
   for (let first = firstOfDay; first < endOfDay; first += CONCURRENCY) {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, endOfDay - first) }, (_, i) => send((first + i) % 2, first + i)))
   }
  }
  monthExpected.set(label, (monthExpected.get(label) ?? 0) + MONTHLY)
  // Inspect actual custody after public admission. Never insert raw rows or
  // aggregates through the DB handle, and never scale a row with a weight.
  const stored = (await a.inspectDb.prepare("SELECT substr(day,1,7) AS month,COUNT(*) AS n FROM vane_events WHERE kind='pageview' GROUP BY month ORDER BY month").all()).results
  assert.deepEqual(stored.map(row => [row.month, row.n]), [...monthExpected].sort())
  t.diagnostic(`${label}: ${MONTHLY} genuine pageviews admitted; cumulative ${measurements.accepted}`)
  await save()
 }
 const raw = await a.inspectDb.prepare("SELECT COUNT(*) AS n,COUNT(DISTINCT id) AS uniqueIds FROM vane_events WHERE kind='pageview'").first()
 assert.deepEqual([raw.n, raw.uniqueIds], [measurements.accepted, measurements.accepted])
 await a.clock(Date.parse('2026-01-02T12:00:00Z'))
 const rollup = await a.form({ operation: 'rollup.create', name: 'synthetic-vane-installation', ...Object.fromEntries(ids.map(id => [`site_${id}`, 'on'])) }, a.owner)
 assert.equal(rollup.status, 303)
 const rollupId = rollup.headers.get('location').match(/\/app\/rollups\/([\w-]+)/)?.[1]; assert.ok(rollupId)
 const query = 'from=2025-01-01&to=2026-01-01', owner = { headers: { cookie: a.owner } }
 async function timed(path, expectedViews, json) {
  const start = performance.now(), response = await a.request(path, owner), text = await response.text(), elapsedMs = performance.now() - start
  assert.equal(response.status, 200, text.slice(0, 500))
  if (json) { const data = JSON.parse(text); assert.equal(data.pageviews, expectedViews); assert.deepEqual(data.pages.map(r => [r.label, r.count]).sort(), [...pages].sort()); }
  else assert.match(text, /Pageviews/)
  measurements.reports.push({ path, elapsedMs, bytes: Buffer.byteLength(text) }); await save()
  assert.ok(elapsedMs < 2000, `complete public report took ${elapsedMs.toFixed(1)}ms`)
 }
 await timed(`/api/vane/summary?rollupId=${rollupId}&${query}`, measurements.accepted, true)
 await timed(`/app/rollups/${rollupId}?section=report&${query}`, measurements.accepted, false)
 const history = await (await a.request('/app?section=history', owner)).text()
 const capacity = history.match(/data-store-bytes="(\d+)" data-store-limit="(\d+)"/)
 assert.ok(capacity, 'actual capacity is published on History')
 measurements.capacity = { bytes: Number(capacity[1]), limitBytes: Number(capacity[2]) }
 assert.ok(measurements.capacity.bytes < measurements.capacity.limitBytes, 'the volume fits its declared storage architecture')
 measurements.claim = fullVolume ? 'Full volume, burst, custody and dashboard assertions passed in this runtime; provider proof separate' : 'SMOKE ONLY; full scale NOT PROVEN'
 await save()
})
