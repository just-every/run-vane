import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
// Runs only in CI (verify.yml, job demo), after `rer setup` gives the checkout its own owner and data:
// it starts and stops `rer demo`, which shared development machines must not do.
const rer=(...args)=>{const r=spawnSync('pnpm',['exec','rer',...args],{encoding:'utf8',timeout:600000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout}
const files=dir=>existsSync(dir)?readdirSync(dir,{recursive:true}).filter(path=>statSync(join(dir,path)).isFile()).sort().map(path=>path+' '+createHash('sha256').update(readFileSync(join(dir,path))).digest('hex')):[]
test('DEMO-001 rer demo opens a signed-in Vane with three example sites, two weeks of traffic, goals and a pending change to approve, and stopping it removes its data',{skip:process.env.GITHUB_ACTIONS!=='true'&&'runs only in CI'},async t=>{
 const own=files('.wrangler/state');assert.ok(own.length,'rer setup created the checkout\'s own data')
 const out=rer('demo','--detach'),line=name=>out.match(new RegExp(`^${name} (\\S+)$`,'m'))?.[1],ready=line('RER_READY'),open=line('RER_OPEN'),state=line('RER_DEMO_ENDS_ON_STOP')
 assert.ok(ready&&open&&state&&existsSync(state),out)
 let stopped=false;t.after(()=>{if(!stopped)rer('demo','--stop')})
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const page=await (await browser.newContext()).newPage(),json=async path=>{const r=await page.request.get(ready+path);assert.equal(r.status(),200,path);return r.json()}
 await page.goto(open);await page.waitForURL(url=>!url.hash.includes('rer-dev')&&!url.pathname.startsWith('/__dev/')&&!url.pathname.startsWith('/auth/dev/'))
 await page.goto(ready+'/app');assert.equal(new URL(page.url()).pathname,'/app','the demo opens signed in')
 const sites=await json('/api/vane/sites');assert.deepEqual(new Set(sites.map(s=>s.name)),new Set(['Fern & Field','Tide Studio','Northline Coffee']))
 for(const site of sites) {
  await page.goto(`${ready}/app/sites/${site.id}?section=report`);await page.getByRole('heading',{name:site.name,level:1}).waitFor()
  // Two weeks: this week and the week before both have page loads, visits and goal conversions.
  const r=await json('/api/vane/summary?siteId='+site.id)
  for(const key of ['pageviews','previousPageviews','visits','previousVisits','goals','previousGoals','visitors'])assert.ok(r[key]>0,`${site.name} ${key}`)
  assert.ok(r.bounceRate>0&&r.averageDuration>0,`${site.name} bounces and engaged visits`)
 }
 const fern=sites.find(s=>s.name==='Fern & Field')
 await page.goto(`${ready}/app/sites/${fern.id}?section=approvals`)
 await page.locator('article.vane-proposal',{hasText:'demo-summer-campaign'}).getByRole('button',{name:'Approve change'}).click()
 await page.waitForURL(url=>url.searchParams.has('notice'))
 assert.ok((await json('/api/vane/sites')).find(s=>s.id===fern.id).config.campaigns.includes('summer-preview'),'the approved change applied')
 assert.equal((await json('/api/vane/proposals')).find(p=>p.id==='demo-summer-campaign').state,'approved')
 rer('demo','--stop');stopped=true
 assert.equal(existsSync(state),false,'the demo data folder is deleted');assert.deepEqual(readdirSync('.rer/demo'),[])
 assert.deepEqual(files('.wrangler/state'),own,'the checkout\'s own data is untouched')
 await assert.rejects(fetch(ready+'/health'),'the demo server is gone')
})
