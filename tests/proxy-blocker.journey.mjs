import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer as httpServer } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import { installation } from './harness.mjs'
import { extensionState } from './extension-state.mjs'

// Explicit Linux journey, outside push Verify. Supply the official Chrome 138
// executable and unpacked uBlock Origin MV2 release (see proxy-blocker.yml).
// No request routing, custom filters, imported settings or owner browser profile.
// The actual Vane URL MUST be blocked before first-party success is attempted.
// If default lists do not block Vane, INSTALL-006 remains unproven and this fails.
const trackerHostname = 'synthetic-vane-2.test'
const hostname = 'synthetic-vane-1.test'
const prefix = '/insights'
const execute = promisify(execFile)

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

async function respond(response, result) {
  response.writeHead(result.status, Object.fromEntries(result.headers))
  response.end(Buffer.from(await result.arrayBuffer()))
}

function incoming(request, origin) {
  const init = { method: request.method, headers: request.headers }
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = Readable.toWeb(request)
    init.duplex = 'half'
  }
  return new Request(origin + request.url, init)
}

function handler(fn) {
  return (request, response) => {
    fn(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  }
}

async function chrome(t, scratch) {
  assert.ok(process.env.CHROMIUM_EXECUTABLE_PATH, 'Set CHROMIUM_EXECUTABLE_PATH to the official Chrome 138 Linux executable')
  assert.ok(process.env.UBLOCK_EXTENSION_PATH, 'Set UBLOCK_EXTENSION_PATH to the unpacked official uBlock Origin MV2 extension')
  const extension = resolve(process.env.UBLOCK_EXTENSION_PATH)
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'))
  assert.equal(manifest.manifest_version, 2, 'This journey requires real blocking webRequest support from uBlock Origin MV2')
  assert.ok(manifest.permissions.includes('webRequestBlocking'))
  const profile = join(scratch, 'chrome-profile')
  const child = spawn(process.env.CHROMIUM_EXECUTABLE_PATH, [
    '--headless=new', '--enable-logging=stderr', '--log-level=0', '--v=1', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=' + profile, '--load-extension=' + extension, '--disable-extensions-except=' + extension,
    '--enable-features=AllowLegacyMV2Extensions',
    '--disable-features=ExtensionManifestV2Unsupported,ExtensionManifestV2Disabled,ExtensionManifestV2DeprecationWarning,DisableLoadExtensionCommandLineSwitch',
    '--password-store=basic', '--no-first-run', '--no-default-browser-check',
    '--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors', '--no-proxy-server',
    '--host-resolver-rules=MAP ' + hostname + ' 127.0.0.1,MAP ' + trackerHostname + ' 127.0.0.1',
    '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    'about:blank',
  // Chrome's ProcessSingleton UNIX socket must fit Linux's 108-byte pathname limit.
  ], { env: {...process.env,TMPDIR:'/tmp'}, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = '', fullStderr = '', launchError, browser
  child.stderr.on('data', bytes => { fullStderr += bytes.toString(); stderr = fullStderr.slice(-8192) })
  child.on('error', error => { launchError = error })
  t.after(async () => {
    try { await browser?.close() }
    finally {
      if (process.env.VANE_BLOCKER_LOG) await writeFile(process.env.VANE_BLOCKER_LOG, fullStderr);
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        child.kill('SIGTERM')
        await Promise.race([once(child, 'exit'), delay(5000, undefined, { ref: false })])
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
          await once(child, 'exit')
        }
      }
    }
  })
  let port
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (launchError) throw launchError
    assert.equal(child.exitCode, null, 'Chrome exited before CDP was ready: ' + stderr)
    assert.equal(child.signalCode, null, 'Chrome stopped before CDP was ready: ' + stderr)
    try {
      port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0])
      if (port) break
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    await delay(100)
  }
  assert.ok(port, 'Chrome must expose its own ephemeral CDP port: ' + stderr)
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port)
  const context = browser.contexts()[0]
  assert.ok(context, 'Use the fresh Chrome default context where the extension is installed')
  const filters = await extensionState(port,context)
  t.after(()=>filters.close())
  const {selected,netFilterCount} = await filters.read()
  t.diagnostic('Chrome ' + browser.version() + '; uBlock Origin ' + manifest.version + '; active network filters: '+netFilterCount+'; default lists: ' + selected.join(', '))
  return { context, filters, selected }
}

test('INSTALL-006: default uBlock Origin/EasyPrivacy blocks unproxied Vane before the real first-party tracker collects', {
  skip: process.platform !== 'linux' ? 'Linux-only Chrome MV2 journey; run the manual proxy-blocker workflow' : false,
  timeout: 180_000,
}, async t => {
  assert.notEqual(process.env.GITHUB_EVENT_NAME, 'push', 'Run the blocker journey separately from push Verify')
  const scratch = await mkdtemp(join(tmpdir(), 'vane-blocker-'))
  // Close every owned resource before deleting this journey's scratch profile.
  const cleanup = []
  t.after(async () => {
    try { for (const close of cleanup.reverse()) await close() }
    finally { await rm(scratch, { recursive: true, force: true }) }
  })
  // Chrome owns only this fresh profile. Its after-hook must finish before the
  // enclosing cleanup removes it, so register its cleanup with this same stack.
  const browserHooks = { after: close => cleanup.push(close), diagnostic: message => t.diagnostic(message) }
  const { context, filters, selected } = await chrome(browserHooks, scratch)
  const key = join(scratch, 'site.key'), cert = join(scratch, 'site.crt')
  await execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=' + hostname, '-addext', 'subjectAltName=DNS:' + hostname + ',DNS:' + trackerHostname, '-keyout', key, '-out', cert])
  const a = await installation()
  cleanup.push(() => a.close())
  await a.clock(Date.parse('2026-10-05T12:00:00Z'))
  // This second TLS origin serves the actual built Worker tracker. Its name and
  // path are ordinary fixture names, never chosen to trigger a filter rule.
  const tls = {key:await readFile(key),cert:await readFile(cert)}
  const directWorker = httpsServer(tls,handler(async(request,response)=>{
    const forwarded=incoming(request,a.origin)
    return respond(response,await a.request(request.url,{method:forwarded.method,headers:Object.fromEntries(forwarded.headers),
      ...(!['GET','HEAD'].includes(forwarded.method)?{body:await forwarded.arrayBuffer()}:{})}))
  }))
  const directPort=await listen(directWorker)
  cleanup.push(()=>closeServer(directWorker))
  const directScript='https://'+trackerHostname+':'+directPort+'/vane.js'
  const actualScript=await a.request('/vane.js')
  assert.equal(actualScript.status,200);assert.match(actualScript.headers.get('content-type'),/javascript/)
  assert.match(await actualScript.text(),/\/api\/vane\/collect/)
  let proxy, siteId, origin
  const browserDoors = []
  const website = httpsServer({ key: await readFile(key), cert: await readFile(cert) }, handler(async (request, response) => {
    if (request.url.startsWith(prefix + '/')) {
      browserDoors.push({ path: request.url, method: request.method, cookie: request.headers.cookie, authorization: request.headers.authorization })
      assert.ok(proxy, 'First-party traffic cannot run before the direct-blocking assertion')
      return respond(response, await proxy(incoming(request, origin), { ip: request.socket.remoteAddress, country: 'AU' }))
    }
    const tag = request.url === '/direct'
      ? `<script defer src="${directScript}" data-site="${siteId}"></script>`
      : request.url === '/proxied' ? `<script defer src="${prefix}/script.js" data-api="${prefix}" data-site="${siteId}"></script>` : ''
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>synthetic-vane-1</title><h1>synthetic-vane-1</h1>' + tag + '</html>')
  }))
  const port = await listen(website)
  cleanup.push(() => closeServer(website))
  origin = 'https://' + hostname + ':' + port
  siteId = await a.addSite({ name: 'synthetic-vane-1', origin, paths: [], goals: {}, consent: 'not-required' })
  const page = await context.newPage()
  const directOutcome = new Promise(resolve => {
    page.on('requestfailed', request => {
      if (request.url() === directScript) resolve({ failure: request.failure()?.errorText })
    })
    page.on('response', response => {
      if (response.url() === directScript) resolve({ status: response.status() })
    })
  })
  await page.goto(origin + '/direct', { waitUntil: 'domcontentloaded' })
  const outcome = await Promise.race([directOutcome, delay(30_000, undefined, { ref: false }).then(() => ({ timeout: true }))])
  assert.equal(outcome.failure, 'net::ERR_BLOCKED_BY_CLIENT',
    'Default uBlock/EasyPrivacy must block the actual ' + directScript + ' before proxy success can establish INSTALL-006. Observed: ' + JSON.stringify(outcome))
  t.diagnostic('Actual unproxied Vane script failed with net::ERR_BLOCKED_BY_CLIENT; now exercising the official proxy adapter.')

  const created = await a.post('/api/vane/proxy-connections', {
    operation: 'proxy.create', siteId, hostname, mode: 'external', publicPrefix: prefix,
  }, a.owner)
  assert.equal(created.status, 200)
  // This credential is generated by the real owner operation, never printed or
  // transferred to the browser. No product database authentication is replaced.
  const { connection, credential } = await created.json()
  const workerDoors = []
  const upstream = httpServer(handler(async (request, response) => {
    workerDoors.push(request.url)
    const forwarded = incoming(request, a.origin)
    return respond(response, await a.request(request.url, {
      method: forwarded.method, headers: Object.fromEntries(forwarded.headers),
      ...(!['GET', 'HEAD'].includes(forwarded.method) ? { body: await forwarded.arrayBuffer() } : {}),
    }))
  }))
  const upstreamPort = await listen(upstream)
  cleanup.push(() => closeServer(upstream))
  const bundle = await build({ entryPoints: ['src/vane/proxy/adapter.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
  const { createVaneProxy } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
  proxy = createVaneProxy({ installationOrigin: 'http://127.0.0.1:' + upstreamPort,
    connectionId: connection.id, siteId, siteOrigin: origin, publicPrefix: prefix, serverCredential: credential })
  const script = page.waitForResponse(response => response.url() === origin + prefix + '/script.js')
  const config = page.waitForResponse(response => response.url() === origin + prefix + '/config/' + siteId)
  const collected = page.waitForResponse(response => response.url() === origin + prefix + '/collect' && response.request().method() === 'POST')
  const [scriptResponse, configResponse, accepted] = await Promise.all([script, config, collected, page.goto(origin + '/proxied')])
  assert.equal(scriptResponse.status(), 200)
  assert.equal(configResponse.status(), 200)
  assert.equal(accepted.status(), 202)
  assert.equal((await accepted.json()).accepted, true)
  assert.deepEqual((await filters.read()).selected, selected, 'Keep default lists unchanged throughout both visits')
  for (const door of ['script.js', 'config/' + siteId, 'collect']) {
    assert.ok(browserDoors.some(request => request.path === prefix + '/' + door), 'Browser must request first-party ' + door)
    assert.ok(workerDoors.includes('/api/vane/proxy/' + connection.id + '/' + door), 'Real Worker must receive authenticated proxy ' + door)
  }
  assert.ok(browserDoors.every(request => !request.cookie && !request.authorization), 'Visitor requests carry no owner session or server credential')
  const summary = await a.request('/api/vane/summary?siteId=' + siteId + '&from=2026-10-05&to=2026-10-06', { headers: { cookie: a.owner } })
  assert.equal(summary.status, 200)
  const report = await summary.json()
  assert.deepEqual([report.transport.proxy, report.transport.direct, report.transport.total], [1, 0, 1], 'The accepted browser pageview appears once as proxy transport in the native report')
  t.diagnostic('Real HTTPS site → official server adapter → real Vane Worker: script/config 200, collect 202, report proxy=1/direct=0/total=1.')
})
