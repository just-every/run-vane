import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import { installedUI } from './host-local-ui.mjs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { ownedProcesses, launch, signIn } from './host-local-processes.mjs'

// Slow installer evidence: invoke explicitly from a committed checkout, in a
// release or manual job with rer and current Playwright Chromium already available:
// VANE_HOST_LOCAL_JOURNEY=1 node --test --test-concurrency=1 tests/host-local.journey.mjs
// The Node/browser process keeps the REAL HOME. Only rer gets the isolated HOME.
// Public rer supports Git sources on disk; cloning
// this checkout tests local HEAD rather than whatever GitHub main becomes.
// After installation, replay through rer dev inside a Linux network namespace.
// Cloudflare transfer belongs to HOST-003.
const execute = promisify(execFile)
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const screens = process.env.VANE_SCREEN_DIR
const enabled = process.env.VANE_HOST_LOCAL_JOURNEY === '1'
const push = process.env.GITHUB_EVENT_NAME === 'push'

test('HOST-002 installed journey: empty-folder command, sign-in, real tracker, durable report and network-cut replay', {
  skip: !enabled ? 'nightly/release only; set VANE_HOST_LOCAL_JOURNEY=1 explicitly' : push ? 'slow installer journey does not run on push' : false,
  timeout: 32 * 60_000,
}, async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'vane-host-local-'))
  const home = join(scratch, 'home'), empty = join(scratch, 'empty'), registry = join(scratch, 'servers')
  const processes = ownedProcesses(registry)
  t.after(async () => {
    await processes.stop(); await rm(scratch, { recursive: true, force: true })
  })
  await Promise.all([mkdir(home, { mode: 0o700 }), mkdir(empty, { mode: 0o700 })])
  assert.deepEqual(await readdir(empty), [], 'The one-line command starts in an empty directory')
  // No owner-account credentials are inherited by rer. PATH permits its normal
  // installed toolchain, while state, package stores and registry are private.
  const env = { HOME: home, PATH: process.env.PATH, TMPDIR: scratch, LANG: 'en_US.UTF-8',
    CI: 'true', WRANGLER_SEND_METRICS: 'false', RER_SERVERS_DIR: registry,
    RER_JOBS_DIR: join(scratch, 'jobs'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache') }
  const installation = await launch(empty, env, processes, [pathToFileURL(source).href, '--dir', 'run-vane'])
  const checkout = join(empty, 'run-vane')
  t.diagnostic('Public rer dev printed RER_READY and RER_OPEN; the sign-in credential is withheld.')

  const { page, reportURL } = await installedUI(t, installation, { screens, label: 'online' })
  await processes.stop()
  const restarted = await launch(checkout, env, processes, [])
  await signIn(page, restarted)
  const durableReport = new URL(reportURL.pathname + reportURL.search, restarted.ready)
  await page.goto(durableReport.href)
  const { expect } = await import('@playwright/test')
  const pageviews = page.getByRole('heading', { name: 'Pageviews', exact: true }).locator('..')
  await expect(pageviews.locator('.vane-metric')).toHaveText('1')
  await expect(page.locator('main')).toContainText('/subscriptions')
  await processes.stop()
  // Installation completed online. Only now cut every external route, then
  // restart that checkout through the public command and repeat the UI journey.
  const childEnv = { ...process.env, VANE_HOST_INSTALLED: scratch }
  delete childEnv.NODE_TEST_CONTEXT
  const replay = await execute('unshare', ['--user', '--map-root-user', '--net', 'sh', '-c',
    'ip link set lo up && exec "$@"', 'vane-installed-offline', process.execPath,
    join(source, 'tests/host-offline-replay.mjs')], {
    cwd: source, env: childEnv, timeout: 12 * 60_000, maxBuffer: 1024 * 1024,
  })
  assert.match(replay.stdout, /Installed offline journey passed/)
  t.diagnostic('Online installation, sign-in, tracker and durable report passed; the installed rer dev replay passed with only loopback and no external routes.')
})


// Account-free runtime proof is separate from the slow public installer proof.
// Linux isolates the real built Worker, database and browser together.
test('HOST-002 network-denied runtime collects through the tracker and preserves reports, import and archive restore',{
 skip:process.env.VANE_HOST_OFFLINE_JOURNEY!=='1'?'explicit local network-denied journey only':false,
 timeout:120000,
},async t=>{
 if(process.env.VANE_HOST_OFFLINE_ISOLATED!=='1'){
  const childEnv={...process.env,VANE_HOST_OFFLINE_ISOLATED:'1'};delete childEnv.NODE_TEST_CONTEXT
  const result=await execute('unshare',['--user','--map-root-user','--net','sh','-c','ip link set lo up && exec "$@"','vane-offline',process.execPath,'--test','--test-name-pattern=network-denied runtime',fileURLToPath(import.meta.url)],{cwd:source,env:childEnv,timeout:110000,maxBuffer:1024*1024})
  assert.match(result.stdout,/# fail 0/);t.diagnostic('Isolated runtime journey passed with only loopback and no external routes.');return
 }
 assert.deepEqual(JSON.parse((await execute('ip',['-j','address'])).stdout).map(row=>row.ifname),['lo'])
 assert.equal((await execute('ip',['route','show'])).stdout.trim(),'')
 assert.equal((await execute('ip',['-6','route','show','default'])).stdout.trim(),'')
 const {installation,browse,movein}=await import('./vane-helpers.mjs')
 const a=await installation();t.after(()=>a.close())
 await a.clock(Date.parse('2026-10-23T12:00:00Z'))
 const id=await a.addSite({paths:[]})
 const {context}=await browse(t,a)
 // The fixture origin must be registered just like a real site; use the site's actual origin.
 await context.route('https://fern.example/',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Offline collection</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`}))
 const page=await context.newPage(),collected=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect'&&r.request().method()==='POST')
 await page.goto('https://fern.example/');assert.equal((await collected).status(),202)
 await context.addCookies(a.owner.split('; ').map(pair=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:a.origin}}))
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});await page.goto(a.origin+`/app/sites/${id}?period=today`)
  assert.equal(await page.getByRole('heading',{name:'Pageviews',exact:true}).locator('..').locator('.vane-metric').textContent(),'1')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  if(screens){await mkdir(screens,{recursive:true});await page.screenshot({path:join(screens,`host-offline-report-${width}.png`)})}
 }
 const imported=await movein(a,id);assert.equal(imported.applied.complete,true)
 const archive=await a.archive(),b=await installation();t.after(()=>b.close());await b.clock(Date.parse('2026-10-23T12:00:00Z'))
 const restored=await b.post('/api/vane/restore',{archive},b.owner);assert.equal(restored.status,200)
 const summary=async app=>(await (await app.request(`/api/vane/summary?siteId=${id}&from=2020-01-01&to=2026-10-24`,{headers:{cookie:app.owner}})).json())
 const before=await summary(a),after=await summary(b);assert.ok(before.pageviews>1,'imported history is readable offline');assert.equal(after.pageviews,before.pageviews)
 assert.deepEqual((await b.archive()).payload.tables.vane_import_events,archive.payload.tables.vane_import_events)
 assert.deepEqual(a.egress,[]);assert.deepEqual(b.egress,[])
})
