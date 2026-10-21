import test from 'node:test'
import { assert, readFile, createHash, createHmac, crc32, createRequire, installation, appsScript, fixture, unlinked, withApp, DESKTOP_CHROME, browse, movein } from './vane-helpers.mjs'

test('METRIC-001 unique visitors are distinct daily salted hashes summed over days, with no IP, user agent or stale salt kept',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({timeZone:'Pacific/Pago_Pago'}),other=await a.addSite({origin:'https://oak.example'})
 const people=[{ip:'203.0.113.7',ua:'Synthetic Browser 1'},{ip:'198.51.100.4',ua:'Synthetic Browser 2'}]
 const visit=async(site,origin,person,path='/')=>assert.equal((await a.post('/api/vane/collect',a.event(site,{path}),'',{origin,'cf-connecting-ip':person.ip,'user-agent':person.ua})).status,202)
 const localDay=timeZone=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now()),next=d=>new Date(Date.parse(d)+86400000).toISOString().slice(0,10)
 const first=localDay('Pacific/Pago_Pago'),second=localDay('Pacific/Kiritimati');assert.notEqual(first,second)
 await visit(id,'https://fern.example',people[0]);await visit(id,'https://fern.example',people[0],'/thanks');await visit(id,'https://fern.example',people[1])
 // The site's time zone moves from UTC-11 to UTC+14: its local date, and so its salt, rotates to the next day.
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',sampleRate:100,retentionDays:90,timeZone:'Pacific/Kiritimati'}
 const moved=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:moved.id},a.owner)).status,303)
 await visit(id,'https://fern.example',people[0]);await visit(id,'https://fern.example',people[1]);await visit(other,'https://oak.example',people[0])
 const summary=async query=>(await a.request(`/api/vane/summary?siteId=${id}${query}`,owner)).json()
 for(const day of [first,second])assert.equal((await summary(`&from=${day}&to=${next(day)}`)).visitors,2,day)
 const range=await summary('');assert.deepEqual([range.to,range.visitors,range.previousVisitors,range.pageviews],[next(second),4,0,5])
 const hashes=day=>new Set(rows.filter(r=>r.site_id===id&&r.day===day&&r.kind==='pageview').map(r=>r.visitor)),rows=(await a.archive()).payload.tables.vane_events
 assert.deepEqual([hashes(first).size,hashes(second).size,new Set([...hashes(first),...hashes(second)]).size],[2,2,4],'a visitor cannot be followed across days')
 const elsewhere=rows.find(r=>r.site_id===other).visitor;assert.ok(rows.filter(r=>r.site_id===id).every(r=>r.visitor!==elsewhere),'the same visitor hashes differently on another site')
 const archive=await a.archive();assert.equal(Object.hasOwn(archive.payload.tables,'vane_salts'),false)
 await a.scheduled();const database=await a.dump()
 for(const secret of [...people.map(p=>p.ip),'Synthetic Browser'])for(const [where,value] of [['database',database],['archive',archive]])assert.equal(JSON.stringify(value).includes(secret),false,`${where} holds ${secret}`)
 assert.deepEqual(database.vane_salts.filter(salt=>salt.site_id===id).map(salt=>salt.day),[second],'the previous day salt is gone');assert.ok(database.vane_salts.every(salt=>salt.created_at>Date.now()-86400000))
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['SHA-256(daily salt + site ID + IP address + user agent)','deleted after 24 hours','sum of daily uniques'])assert.ok(methodology.includes(phrase),phrase)
})
test('METRIC-002 one visitor\'s pageviews 10, 40 and 5 minutes apart make 2 visits of 4 pageviews, 2 pages per visit, and the daily salt ends a visit at midnight',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite(),person={origin:'https://fern.example','cf-connecting-ip':'203.0.113.9','user-agent':'Synthetic Browser 3'}
 assert.equal((await a.request('/__dev/clock',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({at:0})})).status,404,'the clock door needs the local dev key')
 const load=async at=>{await a.clock(at);assert.equal((await a.post('/api/vane/collect',a.event(id),'',person)).status,202)}
 const start=Date.parse('2026-03-02T09:00:00Z');for(const minutes of [0,10,50,55])await load(start+minutes*60000)
 const summary=async(from,to)=>(await a.request(`/api/vane/summary?siteId=${id}&from=${from}&to=${to}`,owner)).json()
 const day=await summary('2026-03-02','2026-03-03');assert.deepEqual([day.visits,day.pageviews,day.pagesPerVisit,day.visitors,day.viewsPerVisitor],[2,4,2,1,4])
 assert.match(day.explanation,/Visits: 2, previously 0, each a run of one visitor hash's page loads with no gap over 30 minutes/)
 const page=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-02&to=2026-03-03`,owner)).text()
 for(const tile of ['<h2>Visits</h2><p class="vane-metric">2</p>','<h2>Pageviews</h2><p class="vane-metric">4</p>','<h2>Pages per visit</h2><p class="vane-metric">2</p><p class="vane-help">Views per visitor: 4. <a href="/methodology#pages-per-visit"'])assert.ok(page.includes(tile),tile)
 // 23:50 is a new visit after a 13-hour gap; 00:05 is 15 minutes later but on the next day's salt, so it is another.
 await load(Date.parse('2026-03-02T23:50:00Z'));await load(Date.parse('2026-03-03T00:05:00Z'))
 const both=await summary('2026-03-02','2026-03-04');assert.deepEqual([both.visits,both.pageviews,both.pagesPerVisit,both.visitors,both.viewsPerVisitor],[4,6,1.5,2,3])
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['no gap over 30 minutes','a visit also ends at midnight in the site’s time zone','views per visitor'])assert.ok(methodology.includes(phrase),phrase)
})
test('METRIC-003 a quick bounce, a 45-second single-page visit and a three-page visit give the bounce rate, visit durations and time on page, and the script pings only after 10 visible seconds',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite(),start=Date.parse('2026-03-04T10:00:00Z')
 const person=n=>({origin:'https://fern.example','cf-connecting-ip':'198.51.100.'+n,'user-agent':'Synthetic Browser '+n})
 const load=async(n,seconds,path='/')=>{await a.clock(start+seconds*1000);const event=a.event(id,{path});assert.equal((await a.post('/api/vane/collect',event,'',person(n))).status,202);return event.id}
 const engage=async(pageLoad,seconds,status,body={siteId:id,id:pageLoad,scroll:pageLoad===last?80:40})=>{await a.clock(start+seconds*1000);const r=await a.post('/api/vane/engage',body,'',{origin:'https://fern.example'});assert.equal(r.status,status,await r.text())}
 let last
 await load(1,0)
 const single=await load(2,0);await engage(single,5,409);await engage(single,11,202);await engage(single,45,202)
 await load(3,0);await load(3,20,'/thanks');last=await load(3,80);await engage(last,120,202)
 await engage(single,50,400,{siteId:id,id:single,seconds:50});await engage(crypto.randomUUID(),50,404);await engage(single,1900,409)
 const r=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-04&to=2026-03-05`,owner)).json()
 assert.deepEqual([r.visits,r.pageviews,r.bounces,r.bounceRate,r.medianDuration,r.averageDuration],[3,5,1,33.3,45,55])
 assert.deepEqual(r.topPages,[{path:'/',visitors:3,pageviews:4,visits:3,bounceRate:33.3,conversions:1,conversionRate:33.3,medianDuration:45,averageDuration:55,medianTimeOnPage:30,averageTimeOnPage:26,averageScrollDepth:60,reached75Share:50,previous:0,revenue:0,currency:'USD',revenuePerVisitor:0},{path:'/thanks',visitors:1,pageviews:1,visits:1,bounceRate:0,conversions:1,conversionRate:100,medianDuration:120,averageDuration:120,medianTimeOnPage:60,averageTimeOnPage:60,averageScrollDepth:null,reached75Share:null,previous:0,revenue:0,currency:'USD',revenuePerVisitor:0}])
 const page=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=2026-03-04&to=2026-03-05`,owner)).text())
 for(const html of ['<h2>Bounce rate</h2><p class="vane-metric">33.3%</p>','<h2>Visit duration</h2><p class="vane-metric">0m 45s</p><p class="vane-help">Median; average 0m 55s.','<th scope="row">/</th><td class="vane-number">3</td><td class="vane-number">4</td><td class="vane-number">3</td><td class="vane-number">33.3%</td><td class="vane-number">0m 45s / 0m 55s</td><td class="vane-number">0m 30s / 0m 26s</td>'])assert.ok(page.includes(html),html)
 // In a browser: a page hidden after 3 seconds sends nothing (a bounce); the next visit pings at 10 visible seconds and again when hidden.
 const oak=await a.addSite({origin:'https://oak.example'}),html=`<!doctype html><title>Oak</title><script src="${a.origin}/vane.js" data-site="${oak}"></script>`
 const {context}=await browse(t,a,{'https://oak.example/':html}),tab=await context.newPage(),pings=[]
 tab.on('request',request=>{if(new URL(request.url()).pathname==='/api/vane/engage'&&request.method()==='POST')pings.push(JSON.parse(request.postData()))})
 const answered=path=>tab.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='POST')
 const hide=()=>tab.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'))})
 const morning=Date.parse('2026-03-05T10:00:00Z'),later=morning+7200000
 await tab.clock.install({time:morning});await a.clock(morning)
 let sent=answered('/api/vane/collect');await tab.goto('https://oak.example/');assert.equal((await sent).status(),202)
 await tab.clock.fastForward(3000);await hide();await tab.waitForTimeout(1000);assert.equal(pings.length,0,'hidden within 10 seconds: no ping')
 await a.clock(later);await tab.clock.setSystemTime(later)
 sent=answered('/api/vane/collect');await tab.goto('https://oak.example/');assert.equal((await sent).status(),202)
 await a.clock(later+11000);sent=answered('/api/vane/engage');await tab.clock.fastForward(10000);assert.equal((await sent).status(),202)
 await a.clock(later+30000);sent=answered('/api/vane/engage');await tab.clock.fastForward(19000);await hide();assert.equal((await sent).status(),202)
 assert.deepEqual(pings.map(p=>Object.keys(p).sort()),[['id','scroll','siteId'],['id','scroll','siteId']],'pings carry only the site and page-load IDs and the scroll depth')
 const o=await (await a.request(`/api/vane/summary?siteId=${oak}&from=2026-03-05&to=2026-03-06`,owner)).json()
 assert.deepEqual([o.visits,o.bounces,o.bounceRate,o.medianDuration,o.averageDuration],[2,1,50,15,15])
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['A bounce is a visit with one page load and no engagement ping','visible for 10 seconds or more','median and average time on each page'])assert.ok(methodology.includes(phrase),phrase)
 await context.close()
})
test('METRIC-006 in a browser, visits scrolling a long page to 50% and to 100% give a 75% average depth and a 50% share reaching 75%, and a 75% scroll goal converts once',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({scrollGoals:{'deep-read':{path:'/',depth:75}}})
 const html=`<!doctype html><title>Fern Studio</title><div style="height:4000px">A long page</div><script src="${a.origin}/vane.js" data-site="${id}"></script>`
 const {context}=await browse(t,a,{'https://fern.example/':html}),tab=await context.newPage(),loads=[]
 const answered=path=>tab.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='POST')
 const morning=Date.parse('2026-03-06T10:00:00Z');await tab.clock.install({time:morning})
 for(const [visit,share] of [0.5,1].entries()) {
  const time=morning+visit*7200000;await a.clock(time);await tab.clock.setSystemTime(time)
  let sent=answered('/api/vane/collect');await tab.goto('https://fern.example/');assert.equal((await sent).status(),202)
  await tab.evaluate(share=>scrollTo(0,document.documentElement.scrollHeight*share-innerHeight),share)
  await a.clock(time+11000);sent=answered('/api/vane/engage');await tab.clock.fastForward(10000)
  const ping=await sent;assert.equal(ping.status(),202);const body=JSON.parse(ping.request().postData());assert.equal(body.scroll,share*100);loads.push(body.id)
 }
 for(const scroll of [101,-1,50.5,undefined])assert.equal((await a.post('/api/vane/engage',{siteId:id,id:loads[0],scroll},'',{origin:'https://fern.example'})).status,400,String(scroll))
 const r=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-06&to=2026-03-07`,owner)).json()
 assert.deepEqual([r.topPages[0].path,r.topPages[0].averageScrollDepth,r.topPages[0].reached75Share],['/',75,50])
 assert.deepEqual([r.goals,r.goalBreakdown.map(g=>[g.label,g.count])],[1,[['deep-read',1]]],'only the visit that reached 75% converts, once')
 const page=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-06&to=2026-03-07`,owner)).text();assert.ok(page.includes('<td class="vane-number">75.0%</td><td class="vane-number">50.0%</td>'))
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes('deep-read=/@75'))
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['as a whole percentage from 0 to 100','the share of page loads reaching 75%','converts once per page load'])assert.ok(methodology.includes(phrase),phrase)
 await context.close()
})
