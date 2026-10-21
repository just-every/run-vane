import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer as httpServer } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { installation } from './harness.mjs'
import { chrome } from './extension-chrome.mjs'

// Explicit Linux journey, outside push Verify. Supply the official Chrome 138
// executable and unpacked uBlock Origin MV2 release (see proxy-blocker.yml).
// No request routing, custom filters, imported settings or owner browser profile.
// Check the actual unproxied Vane URL first. Its strict subtest must pass for
// INSTALL-006 to be done; independent first-party evidence cannot replace it.
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
  const { context, filters, selected } = await chrome(browserHooks, scratch, hostname, trackerHostname)
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
  let completeDirect
  const directCollected=new Promise(resolve=>{completeDirect=resolve})
  page.on('response',response=>{if(response.url()===new URL('/api/vane/collect',directScript).href)completeDirect(response)})
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
  await t.test('default lists block the actual unproxied Vane script',()=>{
    assert.equal(outcome.failure,'net::ERR_BLOCKED_BY_CLIENT',
      'Default uBlock/EasyPrivacy must block the actual '+directScript+' before INSTALL-006 can be done. Observed: '+JSON.stringify(outcome))
  })
  if(outcome.status===200){
    const direct=await Promise.race([directCollected,delay(30000,undefined,{ref:false})])
    assert.ok(direct,'an allowed control must execute the actual installed Vane tracker');assert.equal(direct.status(),202)
  }
  const query=`/api/vane/summary?siteId=${siteId}&from=2026-10-05&to=2026-10-06`
  const before=await(await a.request(query,{headers:{cookie:a.owner}})).json()
  await t.test('unchanged default lists allow actual first-party collection with private metadata and honest proxy counts',async()=>{


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
  assert.deepEqual([report.transport.proxy,report.transport.direct,report.transport.total],
    [before.transport.proxy+1,before.transport.direct,before.transport.total+1],
    'The browser adds exactly one proxy pageview while preserving the genuine direct control count')
  const dump=JSON.stringify(await a.dump()),archive=JSON.stringify(await a.archive())
  for(const stored of [dump,archive]){
    assert.ok(!stored.includes(credential));assert.ok(!stored.includes(await page.evaluate(()=>navigator.userAgent)))
    assert.ok(!stored.includes('"127.0.0.1"'),'the peer address is never retained as a raw value')
  }
  t.diagnostic('Real HTTPS site → official server adapter → real Vane Worker: script/config 200, collect 202, exactly one added proxy pageview, unchanged defaults and no raw visitor metadata in custody.')
  })
})
