import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

// Slow installer evidence: invoke explicitly from a committed checkout, in a
// nightly/release job with rer and current Playwright Chromium already available:
// VANE_HOST_LOCAL_JOURNEY=1 node --test --test-concurrency=1 tests/host-local.journey.mjs
// The Node/browser process keeps the REAL HOME. Only rer gets the isolated HOME.
// Public rer supports git file:// sources (global/cli/repository.mjs); cloning
// this checkout tests local HEAD rather than whatever GitHub main becomes.
// Linux repeats the installed journey in a network namespace with only loopback.
// The runtime and browser both lose external network access; Cloudflare transfer
// still requires the owner account.
const execute = promisify(execFile)
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const screens = process.env.VANE_SCREEN_DIR
const enabled = process.env.VANE_HOST_LOCAL_JOURNEY === '1'
const push = process.env.GITHUB_EVENT_NAME === 'push'
const offlineScratch = process.env.VANE_HOST_OFFLINE_SCRATCH

// Read no arguments or environments from other processes. Birth checks protect
// against PID reuse; only our child and our private registry grant ownership.
async function processTable() {
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,stat=,lstart='], { env: { ...process.env, LC_ALL: 'C' } })
  return new Map(stdout.trim().split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)
    return match ? [[Number(match[1]), { parent: Number(match[2]), state: match[3], birth: match[4] }]] : []
  }))
}

function ownedProcesses(registry) {
  const owned = new Map()
  const launchers = new Set()
  async function capture(child) {
    const table = await processTable()
    if (child && Number.isInteger(child.pid) && !launchers.has(child)) {
      launchers.add(child)
      if (table.has(child.pid)) owned.set(child.pid, table.get(child.pid).birth)
    }
    let paths = []
    try { paths = await readdir(registry, { recursive: true }) } catch (error) { if (error.code !== 'ENOENT') throw error }
    for (const path of paths.filter(path => /(?:^|\/)(?:worker|server|state)\.json$/.test(path))) {
      let record
      try { record = JSON.parse(await readFile(join(registry, path), 'utf8')) }
      catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) continue; throw error }
      const visit = value => {
        if (!value || typeof value !== 'object') return
        if (Number.isInteger(value.pid) && table.has(value.pid) && !owned.has(value.pid)) owned.set(value.pid, table.get(value.pid).birth)
        for (const item of Object.values(value)) visit(item)
      }
      visit(record)
    }
    for (let changed = true; changed;) {
      changed = false
      for (const [pid, info] of table) {
        if (!owned.has(pid) && owned.has(info.parent) && owned.get(info.parent) === table.get(info.parent)?.birth) {
          owned.set(pid, info.birth); changed = true
        }
      }
    }
    return table
  }
  return {
    capture,
    async stop() {
      // The repository launcher's SIGTERM handler invokes rer dev --stop. Kill
      // only our exact launcher PID directly; stop its owned descendants by PID.
      await capture()
      let table = await processTable()
      for (const child of launchers) if (owned.get(child.pid) === table.get(child.pid)?.birth) {
        try { process.kill(child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
      }
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        table = await capture()
        for (const [pid, birth] of owned) if (pid !== process.pid && table.get(pid)?.birth === birth && !table.get(pid).state.startsWith('Z')) {
          try { process.kill(pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
        }
        const end = Date.now() + 5000
        do {
          await delay(100)
          table = await capture()
          if (![...owned].some(([pid, birth]) => table.get(pid)?.birth === birth && !table.get(pid).state.startsWith('Z'))) return
        } while (Date.now() < end)
      }
      assert.fail('An owned local journey process did not stop')
    },
  }
}

async function launch(cwd, env, processes, args) {
  // No inherited stdio: RER_OPEN is a credential, including on failure. Keep
  // output in memory and use only generic assertions in the test reporter.
  const runner = process.env.VANE_HOST_RER || 'rer'
  const child = spawn(runner, ['dev', ...args, '--detach'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', errors = '', exited = false, code, failed = false
  child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-262144) })
  child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-262144) })
  child.once('error', () => { failed = true; exited = true })
  child.once('close', value => { code = value; exited = true })
  await processes.capture(child)
  const deadline = Date.now() + 12 * 60_000
  while (!exited && Date.now() < deadline) { await processes.capture(); await delay(500) }
  assert.ok(exited, 'rer dev must finish installation and report readiness within twelve minutes')
  assert.equal(failed, false, 'The public rer executable must be available')
  if(code!==0){for(const checkout of [cwd,join(cwd,'run-vane')]){try{
   const directory=join(checkout,'.seed','installer'),logs=(await readdir(directory,{recursive:true})).filter(path=>path.endsWith('install.log'))
   for(const path of logs){const log=await readFile(join(directory,path),'utf8');errors+='\n'+log.split('\n').filter(line=>!/RER_OPEN|RER_SIGN|binding|secret|token|password|email|vars/i.test(line)).slice(-20).join('\n')}
  }catch{}}}
  if(code!==0){try{const paths=await readdir(env.RER_SERVERS_DIR,{recursive:true});for(const path of paths.filter(path=>path.endsWith('launch.log'))){
   const log=await readFile(join(env.RER_SERVERS_DIR,path),'utf8');errors+='\n'+log.split('\n').filter(line=>!/RER_OPEN|RER_SIGN|binding|secret|token|password|email|vars/i.test(line)).slice(-12).join('\n')
  }}catch{}}
  const safe = (output + errors).split('\n').filter(line => !/RER_OPEN|RER_SIGN_IN|RER_SIGNED_IN/.test(line)).slice(-18).join('\n').replace(/https?:\/\/[^\s"'<>]+/g, '[address]').replace(/[A-Za-z0-9_+/=-]{20,}/g, '[private]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+/gi, '[email]')
  assert.equal(code, 0, 'Public rer dev must launch successfully (credentials withheld): ' + safe)
  const line = name => output.match(new RegExp(`^${name} (\\S+)\\s*$`, 'm'))?.[1]
  const ready = line('RER_READY'), open = line('RER_OPEN')
  assert.ok(ready && open, 'Public rer dev must print RER_READY and RER_OPEN')
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(ready).hostname), 'Vane must serve locally')
  assert.equal(new URL(open).origin, new URL(ready).origin, 'The sign-in link must belong to the local installation')
  return { ready: ready.replace(/\/$/, ''), open }
}

async function signIn(page, installation) {
  // Never let a Playwright navigation error echo the credential URL.
  try {
    await page.goto(installation.open)
    await page.waitForURL(url => !url.hash && !url.pathname.startsWith('/__dev/') && !url.pathname.startsWith('/auth/dev/'))
  } catch { throw new Error('The browser could not consume the private local sign-in link') }
  if (new URL(page.url()).pathname === '/setup') {
    await page.getByLabel('I confirm this owner account is ready to use.').check()
    await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
  }
  await page.goto(installation.ready + '/app')
  await page.getByRole('heading', { name: 'Your sites', exact: true }).waitFor()
}

test('HOST-002 public installation, real tracker and durable reports repeat with runtime network denied', {
  skip: !enabled ? 'nightly/release only; set VANE_HOST_LOCAL_JOURNEY=1 explicitly' : push ? 'slow installer journey does not run on push' : false,
  timeout: 28 * 60_000,
}, async t => {
  const scratch = offlineScratch || await mkdtemp(join(tmpdir(), 'vane-host-local-'))
  const home = join(scratch, 'home'), empty = join(scratch, 'empty'), registry = join(scratch, 'servers')
  const processes = ownedProcesses(registry)
  let browser, fixture
  t.after(async () => {
    try { await browser?.close() }
    finally {
      try { if (fixture) await new Promise((done, reject) => { fixture.close(error => error ? reject(error) : done()); fixture.closeAllConnections() }) }
      finally { await processes.stop(); if(!offlineScratch) await rm(scratch, { recursive: true, force: true }) }
    }
  })
  if(!offlineScratch){
   await Promise.all([mkdir(home, { mode: 0o700 }), mkdir(empty, { mode: 0o700 })])
   assert.deepEqual(await readdir(empty), [], 'The one-line command starts in an empty directory')
  } else {
   const interfaces=JSON.parse((await execute('ip',['-j','address'])).stdout)
   assert.deepEqual(interfaces.map(row=>row.ifname),['lo'],'only loopback exists for the browser and runtime')
   assert.equal((await execute('ip',['route','show'])).stdout.trim(),'','no external IPv4 route')
   assert.equal((await execute('ip',['-6','route','show','default'])).stdout.trim(),'','no external IPv6 default route')
  }
  // No owner-account credentials are inherited by rer. PATH permits its normal
  // installed toolchain, while state, package stores and registry are private.
  const env = { HOME: home, PATH: process.env.PATH, TMPDIR: scratch, LANG: 'en_US.UTF-8',
    CI: 'true', WRANGLER_SEND_METRICS: 'false', RER_SERVERS_DIR: registry,
    RER_JOBS_DIR: join(scratch, 'jobs'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache') }
  // Keep the managed cloud proxy and CA configuration for initial acquisition.
  // These cannot bypass the offline namespace, which has no external interface.
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE'])if(process.env[key])env[key]=process.env[key]
  const checkout = join(empty, 'run-vane')
  const installation = offlineScratch ? await launch(checkout, env, processes, []) : await launch(empty, env, processes, [pathToFileURL(source).href, '--dir', 'run-vane'])
  t.diagnostic('Public rer dev printed RER_READY and RER_OPEN; the sign-in credential is withheld.')

  let snippet = ''
  fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Northline Coffee — subscriptions</title><h1>Fresh coffee, delivered weekly</h1><p>Choose a seasonal roast for your home or office.</p>${snippet}</html>`)
  })
  await new Promise((done, reject) => { fixture.once('error', reject); fixture.listen(Number(process.env.VANE_HOST_OFFLINE_PORT || 0), '127.0.0.1', done) })
  const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`
  const { chromium, expect } = await import('@playwright/test')
  browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  const owner = await browser.newContext(), page = await owner.newPage()
  await signIn(page, installation)
  if(!offlineScratch){
  await page.getByLabel('Site name', { exact: true }).fill('Northline Coffee')
  await page.getByLabel('Website origin', { exact: true }).fill(fixtureOrigin)
  await page.getByLabel('Time zone', { exact: true }).fill('Australia/Brisbane')
  await page.getByLabel('Consent', { exact: true }).selectOption('not-required')
  await page.getByRole('button', { name: 'Prepare site', exact: true }).click()
  const proposal = page.locator('article.vane-proposal').filter({ has: page.getByRole('heading', { name: 'Add site', exact: true }) })
  await expect(proposal).toContainText('Northline Coffee')
  await expect(proposal).toContainText(fixtureOrigin)
  await proposal.getByRole('button', { name: 'Approve change', exact: true }).click()
  }
  await page.goto(installation.ready + '/app')
  await page.getByRole('link', { name: 'Northline Coffee', exact: true }).click()
  const reportURL = new URL(page.url()); reportURL.search = '?section=report'
  const settingsURL = new URL(reportURL); settingsURL.search = '?section=settings'
  await page.goto(settingsURL.href)
  snippet = await page.locator('.vane-script code').first().innerText()
  assert.match(snippet, /^<script defer src="http:\/\/[^\s]+\/vane\.js" data-site="[^\s"]+"[^>]*><\/script>$/)

  // Use a normal visitor UA to exercise accepted traffic: the application
  // deliberately rejects the headless browser's default HeadlessChrome UA.
  const userAgent = (await page.evaluate(() => navigator.userAgent)).replace('HeadlessChrome/', 'Chrome/')
  const visitor = await browser.newContext({ userAgent }), visit = await visitor.newPage()
  const collect = visit.waitForResponse(response => new URL(response.url()).pathname === '/api/vane/collect' && response.request().method() === 'POST')
  await visit.goto(fixtureOrigin + (offlineScratch?'/offline-subscriptions':'/subscriptions'))
  const accepted = await collect
  assert.equal(accepted.status(), 202, 'The real installed tracker must collect the fixture page')
  assert.equal((await accepted.json()).accepted, true)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto(reportURL.href)
    await page.getByRole('heading', { name: 'Overview', exact: true, level: 1 }).waitFor()
    const pageviews = page.getByRole('heading', { name: 'Pageviews', exact: true }).locator('..')
    await expect(pageviews.locator('.vane-metric')).toHaveText(offlineScratch?'2':'1')
    await expect(page.locator('main')).toContainText('/subscriptions')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    if (screens) { await mkdir(screens, { recursive: true }); await page.screenshot({ path: join(screens, `host-local-report-${width}.png`) }) }
  }
  await visitor.close()
  await processes.stop()
  const restarted = await launch(checkout, env, processes, [])
  await signIn(page, restarted)
  const durableReport = new URL(reportURL.pathname + reportURL.search, restarted.ready)
  await page.goto(durableReport.href)
  const pageviews = page.getByRole('heading', { name: 'Pageviews', exact: true }).locator('..')
  await expect(pageviews.locator('.vane-metric')).toHaveText(offlineScratch?'2':'1')
  await expect(page.locator('main')).toContainText('/subscriptions')
  const archive=await page.request.get(restarted.ready+'/api/vane/export')
  assert.equal(archive.status(),200)
  assert.equal((await archive.json()).payload.tables.vane_events.filter(row=>row.kind==='pageview').length,offlineScratch?2:1,'export works with the same durable pageviews')
  if(!offlineScratch){
   assert.equal(process.platform,'linux','network-denied replay requires Linux namespaces')
   await browser.close();browser=undefined
   await new Promise((done,reject)=>{fixture.close(error=>error?reject(error):done());fixture.closeAllConnections()});fixture=undefined
   await processes.stop()
   const replay=await execute('unshare',['--user','--map-root-user','--net','sh','-c','ip link set lo up && exec "$@"','vane-offline',process.execPath,'--test',fileURLToPath(import.meta.url)],{cwd:source,env:{...process.env,VANE_HOST_OFFLINE_SCRATCH:scratch,VANE_HOST_OFFLINE_PORT:new URL(fixtureOrigin).port},timeout:18*60_000,maxBuffer:4*1024*1024})
   assert.match(replay.stdout,/# fail 0/,'isolated replay passes');t.diagnostic('Network namespace replay passed: only loopback, no external routes; restart, local sign-in, installed tracker, report and archive export.')
  }
  t.diagnostic('Local proof passed. Cloudflare deployment transfer still requires an owner account.')
})
