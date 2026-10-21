import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

// Outside push Verify: real production Next rewrites, downloaded owner setup,
// browser network and Worker. The tiny HTTP ingress supplies its socket peer in
// the same position as the downloaded private Nginx recipe. This does NOT prove
// the Nginx binary or a hosted provider. No Playwright routing or product mocks.
// npm registry next/latest checked 2026-10-22: official stable Next 16.4.2.
// NEXT_RUNTIME_ROOT may point to an external cache containing node_modules;
// otherwise exact dependencies are installed into this journey's scratch only.
const dependencies = { next: '16.4.2', react: '19.3.1', 'react-dom': '19.3.1', 'server-only': '0.0.1' }
const prefix = '/insights'

async function listen(server) {
  await new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  return server.address().port
}

async function closeServer(server) {
  await new Promise((done, reject) => {
    server.close(error => error ? reject(error) : done())
    server.closeAllConnections()
  })
}

function serve(fn, errors) {
  return (request, response) => {
    fn(request, response).catch(error => {
      errors.push(error)
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  }
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  await Promise.race([exited, delay(5000, undefined, { ref: false })])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await exited
  }
}

function command(executable, args, options) {
  const child = spawn(executable, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', failed
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes).slice(-12000) })
  child.on('error', error => { failed = error })
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Runtime command exited ${code ?? signal}: ${output}`)))
  })
  // Long-running next start is awaited during readiness and owned cleanup.
  done.catch(() => {})
  return { child, done, output: () => output, failure: () => failed }
}

async function completed(executable, args, options, timeout) {
  const running = command(executable, args, options)
  try {
    await Promise.race([running.done, delay(timeout, undefined, { ref: false }).then(() => { throw new Error('Runtime command timed out') })])
  } finally { await stop(running.child) }
}

async function runtime(scratch, t) {
  const root = process.env.NEXT_RUNTIME_ROOT ? resolve(process.env.NEXT_RUNTIME_ROOT) : join(scratch, 'runtime')
  if (!process.env.NEXT_RUNTIME_ROOT) {
    await mkdir(root)
    await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, dependencies }))
    await completed(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], {
      cwd: root, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    }, 180_000)
  }
  const require = createRequire(join(root, 'package.json'))
  const binary = require.resolve('next/dist/bin/next')
  t.diagnostic('Official Next runtime: ' + JSON.parse(await readFile(require.resolve('next/package.json'), 'utf8')).version)
  return { root, binary }
}

function reverse(request, response, target, headers) {
  return new Promise((done, reject) => {
    const upstream = httpRequest(target + request.url, { method: request.method, headers }, result => {
      response.writeHead(result.statusCode, result.headers)
      result.on('error', reject)
      result.pipe(response)
      result.once('end', done)
    })
    upstream.once('error', reject)
    upstream.setTimeout(15000, () => upstream.destroy(new Error('Private Next ingress timed out')))
    request.pipe(upstream)
  })
}

test('INSTALL-006: downloaded Next setup rewrites real browser script, config and collect into one private proxy pageview', {
  timeout: 420_000,
}, async t => {
  assert.notEqual(process.env.GITHUB_EVENT_NAME, 'push', 'Run the production Next journey outside push Verify')
  const scratch = await mkdtemp(join(tmpdir(), 'vane-next-'))
  const cleanup = [], errors = []
  t.after(async () => {
    const failures = []
    for (const close of cleanup.reverse()) {
      try { await close() } catch (error) { failures.push(error) }
    }
    await rm(scratch, { recursive: true, force: true })
    if (failures.length) throw new AggregateError(failures, 'Journey cleanup failed')
  })
  let a, siteId, siteOrigin, scriptTag, nextOrigin
  const workerDoors = [], browserDoors = []
  const upstream = createServer(serve(async (request, response) => {
    assert.ok(a, 'Only the actual initialized Worker answers installation HTTP')
    workerDoors.push({ path: request.url, ip: request.headers['x-vane-proxy-ip'], authenticated: Boolean(request.headers.authorization),
      cookie: request.headers.cookie, ua: request.headers['user-agent'] })
    const body = []
    for await (const bytes of request) body.push(bytes)
    const result = await a.request(request.url, { method: request.method, headers: request.headers,
      ...(!['GET', 'HEAD'].includes(request.method) ? { body: Buffer.concat(body) } : {}) })
    response.writeHead(result.status, Object.fromEntries(result.headers))
    response.end(Buffer.from(await result.arrayBuffer()))
  }, errors))
  const installationOrigin = 'http://127.0.0.1:' + await listen(upstream)
  cleanup.push(() => closeServer(upstream))
  a = await installation({ origin: installationOrigin })
  cleanup.push(() => a.close())
  await a.clock(Date.parse('2026-10-05T12:00:00Z'))

  const website = createServer(serve(async (request, response) => {
    if (request.url.startsWith(prefix + '/')) {
      const socketIP = request.socket.remoteAddress
      assert.ok(socketIP, 'Attest the accepted TCP socket, never a fixture address or forwarded browser header')
      browserDoors.push({ path: request.url, ip: socketIP, cookie: request.headers.cookie, authorization: request.headers.authorization })
      const headers = { ...request.headers, 'x-vane-ingress-ip': socketIP }
      delete headers['x-forwarded-for']
      delete headers.forwarded
      // Next is private loopback. The public site's Host and Origin stay intact.
      return reverse(request, response, nextOrigin, headers)
    }
    if (request.url !== '/pricing') { response.writeHead(404); response.end(); return }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'" })
    response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>synthetic-vane-1</title><h1>Pricing</h1>' + scriptTag + '</html>')
  }, errors))
  siteOrigin = 'http://localhost:' + await listen(website)
  cleanup.push(() => closeServer(website))
  siteId = await a.addSite({ name: 'synthetic-vane-1', origin: siteOrigin, paths: [], goals: {}, consent: 'not-required' })
  const created = await a.post('/api/vane/proxy-connections', {
    operation: 'proxy.create', siteId, hostname: 'localhost', mode: 'external', publicPrefix: prefix,
  }, a.owner)
  assert.equal(created.status, 200)
  const { connection, credential } = await created.json()
  assert.ok(credential)
  const downloaded = await a.request('/api/vane/proxy-setup?' + new URLSearchParams({ siteId, connectionId: connection.id, platform: 'nextjs' }), {
    headers: { cookie: a.owner },
  })
  assert.equal(downloaded.status, 200)
  const setup = await downloaded.json()
  assert.ok(!JSON.stringify(setup).includes(credential), 'Setup contains no server credential')
  scriptTag = setup.scriptTag
  const project = join(scratch, 'website')
  await mkdir(project)
  // Every downloaded byte is used unchanged, including route, adapter and config.
  for (const file of setup.files) {
    const path = resolve(project, file.path)
    assert.ok(relative(project, path) && !relative(project, path).startsWith('..'))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, file.content)
  }
  await writeFile(join(project, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies }))
  await mkdir(join(project, 'app'), { recursive: true })
  await writeFile(join(project, 'app/layout.js'), 'export default function RootLayout({ children }) { return <html lang="en"><body>{children}</body></html> }\n')
  const next = await runtime(scratch, t)
  await symlink(join(next.root, 'node_modules'), join(project, 'node_modules'), 'dir')
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
  await completed(process.execPath, [next.binary, 'build', '--webpack'], { cwd: project, env }, 180_000)
  const reservation = createServer()
  const nextPort = await listen(reservation)
  await closeServer(reservation)
  nextOrigin = 'http://127.0.0.1:' + nextPort
  const running = command(process.execPath, [next.binary, 'start', '--hostname', '127.0.0.1', '--port', String(nextPort)], {
    cwd: project, env: { ...env, VANE_PROXY_CREDENTIAL: credential },
  })
  cleanup.push(() => stop(running.child))
  const deadline = Date.now() + 30_000
  let ready = false
  while (Date.now() < deadline) {
    if (running.failure()) throw running.failure()
    if (running.child.exitCode !== null || running.child.signalCode !== null) throw new Error('Next stopped before readiness: ' + running.output())
    try {
      const result = await fetch(nextOrigin + prefix + '/script.js', { signal: AbortSignal.timeout(1000) })
      assert.equal(result.status, 503, 'Private Next refuses requests without ingress socket attestation')
      await result.arrayBuffer()
      ready = true
      break
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error
    }
    await delay(100)
  }
  assert.ok(ready, 'Production Next must become ready: ' + running.output())
  assert.equal(workerDoors.length, 0, 'Unattested private requests never reach Vane')

  // Real HOME, current bundled Chromium, fresh context; no copied OS sessions.
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  cleanup.push(() => browser.close())
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + browser.version() + ' Safari/537.36',
  })
  // A malicious claimed ingress IP must be overwritten with the real socket IP.
  await context.setExtraHTTPHeaders({ 'x-vane-ingress-ip': '203.0.113.2', 'x-forwarded-for': '203.0.113.2' })
  const page = await context.newPage(), requests = []
  page.on('request', request => requests.push({ url: request.url(), headers: request.headers() }))
  const doors = ['script.js', 'config/' + siteId, 'collect']
  const responses = doors.map(door => page.waitForResponse(response => response.url() === siteOrigin + prefix + '/' + door))
  const [script, config, collect] = await Promise.all([...responses, page.goto(siteOrigin + '/pricing')])
  assert.deepEqual([script.status(), config.status(), collect.status()], [200, 200, 202])
  assert.equal((await collect.json()).accepted, true)
  for (const door of doors) {
    const browserDoor = browserDoors.find(request => request.path === prefix + '/' + door)
    const workerDoor = workerDoors.find(request => request.path === '/api/vane/proxy/' + connection.id + '/' + door)
    assert.ok(browserDoor && workerDoor, 'Browser and actual Worker both receive ' + door)
    assert.equal(workerDoor.ip, browserDoor.ip, 'Downloaded handler forwards ingress socket IP through the actual Next rewrite')
    assert.equal(workerDoor.authenticated, true)
    assert.ok(!workerDoor.cookie && !browserDoor.cookie && !browserDoor.authorization)
  }
  assert.ok(requests.every(request => new URL(request.url).origin === siteOrigin), 'Browser uses only first-party network requests')
  assert.ok(requests.every(request => !JSON.stringify(request).includes(credential)), 'Server credential never reaches browser requests')
  assert.ok(![await script.text(), await config.text(), await collect.text(), await page.content()].some(body => body.includes(credential)))
  await context.close()
  assert.deepEqual(errors, [], 'Real network edges complete without hidden errors')
  const summary = await a.request('/api/vane/summary?' + new URLSearchParams({ siteId, from: '2026-10-05', to: '2026-10-06' }), { headers: { cookie: a.owner } })
  assert.equal(summary.status, 200)
  const report = await summary.json()
  assert.deepEqual([report.transport.proxy, report.transport.direct, report.transport.unknown, report.transport.total], [1, 0, 0, 1])
  const dump = await a.dump(), stored = JSON.stringify(dump)
  const visitorIP = browserDoors.find(request => request.path === prefix + '/collect').ip
  const userAgent = workerDoors.find(request => request.path.endsWith('/collect')).ua
  assert.ok(userAgent)
  // Infrastructure origins contain the same loopback address by design; remove
  // that exact configured URL before checking the entire persisted database.
  assert.ok(!stored.replaceAll(installationOrigin, '[installation-origin]').includes(visitorIP), 'Raw visitor IP is absent from custody')
  assert.ok(!stored.includes(userAgent) && !stored.includes(credential), 'Raw UA and raw credential are absent from custody')
  assert.equal(dump.vane_events.filter(event => event.site_id === siteId && event.kind === 'pageview' && event.path === '/pricing' && event.transport === 'proxy').length, 1)
  t.diagnostic('Actual Next build/start + unchanged downloaded rewrite/handler/adapter + TCP ingress + Worker: script/config 200, collect 202; proxy=1/direct=0; no raw visitor metadata or credential stored. Nginx binary not exercised.')
})
