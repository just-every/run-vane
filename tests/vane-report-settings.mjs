import test from 'node:test'
import { mkdir } from 'node:fs/promises'
import { assert, readFile, createHash, createHmac, crc32, createRequire, installation, appsScript, fixture, unlinked, withApp, DESKTOP_CHROME, browse, movein } from './vane-helpers.mjs'

test('COLLECT-004 public analytical reports keep retries exact, retain engagement and daily versus consented identities, rebuild older archives and erase history',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 await a.clock(Date.parse('2026-03-02T09:00:00Z'))
 const id=await a.addSite({retention:'forever',consentedVisitors:true}),consented={id:crypto.randomUUID(),createdAt:Date.parse('2026-03-01T12:00:00Z')}
 const load=async(at,path='/',linked=true)=>{
  await a.clock(Date.parse(at));const event=a.event(id,{path,width:1440,...(linked?{consent:'granted',consented}:{})})
  const response=await a.post('/api/vane/collect',event,'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.17','user-agent':DESKTOP_CHROME})
  assert.equal(response.status,202,await response.clone().text());return event
 }
 const first=await load('2026-03-02T09:00:00Z')
 const repeats=await Promise.all(Array.from({length:4},()=>a.post('/api/vane/collect',first,'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.17','user-agent':DESKTOP_CHROME})))
 for(const repeat of repeats){assert.equal(repeat.status,200);assert.equal((await repeat.json()).duplicate,true)}
 await load('2026-03-02T09:05:00Z','/thanks')
 const engaged=await load('2026-03-03T09:00:00Z')
 await load('2026-03-03T10:00:00Z','/',false)
 const query=`/api/vane/summary?siteId=${id}&from=2026-03-02&to=2026-03-04&interval=day`,summary=async(app=a)=>{
  const response=await app.request(query,{headers:{cookie:app.owner}});assert.equal(response.status,200,await response.clone().text());return response.json()
 }
 await a.clock(Date.parse('2026-03-04T12:00:00Z'))
 assert.equal((await summary()).bounces,2)
 // Move only the gated product clock: engagement remains the normal public
 // door and changes the visit metric without adding another occurrence.
 await a.clock(Date.parse('2026-03-03T09:00:12Z'))
 assert.equal((await a.post('/api/vane/engage',{siteId:id,id:engaged.id,scroll:80},'',{origin:'https://fern.example'})).status,202)
 const running=await (await a.request(`/api/vane/summary?siteId=${id}&period=today&interval=day`,owner)).json()
 assert.deepEqual([running.pageviews,running.previousPageviews,running.previousVisitors,running.previousGoals,running.previousSeries[0].pageviews],[2,1,1,0,1],'today includes admitted rows; its comparison stops at the matching prior-day instant')
 await a.clock(Date.parse('2026-03-04T12:00:00Z'))
 const report=await summary()
 assert.deepEqual([report.pageviews,report.goals,report.visitors,report.visits,report.bounces,report.converters,report.transport.direct],[4,1,2,3,1,1,4])
 assert.deepEqual(report.series.map(r=>[r.label,r.pageviews,r.visitors,r.conversions]),[['2026-03-02',2,1,1],['2026-03-03',2,2,0]])
 assert.deepEqual(report.pages.map(r=>[r.label,r.count]).sort(),[['/',3],['/thanks',1]])
 assert.deepEqual(report.devices.map(r=>[r.label,r.pageviews,r.visitors]),[['desktop',4,2]])
 const overview=await (await a.request('/app?period=7d',owner)).text();assert.match(overview,new RegExp(`data-site="${id}"[^]*?data-visitors="2"`))
 const archive=await a.archive(),older=structuredClone(archive)
 delete older.payload.tables.vane_analytics_cells;delete older.payload.tables.vane_analytics_identities
 older.sha256=createHash('sha256').update(JSON.stringify(older.payload)).digest('hex')
 const b=await withApp(t);await b.clock(Date.parse('2026-03-04T12:00:00Z'))
 const restored=await b.post('/api/vane/restore',{archive:older},b.owner);assert.equal(restored.status,200,await restored.clone().text())
 const after=await summary(b)
 assert.deepEqual([after.pageviews,after.goals,after.visitors,after.visits,after.bounces,after.pages,after.devices,after.series],[report.pageviews,report.goals,report.visitors,report.visits,report.bounces,report.pages,report.devices,report.series])
 const proposal=await (await b.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},b.owner)).json()
 assert.equal((await b.form({operation:'proposal.approve',id:proposal.id},b.owner)).status,303)
 const erased=await summary(b)
 assert.deepEqual([erased.pageviews,erased.goals,erased.visitors,erased.visits,erased.transport.total,erased.pages,erased.devices],[0,0,0,0,0,[],[]])
})

test('RETENTION-002 a keep-forever site keeps 30 months of imported history and today\'s events, 25 months erases only older events with one journal entry, and a store past 80% of its capacity warns with both choices and drops nothing',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 await a.clock(Date.parse('2026-10-19T12:00:00Z'));const id=await a.addSite({retention:'forever'})
 const bytesOf=async(app,cookie)=>Number((await (await app.request('/app?section=history',{headers:{cookie}})).text()).match(/data-store-bytes="(\d+)"/)[1]),fresh=await bytesOf(a,a.owner)
 const months=Array.from({length:30},(_,i)=>new Date(Date.UTC(2024,3+i,15,10)).toISOString()),history=structuredClone(fixture)
 history.data=months.map((createdAt,i)=>({...structuredClone(fixture.data[0]),id:`synthetic-month-${i}`,sessionId:`synthetic-month-session-${i}`,createdAt}));history.count=history.pageSize=30
 // The import applies in batches; the same reviewed document is applied again until it is complete.
 const {preview}=await movein(a,id,history);for(let n=0;n<5;n++){const r=await (await a.post('/api/vane/import-apply',{siteId:id,document:preview.carry,fingerprint:preview.fingerprint},a.owner)).json();if(r.complete)break}
 assert.equal((await a.collect(a.event(id))).status,202)
 const pageviews=async(from,to)=>(await (await a.request(`/api/vane/summary?siteId=${id}&from=${from}&to=${to}`,owner)).json()).pageviews
 // Apply retention erases one imported event per run, so the owner repeats it until none remain.
 const retain=async()=>{for(let n=0;n<10;n++){const r=await a.form({operation:'history.retention',siteId:id},a.owner);assert.equal(r.status,303);const notice=new URL(r.headers.get('location'),a.origin).searchParams.get('notice');if(!/remain to expire/.test(notice))return notice}throw new Error('retention did not finish')}
 assert.match(await retain(),/erased nothing/)
 let tables=(await a.archive()).payload.tables
 assert.deepEqual([tables.vane_import_events.length,tables.vane_events.length,tables.vane_deletions.length],[30,1,0],'every imported and live event remains')
 assert.deepEqual([await pageviews('2024-04-15','2024-04-16'),await pageviews('2024-04-15','2026-10-20')],[1,31],'the oldest imported day still returns its event')
 assert.equal((await (await a.request('/api/vane/inventory?siteId='+id,owner)).json()).retention,'as long as this installation exists')
 assert.match(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text(),/<option value="forever" selected>As long as this installation exists<\/option>/)
 // 25 months before 19 October 2026 is 19 September 2024: the six monthly rows before it go, the other 24 and today's event stay.
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',sampleRate:100,retention:'25m'}
 const changed=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:changed.id},a.owner)).status,303)
 assert.match(await retain(),/Retention applied/)
 tables=(await a.archive()).payload.tables
 assert.deepEqual([tables.vane_import_events.length,tables.vane_events.length,tables.vane_deletions.map(d=>d.before_day)],[24,1,['2024-09-19']])
 assert.deepEqual([await pageviews('2024-04-15','2024-09-19'),await pageviews('2024-09-19','2026-10-20')],[0,25])
 // A fixture store whose published capacity puts a fresh installation 5% under the 80% warning.
 const b=await installation({vars:{VANE_STORE_LIMIT_MB:String(fresh*1.05/0.8/1048576)}});t.after(()=>b.close())
 await b.clock(Date.parse('2026-10-19T12:00:00Z'));const small=await b.addSite(),warning=async path=>(await (await b.request(path,{headers:{cookie:b.owner}})).text()).match(/<div class="vane-error" role="alert" data-store-share="[^"]*">([^<]*)<\/div>/)?.[1]
 assert.equal(await warning('/app'),undefined,'below 80% no page warns')
 let sent=0;while(!await warning('/app')){for(let n=0;n<25;n++,sent++)assert.equal((await b.collect(b.event(small))).status,202);assert.ok(sent<5000,'the store reaches 80%')}
 for(const path of ['/app',`/app/sites/${small}?section=report`,`/app/sites/${small}?section=history`]){const text=await warning(path);assert.match(text,/a scheduled warehouse export of older events/,path);assert.match(text,/a shorter retention window/,path)}
 for(let n=0;n<5;n++,sent++)assert.equal((await b.collect(b.event(small))).status,202,'nothing is turned away at 80%')
 assert.equal((await (await b.request(`/api/vane/summary?siteId=${small}&period=today`,{headers:{cookie:b.owner}})).json()).pageviews,sent,'every event is kept')
 if(process.env.VANE_SCREEN_DIR){
  await mkdir(process.env.VANE_SCREEN_DIR,{recursive:true});const {context}=await browse(t,b)
  await context.addCookies(b.owner.split('; ').map(pair=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:b.origin}}))
  const page=await context.newPage()
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});for(const [name,path] of [['collection-report',`/app/sites/${small}?period=today`],['collection-capacity',`/app/sites/${small}?section=history`]]){
   await page.goto(b.origin+path);assert.equal(await page.getByRole('alert').isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`${process.env.VANE_SCREEN_DIR}/${name}-${width}.png`})
  }}
 }

})
test('DASH-010 three sites sort by change and search on the overview, and a roll-up of two sums visitors and visits per site with the cross-site note, exact pageview and conversion sums, a recomputed bounce rate and a split by site',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 await a.clock(Date.parse('2026-10-10T12:00:00Z'))
 const fern=await a.addSite(),oak=await a.addSite({name:'Oak Books',origin:'https://oak.example'}),elm=await a.addSite({name:'Elm Bakery',origin:'https://elm.example'})
 const visit=async(siteId,origin,ip,path='/')=>assert.equal((await a.post('/api/vane/collect',a.event(siteId,{path}),'',{origin,'cf-connecting-ip':ip,'user-agent':'Synthetic Browser'})).status,202)
 // Previous seven days: five Elm visitors and one Oak visitor.
 for(const n of [11,12,13,14,15])await visit(elm,'https://elm.example',`198.51.100.${n}`);await visit(oak,'https://oak.example','198.51.100.16')
 // Today: one person (same IP and user agent) on Fern and Oak, a second Fern visitor who converts five minutes later, a second Oak visitor and one Elm visitor.
 await a.clock(Date.parse('2026-10-17T14:00:00Z'))
 await visit(fern,'https://fern.example','203.0.113.1');await visit(oak,'https://oak.example','203.0.113.1');await visit(fern,'https://fern.example','203.0.113.2');await visit(oak,'https://oak.example','203.0.113.3');await visit(elm,'https://elm.example','203.0.113.4')
 await a.clock(Date.parse('2026-10-17T14:05:00Z'));await visit(fern,'https://fern.example','203.0.113.2','/thanks')
 await a.clock(Date.parse('2026-10-17T15:00:00Z'))
 const listed=async query=>{const html=await (await a.request('/app'+query,owner)).text();return [...html.matchAll(/<li data-site="([^"]+)">.*?data-visitors="(\d+)".*?data-change="(-?\d+)">([^<]*)<\/span>.*?<svg class="vane-sparkline"[^>]*aria-label="Visitors trend: ([^"]*)"/g)].map(m=>[m[1],Number(m[2]),m[4],m[5].split(', ').length])}
 assert.deepEqual(await listed('?sort=change'),[[fern,2,'+2 (new)',7],[oak,2,'+1 (+100.0%)',7],[elm,1,'-4 (-80.0%)',7]],'sorted by change, largest increase first, each with a seven-day sparkline')
 assert.deepEqual((await listed('?sort=visitors&q=OAK')).map(r=>r[0]),[oak],'search matches names and origins, ignoring case')
 // Only the owner creates a roll-up.
 const admin=await a.invite('admin@example.test','admin')
 assert.equal((await a.form({operation:'rollup.create',name:'Marketing and store',[`site_${fern}`]:'on',[`site_${oak}`]:'on'},admin)).status,403)
 const created=await a.form({operation:'rollup.create',name:'Marketing and store',[`site_${fern}`]:'on',[`site_${oak}`]:'on'},a.owner);assert.equal(created.status,303)
 const rollupId=created.headers.get('location').match(/^\/app\/rollups\/([\w-]+)\?/)[1]
 const summary=async query=>(await (await a.request(`/api/vane/summary?${query}`,owner)).json())
 const r=await summary(`rollupId=${rollupId}&period=today`),f=await summary(`siteId=${fern}&period=today`),o=await summary(`siteId=${oak}&period=today`)
 assert.deepEqual([r.visitors,r.visits,r.pageviews,r.goals,r.bounces,r.bounceRate],[4,4,5,1,3,75],'4 visitors and 4 visits summed per site, exact sums, and 3 bounced of 4 summed visits')
 assert.deepEqual([r.visitors,r.visits,r.pageviews,r.goals],[f.visitors+o.visitors,f.visits+o.visits,f.pageviews+o.pageviews,f.goals+o.goals])
 // Split by site: each row is one site's own figures.
 const split=await summary(`rollupId=${rollupId}&period=today&split=site`),pick=rows=>rows.map(row=>[row.path,row.visitors,row.pageviews,row.bounceRate])
 assert.deepEqual(pick(split.topPages),[...pick(f.topPages).map(([p,...x])=>['Fern Studio · '+p,...x]),...pick(o.topPages).map(([p,...x])=>['Oak Books · '+p,...x])])
 assert.deepEqual(split.channels.map(row=>[row.label,row.visitors,row.visits]),[...f.channels.map(row=>['Fern Studio · '+row.label,row.visitors,row.visits]),...o.channels.map(row=>['Oak Books · '+row.label,row.visitors,row.visits])])
 const page=await (await a.request(`/app/rollups/${rollupId}?period=today`,owner)).text()
 for(const text of ['<h2>Unique visitors (summed per site)</h2>','<h2>Visits (summed per site)</h2>','counts once per site','<a href="/methodology#roll-ups">'])assert.ok(page.includes(text),text)
 assert.match(page,/<p class="vane-metric">4<\/p>/)
 const methodology=await (await a.request('/methodology')).text()
 for(const rule of ['id="roll-ups"','sum of each site’s own counts','labelled summed per site','Pageviews, goal conversions and other events are exact sums','recomputed from the summed visits and conversions, never averaged across sites'])assert.ok(methodology.includes(rule),rule)
})
test('DASH-011 visits through home → pricing → signup and home → blog → exit give the journeys from home, entering at a page, and to signup with their counts and drop-off',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 const id=await a.addSite({paths:[]}),start=Date.parse('2026-10-17T10:00:00Z')
 // Three visitors a minute apart per step: two go home → pricing → signup, one goes home → blog and leaves; a fourth enters at the blog.
 const walk=async(ip,offset,paths)=>{for(const [i,path] of paths.entries()){await a.clock(start+offset+i*60000);assert.equal((await a.post('/api/vane/collect',a.event(id,{path}),'',{origin:'https://fern.example','cf-connecting-ip':ip,'user-agent':'Synthetic Browser'})).status,202)}}
 await walk('203.0.113.1',0,['/','/pricing','/signup']);await walk('203.0.113.2',300000,['/','/blog']);await walk('203.0.113.3',600000,['/','/pricing','/signup']);await walk('203.0.113.4',900000,['/blog'])
 await a.clock(Date.parse('2026-10-17T12:00:00Z'))
 const journey=async query=>(await (await a.request(`/api/vane/summary?siteId=${id}&period=today&${query}`,owner)).json()).journey
 const home=await journey('journey=/')
 assert.deepEqual([home.visits,home.next.map(r=>[r.steps.join(' → '),r.visits]),home.previous.map(r=>[r.steps.join(' ← '),r.visits])],[3,[['/pricing → /signup → (exit)',2],['/blog → (exit)',1]],[['(entrance)',3]]])
 assert.deepEqual(home.nextSteps.map(s=>[s.step,s.reached,s.continuing,s.dropOff]),[[1,3,3,0],[2,3,2,1],[3,2,0,2]])
 const signup=await journey('journey=/signup');assert.deepEqual(signup.previous.map(r=>[r.steps.join(' ← '),r.visits]),[['/pricing ← / ← (entrance)',2]])
 const blog=await journey('journey=/blog&journeyMode=entry');assert.deepEqual([blog.visits,blog.next.map(r=>[r.steps.join(' → '),r.visits])],[1,[['(exit)',1]]],'only the visit that entered at /blog')
 assert.equal((await journey('journey=/pricing&journeyMode=entry')).visits,0)
 assert.equal((await journey('')).path,'/','the most loaded page by default')
 // On the page, every page row links to its journeys, and the journey tables show the paths and their counts.
 const page=await (await a.request(`/app/sites/${id}?section=report&period=today&journey=%2F`,owner)).text()
 assert.match(page,/<a href="\?section=report&amp;journey=%2Fpricing&amp;journeyMode=page&amp;period=today#journeys" aria-label="Journeys through \/pricing">Journeys<\/a><\/td><\/tr>/)
 assert.match(page,/<a href="\?section=report&amp;journey=%2Fblog&amp;journeyMode=entry&amp;period=today#journeys" aria-label="Journeys entering at \/blog">/)
 for(const [steps,visits] of [['/pricing → /signup → (exit)',2],['/blog → (exit)',1]])assert.ok(page.includes(`<tr><th scope="row">${steps.replaceAll('>','&gt;')}</th><td class="vane-number">${visits}</td>`)||page.includes(`<tr><th scope="row">${steps}</th><td class="vane-number">${visits}</td>`),steps)
})
test('DASH-001 in a browser the real-time view shows current visitors, pageviews per minute and live pages and sources against 30 minutes earlier, updates within 15 seconds without a reload, and drops visitors idle for 5 minutes',async t=>{
 const a=await withApp(t),id=await a.addSite({paths:['/','/pricing','/thanks']}),owner={headers:{cookie:a.owner}},T=Date.parse('2026-03-02T15:00:30Z'),loads={}
 const load=async(at,n,extra)=>{await a.clock(at);const e=a.event(id,{source:undefined,...extra});loads[n]=e.id;assert.equal((await a.post('/api/vane/collect',e,'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':'Synthetic Browser '+n})).status,202)}
 // 32 minutes earlier, one visitor from Google on /pricing: the compared window.
 await load(T-32*60000,1,{path:'/pricing',referrer:'https://www.google.com/'});await a.clock(T)
 const {context}=await browse(t,a,{},{viewport:{width:1440,height:900}});await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 const tab=await context.newPage(),response=await tab.goto(`${a.origin}/app/sites/${id}?section=realtime`),policy=response.headers()['content-security-policy']
 assert.match(policy,/script-src 'nonce-[\w-]+'; connect-src 'self';/);assert.match((await a.request(`/app/sites/${id}?section=report`,owner)).headers.get('content-security-policy'),/script-src 'none'; connect-src 'none';/)
 const text=selector=>tab.evaluate(s=>document.querySelector(s)?.textContent??null,selector),rowsOf=title=>tab.evaluate(t=>[...document.querySelectorAll(`table[data-live="${t}"] tbody tr`)].map(r=>[...r.children].map(c=>c.textContent)),title)
 assert.equal(await text('[data-current-visitors]'),'0');assert.deepEqual(await rowsOf('Live pages'),[['/pricing','0','1','-1 (-100.0%)']])
 await tab.evaluate(()=>{window.vaneSameDocument=true})
 await load(T,2,{path:'/',referrer:'https://news.ycombinator.com/item?id=1'});await load(T,3,{path:'/pricing',referrer:'https://www.google.com/'});await load(T+20000,2,{path:'/pricing'})
 const sent=Date.now();await tab.waitForFunction(()=>document.querySelector('[data-current-visitors]')?.textContent==='2',null,{timeout:15000});assert.ok(Date.now()-sent<=15000)
 assert.equal(await tab.evaluate(()=>window.vaneSameDocument),true,'the view refreshed without a reload')
 assert.deepEqual(await rowsOf('Live pages'),[['/pricing','2','1','+1 (+100.0%)']])
 assert.deepEqual(await rowsOf('Live sources'),[['Google','1','1','0 (0.0%)'],['Hacker News','1','0','+1 (new)']])
 assert.equal(await text('[data-live-pageviews]'),'3');assert.deepEqual(await tab.evaluate(()=>[...document.querySelectorAll('[data-minute-pageviews]')].map(c=>c.textContent).slice(-2)),['0','3'])
 const live=await (await a.request('/api/vane/realtime?siteId='+id,owner)).json();assert.deepEqual([live.currentVisitors,live.previousCurrentVisitors,live.pageviews,live.previousPageviews,live.minutes.length,live.minutes.at(-1).label,live.minutes.at(-1).pageviews],[2,1,3,1,30,'15:00',3])
 assert.equal((await a.request('/api/vane/realtime?siteId='+id)).status,401)
 // An engagement ping keeps visitor 3 current; at 5 minutes idle the others drop.
 await a.clock(T+4*60000);assert.equal((await a.post('/api/vane/engage',{siteId:id,id:loads[3],scroll:40},'',{origin:'https://fern.example'})).status,202)
 await a.clock(T+20000+5*60000);await tab.waitForFunction(()=>document.querySelector('[data-current-visitors]')?.textContent==='1',null,{timeout:15000})
 assert.deepEqual(await rowsOf('Live pages'),[['/pricing','1','0','+1 (new)']]);assert.deepEqual(await rowsOf('Live sources'),[['Google','1','0','+1 (new)']])
 await a.clock(T+9*60000+1000);await tab.waitForFunction(()=>document.querySelector('[data-current-visitors]')?.textContent==='0',null,{timeout:15000})
 assert.deepEqual([await rowsOf('Live pages'),await rowsOf('Live sources')],[[],[]])
 await tab.setViewportSize({width:390,height:844});assert.ok(await tab.evaluate(()=>document.documentElement.scrollWidth<=390),'no horizontal scroll at 390 px')
 await context.close()
})
test('METRIC-004 the signed-out methodology page defines every metric the dashboard links to, and an owner-approved visit timeout is a dated definition version annotated on the charts it affects',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},admin=await a.invite('admin@example.test','admin'),id=await a.addSite(),oak=await a.addSite({name:'Oak Store',origin:'https://oak.example'})
 const load=async(site,origin,at)=>{await a.clock(at);assert.equal((await a.post('/api/vane/collect',a.event(site),'',{origin,'cf-connecting-ip':'203.0.113.4','user-agent':'Synthetic Browser 4'})).status,202)}
 const at=(d,minutes)=>Date.parse(d+'T09:00:00Z')+minutes*60000
 // 2 March, under the 30-minute default: page loads 40 minutes apart are two visits.
 for(const m of [0,40])await load(id,'https://fern.example',at('2026-03-02',m))
 const methodology=await a.request('/methodology');assert.equal(methodology.status,200);const page=await methodology.text()
 const report=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-01&to=2026-03-08`,owner)).text(),links=[...new Set([...report.matchAll(/href="\/methodology#([a-z-]+)"/g)].map(m=>m[1]))]
 for(const anchor of ['unique-visitors','visits','pageviews','pages-per-visit','bounce-rate','visit-duration','conversions','time-on-page','scroll-depth'])assert.ok(links.includes(anchor),anchor)
 for(const anchor of [...links,'revenue','consented-mode','definition-versions','estimation','roll-ups'])assert.ok(page.includes(`id="${anchor}"`),anchor)
 for(const phrase of ['exactly two declared exceptions','never averaged across sites','never scaled up','a whole number of minutes from 15 to 120'])assert.ok(page.includes(phrase),phrase)
 // An administrator prepares the change, only 15 to 120 minutes are accepted, forged versions are ignored, and only the owner approves.
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',sampleRate:100,retentionDays:90}
 for(const visitTimeout of [10,121,30.5])assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{...input,visitTimeout}},admin)).status,400)
 const p=await (await a.post('/api/vane/commands',{command:'site.configure',input:{...input,visitTimeout:45,definitions:[{metric:'visit-timeout',from:'2020-01-01',minutes:120,previous:30,approvedAt:0}]}},admin)).json()
 assert.equal((await a.form({operation:'proposal.approve',id:p.id},admin)).status,403)
 await a.clock(Date.parse('2026-03-05T08:00:00Z'));assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)
 // 5 March, under version 2 (45 minutes): gaps of 40 and 50 minutes make two visits; Oak keeps its 30 minutes.
 for(const m of [0,40,90])await load(id,'https://fern.example',at('2026-03-05',m))
 for(const m of [0,40])await load(oak,'https://oak.example',at('2026-03-05',m))
 const summary=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-01&to=2026-03-08`,owner)).json()
 assert.equal(summary.visits,4,'2 March keeps the 30-minute version, 5 March uses 45 minutes');assert.match(summary.explanation,/no gap over 45 minutes \(the visit definition changed in this range/)
 const note='Visit definition v2: a visit ends after 45 minutes without a page load (was 30).'
 for(const metric of ['visits','bounceRate','duration']){const html=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-01&to=2026-03-08&metric=${metric}`,owner)).text();assert.ok(html.includes('data-annotation="2026-03-05"')&&html.includes(`<time datetime="2026-03-05">Mar 5, 2026</time> ${note}`),metric)}
 for(const query of ['metric=pageviews&from=2026-03-01&to=2026-03-08','metric=visits&from=2026-03-06&to=2026-03-08'])assert.ok(!(await (await a.request(`/app/sites/${id}?section=report&${query}`,owner)).text()).includes('data-annotation='),query)
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes('Now visit definition v2, 45 minutes, since 2026-03-05.'))
 // A roll-up applies each site's own version and names the site in the annotation.
 const created=await a.form({operation:'rollup.create',name:'Both',[`site_${id}`]:'on',[`site_${oak}`]:'on'},a.owner),rollup=created.headers.get('location').match(/\/app\/rollups\/([\w-]+)/)[1]
 const rolled=await (await a.request(`/api/vane/summary?rollupId=${rollup}&from=2026-03-01&to=2026-03-08`,owner)).json();assert.equal(rolled.visits,6)
 assert.ok((await (await a.request(`/app/rollups/${rollup}?from=2026-03-01&to=2026-03-08&metric=visits`,owner)).text()).includes(`<time datetime="2026-03-05">Mar 5, 2026</time> Fern Studio: ${note}`))
})
test('COLLECT-003 a headless browser, crawlers, Cloudflare low bot scores and verified bots, data-centre networks, referrer spam, excluded IP ranges, an excluded country and the owner\'s opted-out browser are refused and counted by reason beside real visits, and refused loads keep only counters while admitted loads keep declared location names',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({excludeIps:'198.51.100.0/24\n2001:db8::/32',excludeCountries:'ca',autoEvents:['outbound']})
 const chrome='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',googlebot='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
 // cf carries Cloudflare's request fields (bot score, verified bot, ASN) at the Worker's fetch door.
 const send=(headers,extra={},cf)=>a.request('/api/vane/collect',{method:'POST',headers:{origin:'https://fern.example','content-type':'application/json','user-agent':chrome,'cf-connecting-ip':'203.0.113.20',...headers},body:JSON.stringify(a.event(id,extra)),...(cf?{cf}:{})})
 // A real headless browser's page load is refused as automation.
 const {context}=await browse(t,a,{'https://fern.example/':`<!doctype html><title>Fern</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`},{userAgent:null}),tab=await context.newPage()
 const refused=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await tab.goto('https://fern.example/');assert.equal((await refused).status(),403);await context.close()
 // The owner's opted-out browser sends only an empty count.
 const own=await browse(t,a,{'https://fern.example/':`<!doctype html><title>Fern</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`}),ownTab=await own.context.newPage(),sent=[];ownTab.on('request',r=>sent.push(new URL(r.url()).pathname))
 const ignored=ownTab.waitForRequest(r=>new URL(r.url()).pathname==='/api/vane/ignored/'+id);await ownTab.goto('https://fern.example/#vane-ignore=on');const count=await ignored
 assert.equal(count.postData()??'','');assert.equal((await count.response()).status(),202);await ownTab.waitForTimeout(500);assert.ok(!sent.includes('/api/vane/collect'),'nothing is collected');await own.context.close()
 assert.equal((await a.post('/api/vane/ignored/'+id,{path:'/'},'',{origin:'https://fern.example'})).status,400,'the count carries no fields')
 // Real visits, one from an address just outside the excluded range and one from a residential network that Cloudflare scores as human.
 for(const ip of ['203.0.113.20','198.51.101.7'])assert.equal((await send({'cf-connecting-ip':ip})).status,202)
 assert.equal((await send({},{},{country:'US',region:'Texas',regionCode:'TX',city:'Austin',postalCode:'78799-never-store',latitude:'30.1234567',longitude:'-97.7654321',timezone:'America/never-store',asn:7922,botManagement:{score:85,verifiedBot:false}})).status,202)
 const beforeRefused=await a.dump()
 for(const [headers,extra,reason,cf] of [[{'user-agent':googlebot},{},'bot'],[{'user-agent':'curl/8.4.0'},{},'bot'],[{},{referrer:'https://semalt.com/'},'referrer-spam'],[{'cf-connecting-ip':'198.51.100.7'},{},'excluded-ip'],[{'cf-connecting-ip':'2001:db8::5'},{},'excluded-ip'],[{'cf-ipcountry':'CA'},{},'excluded-country'],[{},{},'bot',{botManagement:{score:12,verifiedBot:false}}],[{},{},'bot',{botManagement:{score:95,verifiedBot:true}}],[{},{},'data-centre',{asn:16509}],[{},{},'data-centre',{asn:24940}]]){const r=await send(headers,extra,cf);assert.equal(r.status,403,reason);assert.ok((await r.json()).message.endsWith(`(${reason}).`),reason)}
 const afterRefused=await a.dump();for(const [table,rows] of Object.entries(beforeRefused))if(table!=='vane_exclusions')assert.deepEqual(afterRefused[table],rows,`refused page loads write no ${table} records`)
 assert.ok(afterRefused.vane_events.some(e=>e.country==='United States'&&e.region==='Texas'&&e.city==='Austin'))
 const archived=JSON.stringify([afterRefused,await a.archive()]);for(const raw of ['78799-never-store','30.1234567','-97.7654321','America/never-store','\"TX\"',chrome])assert.equal(archived.includes(raw),false,raw)
 const event=(headers,cf)=>a.request('/api/vane/event',{method:'POST',headers:{origin:'https://fern.example','content-type':'application/json','user-agent':chrome,...headers},body:JSON.stringify({id:crypto.randomUUID(),siteId:id,kind:'outbound',prop:'https://elsewhere.example/',consent:'not-required'}),...(cf?{cf}:{})})
 for(const [headers,cf] of [[{'user-agent':googlebot}],[{},{botManagement:{score:4}}],[{},{asn:14061}]])assert.equal((await event(headers,cf)).status,403,'automatic events from excluded traffic are refused');assert.equal((await event({})).status,202)
 const summary=await (await a.request('/api/vane/summary?siteId='+id,owner)).json();assert.equal(summary.pageviews,3)
 assert.deepEqual(summary.exclusions,[{reason:'bot',count:5},{reason:'data-centre',count:2},{reason:'excluded-country',count:1},{reason:'excluded-ip',count:2},{reason:'own-browser',count:1},{reason:'referrer-spam',count:1}])
 const report=await (await a.request(`/app/sites/${id}?section=report`,owner)).text()
 for(const row of ['<dt>Bots and automation</dt><dd>5 of 8 page loads that reached Vane (62.5%), not collected.</dd>','<dt>Data-centre networks</dt><dd>2 of 5 page loads that reached Vane (40.0%), not collected.</dd>','<dt>Excluded IP addresses</dt><dd>2 of 5','<dt>Excluded countries</dt><dd>1 of 4','<dt>Referrer spam</dt><dd>1 of 4','<dt>Own browser (opted out)</dt><dd>1 of 4'])assert.ok(report.includes(row),row)
 const stored=JSON.stringify(await a.dump());for(const value of ['198.51.100.7','2001:db8::5','203.0.113.20','Googlebot','HeadlessChrome','curl/','semalt'])assert.ok(!stored.includes(value),value)
 const settings=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text();assert.ok(settings.includes('198.51.100.0/24\n2001:db8::/32')&&settings.includes('value="CA"'))
 const door=await (await a.request('/api/vane/config/'+id,{headers:{origin:'https://fern.example'}})).text();assert.ok(!/198\.51|2001:db8|"CA"|excludeIps|excludeCountries/.test(door),'the public config door never shows the owner\'s exclusions')
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required'}
 for(const extra of [{excludeIps:'198.51.100.0/33'},{excludeIps:'example.com'},{excludeCountries:'ZZ'},{excludeCountries:Array.from({length:31},(_,i)=>String.fromCharCode(65+i%26)+String.fromCharCode(65+Math.floor(i/26))).join(' ')}])assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{...input,...extra}},a.owner)).status,400,JSON.stringify(extra))
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['id="excluded-traffic"','headlesschrome','semalt.com','AS16509 Amazon AWS','never stored'])assert.ok(methodology.includes(phrase),phrase)
})
test('REPORT-003 a week where organic search falls 40% on one page names that channel and page with their totals, lists the range\'s annotation and coverage change, and judges each day against the 95% day-of-week prediction interval',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},input={name:'Fern Studio',origin:'https://fern.example',paths:[],excludePaths:['/admin/**'],goals:{},consent:'not-required',sampleRate:100,retentionDays:365},id=await a.addSite(input)
 const DAY=86400000,date=ms=>new Date(ms).toISOString().slice(0,10),range=Date.parse('2026-03-09T00:00:00Z')
 const visit=async(at,k,organic)=>{await a.clock(at);assert.equal((await a.post('/api/vane/collect',a.event(id,organic?{path:'/pricing',source:undefined,campaign:undefined,referrer:'https://www.google.com/'}:{path:'/',source:undefined,campaign:undefined}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+k,'user-agent':'Synthetic Browser 7'})).status,202)}
 const day=async(start,organic,direct)=>{for(let k=0;k<organic+direct;k++)await visit(start+(9*60+k*5)*60000,k+1,k<organic)}
 // Weeks 2-8 before the range: 4 or 6 direct visits a day, alternating by week; week 1 (the compared week): 4 a day, 10 of them organic.
 for(let week=8;week>=2;week--)for(let d=0;d<7;d++)await day(range-week*7*DAY+d*DAY,0,week%2?4:6)
 for(const [d,organic] of [2,2,2,1,1,1,1].entries())await day(range-7*DAY+d*DAY,organic,4-organic)
 // The range: organic 6 (−40%), direct 18 as before; Monday has 4 visits, Tuesday 1.
 for(const [d,[organic,direct]] of [[2,2],[0,1],[1,3],[1,3],[1,3],[1,3],[0,3]].entries())await day(range+d*DAY,organic,direct)
 await a.clock(range+2*DAY+12*3600000);assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/admin/users'}),'',{origin:'https://fern.example'})).status,403)
 const p=await (await a.post('/api/vane/commands',{command:'site.configure',input:{...input,siteId:id,visitTimeout:45}},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)
 const summary=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-09&to=2026-03-16`,owner)).json(),e=summary.explain
 assert.deepEqual([summary.visits,summary.previousVisits],[24,28])
 const moved=e.movers.map(m=>[m.dimension,m.label,m.then,m.now,m.totalThen,m.totalNow])
 // Every visit shares one device class and the local Miniflare location (DASH-005), so those dimensions move with the total.
 assert.deepEqual(moved.filter(m=>!['Device','Country','Region','City','US metro area'].includes(m[0])),[['Channel','Organic Search',10,6,28,24],['Page','/pricing',10,6,28,24]],'direct and / are stable, so only organic search and /pricing moved')
 assert.deepEqual(e.annotations.map(n=>n.day),['2026-03-11']);assert.deepEqual(e.coverage,[{label:'excluded-path',now:1,then:0}])
 const judged=Object.fromEntries(e.variation.map(d=>[d.day,d.metrics?.visitors]))
 // Monday's baseline leaves out MLK Day and Washington's Birthday: 4,6,6,4,6,6 gives 5.33 ± 2.571·s·√(7/6); Tuesday's eight give 5 ± 2.365·s·√(9/8).
 assert.deepEqual(judged['2026-03-09'],{value:4,low:2.5,high:8.2,within:true});assert.deepEqual(judged['2026-03-10'],{value:1,low:2.3,high:7.7,within:false})
 const html=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-09&to=2026-03-16`,owner)).text()
 for(const phrase of ['Channel Organic Search: 10 → 6 visits (−4, −40%), of 28 → 24 visits in all.','Page /pricing: 10 → 6 pageviews (−4, −40%), of 28 → 24 pageviews in all.','Mar 11, 2026: Visit definition v2','Excluded paths: 0 → 1.','2.3 to 7.7: outside normal variation','2.5 to 8.2: within normal variation'])assert.ok(html.includes(phrase),phrase)
 assert.ok(!/because|caused|due to/i.test(html.slice(html.indexOf('Weekly explanation'),html.indexOf('What moved')+4000)),'the explanation never claims a cause')
 const holiday=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-02-16&to=2026-02-18`,owner)).json();assert.deepEqual(holiday.explain.variation.map(d=>[d.day,d.holiday??null,Boolean(d.metrics)]),[['2026-02-16','Washington’s Birthday',false],['2026-02-17',null,true]])
 assert.equal((await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-01-01&to=2026-03-16`,owner)).json()).explain.variation,null,'ranges over 31 days are not judged')
})
test('CONV-004 conversions from Google and from email give every channel, source, UTM, entry-page and device row its conversions and conversion rate for the selected goal, or for any goal',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/thanks',demo:'/demo'}})
 const desktop='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
 const start=Date.parse('2026-03-03T10:00:00Z'),google={source:undefined,campaign:undefined,referrer:'https://www.google.com/'},email={source:undefined,campaign:'spring',utm:{source:'newsletter',medium:'email'}}
 const visit=async(n,agent,first,paths)=>{for(const [i,path] of paths.entries()){await a.clock(start+n*600000+i*60000);assert.equal((await a.post('/api/vane/collect',a.event(id,{...(i?{source:undefined,campaign:undefined}:first),path}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':agent})).status,202)}}
 await visit(1,desktop,google,['/','/thanks']);await visit(2,desktop,google,['/']);await visit(3,iphone,google,['/','/demo']);await visit(4,desktop,email,['/pricing','/thanks']);await visit(5,desktop,email,['/pricing'])
 const summary=async goal=>(await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-03&to=2026-03-04${goal?'&goal='+goal:''}`,owner)).json()
 const pick=rows=>Object.fromEntries(rows.map(r=>[r.label??r.path,[r.visits,r.conversions,r.conversionRate]]))
 const signup=await summary('signup')
 assert.deepEqual(pick(signup.channels),{'Organic Search':[3,1,33.3],Email:[2,1,50]})
 assert.deepEqual(pick(signup.sourceVisits),{Google:[3,1,33.3],newsletter:[2,1,50]})
 assert.deepEqual([pick(signup.utmMediums),pick(signup.utmCampaigns)],[{email:[2,1,50]},{spring:[2,1,50]}])
 assert.deepEqual(pick(signup.entryPages),{'/':[3,1,33.3],'/pricing':[2,1,50]})
 assert.deepEqual(pick(signup.devices),{desktop:[4,2,50],mobile:[1,0,0]})
 const any=await summary();assert.deepEqual([pick(any.channels),pick(any.devices)],[{'Organic Search':[3,2,66.7],Email:[2,1,50]},{desktop:[4,2,50],mobile:[1,1,100]}])
 const html=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=2026-03-03&to=2026-03-04&goal=signup`,owner)).text())
 const row=label=>{const i=html.indexOf(`<th scope="row">${label}</th>`);return html.slice(i,html.indexOf('</tr>',i))}
 for(const [label,cells] of [['Email','<td class="vane-number">1</td><td class="vane-number">50.0%</td>'],['Organic Search','<td class="vane-number">1</td><td class="vane-number">33.3%</td>'],['mobile','<td class="vane-number">1</td><td class="vane-number">0</td><td class="vane-number">0.0%</td>']])assert.ok(row(label).includes(cells),label)
 assert.ok(html.includes('<th scope="col" class="vane-number">Conversions</th><th scope="col" class="vane-number">Conversion rate</th>'))
})
test('DASH-009 a member\'s note, an approved settings change, a deploy webhook, an Uptime incident and a signed GitHub release appear on the chart on their days and in the explanation, with owner-only secrets and author-or-owner note deletion',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},member=await a.invite('member@example.test','member'),admin=await a.invite('admin@example.test','admin'),id=await a.addSite()
 const today=new Date().toISOString().slice(0,10),earlier=new Date(Date.now()-2*86400000).toISOString().slice(0,10)
 // A member adds a note; markup and over-long notes are refused.
 assert.equal((await a.form({operation:'annotation.add',siteId:id,day:today,text:'Pricing page redesign shipped'},member)).status,303)
 for(const text of ['<b>bold</b>','x'.repeat(281)])assert.equal((await a.form({operation:'annotation.add',siteId:id,day:today,text},member)).status,400)
 // The owner approves a settings change that also makes a public stats page.
 const p=await (await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',publicReports:['totals']}},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)
 // Only the owner creates the webhook secret; it is shown once and kept only as its SHA-256.
 assert.equal((await a.form({operation:'annotation-hook.create',siteId:id},admin)).status,403)
 const created=await a.form({operation:'annotation-hook.create',siteId:id},a.owner);assert.equal(created.status,200);const secret=(await created.text()).match(/data-annotation-secret>(vane_ah_[0-9a-f]{64})</)[1]
 assert.ok(!(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes(secret),'shown once');assert.ok(!JSON.stringify(await a.dump()).includes(secret),'only the hash is kept')
 const hook=(body,token=secret)=>a.request('/api/vane/annotations',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({siteId:id,...body})})
 assert.equal((await hook({id:'deploy-42',kind:'deploy',at:earlier+'T12:00:00Z',title:'Deploy 42',url:'https://ci.example/runs/42?token=abc#log'})).status,201)
 assert.equal((await hook({id:'deploy-42',kind:'deploy',at:earlier+'T12:00:00Z',title:'Deploy 42'})).status,200,'a repeat is idempotent')
 assert.equal((await hook({id:'incident-7',kind:'incident',at:Date.now(),title:'Checkout down for 4 minutes'})).status,201)
 assert.equal((await hook({id:'x',kind:'deploy',at:Date.now(),title:'Forged'},'vane_ah_'+'0'.repeat(64))).status,401)
 assert.equal((await hook({id:'y',kind:'party',at:Date.now(),title:'Unknown kind'})).status,400)
 // A GitHub release, signed with the site's separate GitHub key (kept encrypted, never in plain text).
 assert.equal((await a.form({operation:'annotation-github.create',siteId:id},admin)).status,403)
 const ghKey=(await (await a.form({operation:'annotation-github.create',siteId:id},a.owner)).text()).match(/data-annotation-secret>(vane_gh_[0-9a-f]{64})</)[1];assert.ok(!JSON.stringify(await a.dump()).includes(ghKey))
 const {createHmac}=await import('node:crypto'),github=(event,payload,key=ghKey)=>{const body=JSON.stringify(payload);return a.request('/api/vane/annotations/github/'+id,{method:'POST',headers:{'content-type':'application/json','x-github-event':event,'x-github-delivery':crypto.randomUUID(),'x-hub-signature-256':'sha256='+createHmac('sha256',key).update(body).digest('hex')},body})}
 const release={action:'published',release:{id:901,tag_name:'v2.1.0',name:'v2.1.0',html_url:'https://git.example/fern/site/releases/tag/v2.1.0',published_at:earlier+'T15:00:00Z'}}
 assert.equal((await github('ping',{zen:'hi'})).status,200);assert.equal((await github('release',release)).status,201);assert.equal((await github('release',release)).status,200,'a redelivery is idempotent')
 assert.equal((await github('release',release,'vane_gh_'+'1'.repeat(64))).status,401);assert.equal((await github('push',{ref:'main'})).status,400)
 const html=await (await a.request(`/app/sites/${id}?section=report`,owner)).text()
 for(const [day,kind,text] of [[earlier,'release','Release v2.1.0'],[today,'note','Pricing page redesign shipped'],[today,'settings','Settings approved (version 1 to 2).'],[earlier,'deploy','Deploy 42'],[today,'incident','Checkout down for 4 minutes']])assert.ok(html.includes(`<li data-annotation-day="${day}" data-annotation-kind="${kind}"><time datetime="${day}">${new Date(day+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}</time> ${text}`),kind)
 assert.ok(html.includes(`data-annotation="${earlier}"`)&&html.includes(`data-annotation="${today}"`)&&html.includes('https://ci.example/runs/42</a>')&&!html.includes('token=abc'))
 const summary=await (await a.request(`/api/vane/summary?siteId=${id}`,owner)).json();assert.deepEqual(summary.explain.annotations.map(n=>n.kind).sort(),['deploy','incident','note','release','settings'])
 assert.match(await (await a.request('/app',owner)).text(),/annotated buckets">(<line class="vane-chart-annotation"[^>]*data-annotation-bucket="\d"\/>){2}<polyline/,'the overview sparkline marks both annotated days')
 assert.ok(!(await (await a.request('/stats/'+id)).text()).includes('Pricing page redesign'),'notes are never public')
 // At most 60 integration annotations an hour.
 for(let i=0;i<57;i++)assert.equal((await hook({id:'bulk-'+i,kind:'deploy',at:Date.now(),title:'Deploy '+i})).status,201)
 assert.equal((await hook({id:'bulk-57',kind:'deploy',at:Date.now(),title:'One too many'})).status,429)
 // Only the author or the owner deletes a note.
 const noteId=summary.annotations.find(n=>n.kind==='note').id
 assert.equal((await a.form({operation:'annotation.delete',siteId:id,id:noteId},admin)).status,403);assert.equal((await a.form({operation:'annotation.delete',siteId:id,id:noteId},member)).status,303)
 assert.equal((await a.form({operation:'annotation-hook.revoke',siteId:id},a.owner)).status,303);assert.equal((await hook({id:'after',kind:'deploy',at:Date.now(),title:'After revoke'})).status,401)
 const audit=JSON.stringify(await (await a.request('/api/vane/audit',owner)).json());for(const action of ['annotation.add','annotation.delete','annotation-hook.create','annotation-hook.revoke','annotation-github.create'])assert.ok(audit.includes(action),action)
})


test('HOST-001 real collection measures requests, D1 work and storage before projecting hosting cost',async t=>{
 const a=await installation({meter:true});t.after(()=>a.close())
 await a.clock(Date.parse('2026-10-23T12:00:00Z'))
 const id=await a.addSite({paths:[],goals:{},retention:'forever'}),count=process.env.VANE_HOST_COST_MEASURE==='1'?100000:100
 const before=Number((await a.inspectDb.prepare('SELECT 1').run()).meta.size_after)
 await a.request('/__test/hosting-usage',{method:'POST'})
 // Real distinct admissions through the native collection transport, not weighted records.
 for(let first=0;first<count;first+=1000){const events=Array.from({length:Math.min(1000,count-first)},(_,i)=>a.event(id,{path:`/synthetic-vane-${(first+i)%10}`}))
  const response=await a.post('/api/vane/collect-batch',{events},'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.10','user-agent':DESKTOP_CHROME})
  assert.equal(response.status,202);assert.equal((await response.json()).accepted,events.length)
 }
 const measured=await (await a.request('/__test/hosting-usage')).json(),after=Number((await a.inspectDb.prepare('SELECT 1').run()).meta.size_after)
 const report=await (await a.request(`/api/vane/summary?siteId=${id}&period=today`,{headers:{cookie:a.owner}})).json()
 assert.equal(report.pageviews,count);assert.ok(measured.rowsRead>0&&measured.rowsWritten>0&&after>before)
 t.diagnostic(JSON.stringify({pageviews:count,...measured,storeBeforeBytes:before,storeAfterBytes:after,storeGrowthBytes:after-before,scope:'local native batch collection only; elapsed time is not Worker CPU or provider billing'}))
})
