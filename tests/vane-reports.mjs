import test from 'node:test'
import { assert, readFile, createHash, createHmac, crc32, createRequire, installation, appsScript, fixture, unlinked, withApp, DESKTOP_CHROME, browse, movein } from './vane-helpers.mjs'

test('DASH-003 seeded visits give top, entry and exit pages with visitors, pageviews, bounce rate, time on page and conversion rate, and grouping by /blog/* sums the posts',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:['/','/pricing','/blog/a','/blog/b','/thanks']}),start=Date.parse('2026-03-09T10:00:00Z')
 const visit=async(n,paths)=>{for(const [i,path] of paths.entries()){await a.clock(start+n*3600000+i*20000);assert.equal((await a.post('/api/vane/collect',a.event(id,{path}),'',{origin:'https://fern.example','cf-connecting-ip':'192.0.2.'+n,'user-agent':'Synthetic Browser '+n})).status,202)}}
 await visit(1,['/','/blog/a','/thanks']);await visit(2,['/blog/a','/blog/b']);await visit(3,['/blog/b']);await visit(4,['/pricing','/'])
 const summary=async(group='')=>(await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-09&to=2026-03-10${group&&'&group='+encodeURIComponent(group)}`,owner)).json()
 const pick=rows=>rows.map(r=>[r.path,r.visitors,r.pageviews,r.visits,r.bounceRate,r.conversionRate])
 const r=await summary()
 assert.deepEqual(pick(r.topPages),[['/',2,2,2,0,50],['/blog/a',2,2,2,0,50],['/blog/b',2,2,2,50,0],['/pricing',1,1,1,0,0],['/thanks',1,1,1,0,100]])
 assert.deepEqual(pick(r.entryPages),[['/',1,1,1,0,100],['/blog/a',1,1,1,0,0],['/blog/b',1,1,1,100,0],['/pricing',1,1,1,0,0]])
 assert.deepEqual(pick(r.exitPages),[['/blog/b',2,2,2,50,0],['/',1,1,1,0,0],['/thanks',1,1,1,0,100]])
 assert.deepEqual([r.topPages[0].medianTimeOnPage,r.topPages[0].averageTimeOnPage,r.entryPages[0].medianDuration],[10,10,40],'time on / is 20 s then 0 s; the visit entering / lasts 40 s')
 const g=await summary('/blog/*')
 assert.deepEqual(pick(g.topPages),[['/blog/*',3,4,3,33.3,33.3],['/',2,2,2,0,50],['/pricing',1,1,1,0,0],['/thanks',1,1,1,0,100]])
 assert.deepEqual(pick(g.entryPages)[0],['/blog/*',2,2,2,50,0]);assert.deepEqual(pick(g.exitPages)[0],['/blog/*',2,2,2,50,0])
 assert.deepEqual(pick((await summary('/blog/*=/articles')).topPages)[0],['/articles',3,4,3,33.3,33.3],'a rewrite rule renames the group')
 assert.equal((await a.request(`/api/vane/summary?siteId=${id}&group=blog`,owner)).status,400)
 const page=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-09&to=2026-03-10&group=%2Fblog%2F*`,owner)).text()
 for(const html of ['<h2>Top pages</h2>','<h2>Entry pages</h2>','<h2>Exit pages</h2>','<th scope="row">/blog/*</th><td class="vane-number">3</td><td class="vane-number">4</td><td class="vane-number">3</td><td class="vane-number">33.3%</td>','name="group" value="/blog/*"'])assert.ok(page.includes(html),html)
})
test('CONV-001 /thanks/* converts on /thanks/pro only and /thanks** on every page below, a 75% scroll goal on /blog/** converts at 80% and not at 50%, with unique converters and the conversion rate against visitors',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},paths=['/','/thanks','/thanks/pro','/thanks/pro/annual','/blog/post','/blog/2026/notes'],start=Date.parse('2026-03-10T10:00:00Z')
 const refused=await a.post('/api/vane/commands',{command:'site.create',input:{name:'Fern Studio',origin:'https://fern.example',paths,goals:{signup:'/checkout*'},consent:'not-required'}},a.owner);assert.equal(refused.status,400,'a goal pattern must match an allowed path')
 const id=await a.addSite({paths,goals:{signup:'/thanks**',pro:'/thanks/*'},scrollGoals:{'deep-read':{path:'/blog/**',depth:75}}})
 const load=async(n,path,seconds=0)=>{await a.clock(start+n*3600000+seconds*1000);const event=a.event(id,{path});assert.equal((await a.post('/api/vane/collect',event,'',{origin:'https://fern.example','cf-connecting-ip':'192.0.2.'+n,'user-agent':'Synthetic Browser '+n})).status,202);return event.id}
 const read=async(n,path,scroll)=>{const pageLoad=await load(n,path);await a.clock(start+n*3600000+11000);assert.equal((await a.post('/api/vane/engage',{siteId:id,id:pageLoad,scroll},'',{origin:'https://fern.example'})).status,202)}
 await load(1,'/thanks');await load(1,'/thanks',30);await load(2,'/thanks/pro');await load(6,'/thanks/pro/annual');await load(3,'/');await read(4,'/blog/2026/notes',80);await read(5,'/blog/post',50)
 const r=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-10&to=2026-03-11`,owner)).json()
 assert.deepEqual([r.visitors,r.goals,r.converters,r.conversionRate],[6,6,4,66.7])
 assert.deepEqual(r.goalBreakdown.map(g=>[g.label,g.count,g.converters,g.conversionRate]),[['signup',4,3,50],['deep-read',1,1,16.7],['pro',1,1,16.7]],'/thanks/* stays within one segment; /thanks** reaches /thanks and /thanks/pro/annual')
 const page=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=2026-03-10&to=2026-03-11`,owner)).text())
 for(const html of ['<th scope="row">signup</th><td class="vane-number">4</td><td class="vane-number">3</td><td class="vane-number">50.0%</td>','Converting visitors: 4 (66.7% of unique visitors).'])assert.ok(page.includes(html),html)
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes('signup=/thanks**\npro=/thanks/*\ndeep-read=/blog/**@75'))
 assert.ok((await (await a.request('/methodology')).text()).includes('so /thanks/* covers /thanks/pro'))
})
test('DASH-006 iPhone Safari, Android Chrome, Windows Edge and an iPad fill the device, browser, OS and screen tables, and no raw user agent is stored',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite()
 const agents=[['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',390],['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',412],['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',1536],['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',820]]
 for(const [ua,width] of agents)assert.equal((await a.post('/api/vane/collect',a.event(id,{width}),'',{origin:'https://fern.example','user-agent':ua})).status,202)
 for(const width of [-1,'wide',1.5])assert.equal((await a.collect(a.event(id,{width}))).status,400,String(width))
 const r=await (await a.request('/api/vane/summary?siteId='+id,owner)).json(),pick=rows=>rows.map(row=>[row.label,row.visitors,row.pageviews])
 assert.deepEqual(pick(r.devices),[['mobile',2,2],['desktop',1,1],['tablet',1,1]])
 assert.deepEqual(pick(r.browsers),[['Safari',2,2],['Chrome',1,1],['Edge',1,1]]);assert.deepEqual(pick(r.browserVersions),[['Safari 17',2,2],['Chrome 126',1,1],['Edge 126',1,1]])
 assert.deepEqual(pick(r.systems),[['Android',1,1],['Windows',1,1],['iOS',1,1],['iPadOS',1,1]]);assert.deepEqual(pick(r.systemVersions),[['Android 14',1,1],['Windows 10/11',1,1],['iOS 17.4',1,1],['iPadOS 17.0',1,1]])
 assert.deepEqual(pick(r.screens),[['Mobile (under 576 px)',2,2],['Desktop (1440 px and wider)',1,1],['Tablet (576–991 px)',1,1]])
 const page=unlinked(await (await a.request(`/app/sites/${id}?section=report`,owner)).text());for(const html of ['<h2>Devices</h2>','<th scope="row">iPadOS 17.0</th><td class="vane-number">1</td>','<h2>Screen sizes</h2>'])assert.ok(page.includes(html),html)
 // In a browser at phone width, the script sends its viewport width and the page load lands in the phone class.
 const other=await a.addSite({origin:'https://oak.example'}),{context}=await browse(t,a,{'https://oak.example/':`<!doctype html><title>Oak</title><script src="${a.origin}/vane.js" data-site="${other}"></script>`},{viewport:{width:390,height:844}}),tab=await context.newPage()
 const sent=tab.waitForResponse(response=>new URL(response.url()).pathname==='/api/vane/collect'&&response.request().method()==='POST');await tab.goto('https://oak.example/');const response=await sent
 assert.equal(response.status(),202);assert.equal(JSON.parse(response.request().postData()).width,390)
 assert.deepEqual(pick((await (await a.request('/api/vane/summary?siteId='+other,owner)).json()).screens),[['Mobile (under 576 px)',1,1]])
 const dump=await a.dump(),stored=JSON.stringify([dump,await a.archive()]);for(const fragment of ['Mozilla/5.0','Pixel 8','AppleWebKit','HeadlessChrome'])assert.equal(stored.includes(fragment),false,fragment)
 for(const row of dump.vane_events)assert.ok(!Object.values(row).some(value=>[390,412,1536,820,'390','412','1536','820'].includes(value)),'only the screen class is stored, never the width')
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['never the user agent or the width in pixels','Windows 10/11','counts as a macOS desktop'])assert.ok(methodology.includes(phrase),phrase)
 await context.close()
})
test('DASH-005 Cloudflare geo for Texas, Ontario and London fills the country, region and city tables with the selected goal\'s conversions, filters by country, folds small cities on a shared link, joins the live locations and the explanation\'s movers, and no IP address is stored',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite()
 const austin={country:'US',region:'Texas',regionCode:'TX',city:'Austin',metroCode:'635'},marfa={country:'US',region:'Texas',regionCode:'TX',city:'Marfa',metroCode:'633'},toronto={country:'CA',region:'Ontario',regionCode:'ON',city:'Toronto'},london={country:'GB',region:'England',regionCode:'ENG',city:'London'}
 // cf carries Cloudflare's request geolocation at the Worker's fetch door; each visitor has its own address.
 let n=0;const visit=async(cf,at,paths=['/'])=>{n++;for(const [i,path] of paths.entries()){await a.clock(at+i*20000);const r=await a.request('/api/vane/collect',{method:'POST',headers:{origin:'https://fern.example','content-type':'application/json','user-agent':'Synthetic Browser','cf-connecting-ip':'198.51.100.'+n},body:JSON.stringify(a.event(id,{path})),cf});assert.equal(r.status,202,await r.clone().text())}}
 const before=Date.parse('2026-03-03T15:00:00Z'),week=Date.parse('2026-03-10T15:00:00Z')
 for(let i=0;i<30;i++)await visit(austin,before+i*60000)
 for(let i=0;i<12;i++)await visit(austin,week+i*60000,i<3?['/','/thanks']:['/'])
 for(let i=0;i<3;i++)await visit(marfa,week+(20+i)*60000)
 await visit(toronto,week+30*60000,['/','/thanks']);await visit(london,week+31*60000)
 const range='&from=2026-03-09&to=2026-03-16',summary=async(extra='')=>(await a.request(`/api/vane/summary?siteId=${id}${range}${extra}`,owner)).json(),r=await summary('&goal=signup')
 const pick=(rows,...keys)=>rows.map(row=>keys.map(k=>row[k]))
 assert.deepEqual(pick(r.countries,'label','visitors','visits','conversions','conversionRate','previous'),[['United States',15,15,3,20,30],['Canada',1,1,1,100,0],['United Kingdom',1,1,0,0,0]])
 assert.deepEqual(pick(r.regions,'label','country','visitors','previous'),[['Texas','United States',15,30],['Ontario','Canada',1,0],['England','United Kingdom',1,0]])
 assert.deepEqual(pick(r.cities,'label','region','country','visitors','conversions'),[['Austin','Texas','United States',12,3],['Marfa','Texas','United States',3,0],['Toronto','Ontario','Canada',1,1],['London','England','United Kingdom',1,0]])
 // Texas fell from 30 to 15 unique visitors: the explanation names it among the movers with its totals.
 assert.deepEqual(r.explain.movers.filter(m=>m.dimension==='Region').map(m=>[m.label,m.then,m.now,m.totalThen,m.totalNow]),[['Texas, United States',30,15,30,17],['England, United Kingdom',0,1,30,17]])
 const page=unlinked(await (await a.request(`/app/sites/${id}?section=report${range}&goal=signup`,owner)).text())
 for(const html of ['<h2>Countries</h2>','<th scope="row">United States</th><td class="vane-number">15</td><td class="vane-number">15</td>','<th scope="row">Marfa</th><td>Texas, United States</td><td class="vane-number">3</td>','Region Texas, United States: 30 → 15 unique visitors'])assert.ok(page.includes(html),html)
 // Filtering by country is United States keeps only those visits.
 const us=await summary('&filter='+encodeURIComponent('country:is:United States'))
 assert.deepEqual([us.visitors,pick(us.countries,'label'),pick(us.cities,'label')],[15,[['United States']],[['Austin'],['Marfa']]])
 // A shared link folds Marfa's 3 visitors into Texas's "Other cities"; the signed-in report lists both cities.
 const shared=await a.form({operation:'share.create',siteId:id,label:'Partners',share_locations:'on'},a.owner);assert.equal(shared.status,200)
 const link=(await shared.text()).match(/data-share-url>[^<]*(\/share\/vane_s_[0-9a-f]{64})</)[1],open=unlinked(await (await a.request(link+'?from=2026-03-09&to=2026-03-16')).text())
 for(const html of ['<th scope="row">Austin</th><td>Texas, United States</td><td class="vane-number">12</td>','<th scope="row">Other cities</th><td>Texas, United States</td><td class="vane-number">3</td>','<th scope="row">Other cities</th><td>Ontario, Canada</td><td class="vane-number">1</td>'])assert.ok(open.includes(html),html)
 assert.equal(open.includes('Marfa'),false,'a city under 5 visitors is not named on a shared link')
 const filtered=await summary('&filter=metro:is:635');assert.equal(filtered.visitors,12)
 // The real-time view lists a current visitor from Texas, and drops them after 5 minutes idle.
 const now=Date.parse('2026-03-10T18:00:00Z');await visit(austin,now)
 const live=await (await a.request('/api/vane/realtime?siteId='+id,owner)).json();assert.deepEqual(live.locations,[{label:'Austin, Texas, United States',visitors:1,previous:0}])
 assert.ok((await (await a.request(`/app/sites/${id}?section=realtime`,owner)).text()).includes('<table data-live="Live locations">'))
 await a.clock(now+5*60000+1000);assert.deepEqual((await (await a.request('/api/vane/realtime?siteId='+id,owner)).json()).locations,[])
 // Names are stored, with the US metro-area code; no IP address appears anywhere in storage or the archive.
 const dump=await a.dump();assert.deepEqual([...new Set(dump.vane_events.map(e=>[e.country,e.region,e.city,e.metro_code].join('|')))].sort(),['Canada|Ontario|Toronto|','United Kingdom|England|London|','United States|Texas|Austin|635','United States|Texas|Marfa|633'])
 assert.equal(JSON.stringify([dump,await a.archive()]).includes('198.51.100.'),false)
 assert.ok(dump.vane_events.every(e=>!Object.hasOwn(e,'metro_name')),'events keep the metro code only')
 assert.deepEqual(pick(r.metros,'metro_code','metro_name','visitors','conversions','conversionRate','previous'),[['635',null,12,3,25,30],['633',null,3,0,0,0]])
 assert.ok(open.includes('Other metro areas'));assert.equal(open.includes('Metro 633'),false)
 assert.ok(r.explain.movers.some(m=>m.dimension==='US metro area'&&m.label.includes('635')&&m.then===30&&m.now===12))
 assert.deepEqual(live.metros.map(m=>[m.metro_code,m.metro_name,m.visitors,m.previous]),[['635',null,1,0]])
 const inventory=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text();assert.ok(inventory.includes('country, region and city'),'the data inventory names location')
})
test('DASH-012 with a named search parameter, a term two visitors searched is reported with searches per visit, start pages and exits, and an email-like term never appears',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:['/','/search'],goals:{},searchParam:'q'}),plain=await a.addSite({origin:'https://oak.example'}),start=Date.parse('2026-03-11T10:00:00Z')
 const visit=async(n,steps)=>{for(const [i,[path,search]] of steps.entries()){await a.clock(start+n*3600000+i*20000);assert.equal((await a.post('/api/vane/collect',a.event(id,{path,...(search?{search}:{})}),'',{origin:'https://fern.example','cf-connecting-ip':'192.0.2.'+n,'user-agent':'Synthetic Browser '+n})).status,202)}}
 await visit(1,[['/'],['/search','returns'],['/search','shipping'],['/']]);await visit(2,[['/search','returns']]);await visit(3,[['/'],['/search','alice@example.com']])
 assert.equal((await a.collect(a.event(plain,{search:'returns'}),'https://oak.example')).status,400,'no search term without a named parameter')
 assert.equal((await a.collect(a.event(id,{path:'/search',search:'x'.repeat(101)}))).status,400)
 const r=(await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-11&to=2026-03-12`,owner)).json()).siteSearch
 assert.deepEqual([r.searches,r.searchVisits,r.searchesPerVisit,r.exitAfterSearch],[4,3,1.33,66.7])
 assert.deepEqual(r.terms,[{term:'returns',searches:2,visitors:2,previous:0}],'shipping (one visitor) and the email-like term stay hidden')
 assert.deepEqual(r.startPages.map(p=>[p.path,p.searches]),[['/',2],['(entry)',1],['/search',1]])
 const page=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=2026-03-11&to=2026-03-12`,owner)).text())
 for(const html of ['<h2>Site search</h2>','<th scope="row">returns</th><td class="vane-number">2</td><td class="vane-number">2</td>','<dt>Visits that exit after searching</dt><dd>66.7%</dd>'])assert.ok(page.includes(html),html)
 assert.equal(page.includes('shipping'),false)
 // In a browser the script sends the named parameter's term, lowercased.
 const {context}=await browse(t,a,{'https://fern.example/search?q=Returns':`<!doctype html><title>Search</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`}),tab=await context.newPage()
 const sent=tab.waitForResponse(response=>new URL(response.url()).pathname==='/api/vane/collect'&&response.request().method()==='POST');await tab.goto('https://fern.example/search?q=Returns');const response=await sent
 assert.equal(response.status(),202);assert.equal(JSON.parse(response.request().postData()).search,'returns')
 const stored=JSON.stringify([await a.dump(),await a.archive()]);assert.equal(stored.includes('alice'),false,'the email-like term is never stored')
 assert.ok((await (await a.request('/methodology')).text()).includes('two different visitor hashes searched it on the same day'))
 await context.close()
})
test('SHARE-002 a site made public with two reports shows only those to a signed-out reader at its stable URL, honours the indexing choice, and turning it off returns 404',async t=>{
 const a=await withApp(t),id=await a.addSite()
 for(const path of ['/','/thanks'])assert.equal((await a.collect(a.event(id,{path}))).status,202)
 const configure=async extra=>{const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',sampleRate:100,retentionDays:90,...extra};const p=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)}
 const stats=()=>a.request('/stats/'+id)
 assert.equal((await stats()).status,404,'not public until the owner approves it')
 await configure({publicReports:['totals','pages']})
 let page=await stats(),html=await page.text();assert.equal(page.status,200)
 for(const part of ['<h2>Unique visitors</h2>','<h2>Pageviews</h2><p class="vane-metric">2</p>','<h2>Top pages</h2>','<h2>Exit pages</h2>','<meta name="robots" content="noindex, nofollow">'])assert.ok(html.includes(part),part)
 for(const part of ['<h2>Sources</h2>','<h2>Goals</h2>','Campaigns','Devices','Site search','search.example'])assert.equal(html.includes(part),false,part)
 assert.equal(page.headers.get('x-robots-tag'),'noindex, nofollow');assert.equal(page.headers.getSetCookie().length,0)
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,{headers:{cookie:a.owner}})).text()).includes(`/stats/${id}`))
 await configure({publicReports:['totals','pages'],publicIndexing:true})
 page=await stats();assert.equal(page.headers.get('x-robots-tag'),'index, follow');assert.ok((await page.text()).includes('<meta name="robots" content="index, follow">'))
 await configure({publicReports:[]})
 assert.equal((await stats()).status,404,'turning it off returns 404');assert.equal((await a.request('/stats/no-such-site')).status,404)
 assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/'],goals:{},consent:'not-required',publicReports:['search-terms']}},a.owner)).status,400,'only listed reports can be public')
})
test('SHARE-001 a password-protected link that hides revenue and a dark segment link open signed out with the dashboard figures, embed only on allowed origins, refuse wrong passwords, expire, and answer 404 once revoked',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},start=Date.parse('2026-03-10T12:00:00Z'),id=await a.addSite({paths:[]});await a.addSite({name:'Oak Books',origin:'https://oak.example',paths:[]})
 await a.clock(start)
 const load=async(n,path)=>{const event=a.event(id,{path});assert.equal((await a.post('/api/vane/collect',event,'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n})).status,202);return event.id}
 await load(1,'/');await load(2,'/');const thanks=await load(3,'/thanks')
 assert.equal((await a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId:id,page:thanks,name:'Purchase',revenue:{amount:40,currency:'USD'},consent:'not-required'},'',{origin:'https://fern.example'})).status,202)
 const summary=await (await a.request('/api/vane/summary?siteId='+id,owner)).json();assert.equal(summary.revenue.total,40)
 const create=async(body,cookie=a.owner)=>{const r=await a.form({operation:'share.create',siteId:id,...body},cookie);if(r.status!==200)return r.status;return (await r.text()).match(/data-share-url>[^<]*(\/share\/vane_s_[0-9a-f]{64})</)[1]}
 // A password-protected link with totals and pages chosen and revenue left out.
 const locked=await create({label:'Investors',share_totals:'on',share_pages:'on',password:'correct horse',embedOrigins:'https://blog.example'})
 let page=await a.request(locked);assert.equal(page.status,401);assert.ok((await page.text()).includes('name="password"'))
 const unlock=password=>a.request(locked,{method:'POST',headers:{origin:a.origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password}).toString()})
 assert.equal((await unlock('wrong horse')).status,401,'the wrong password is refused');assert.equal((await a.request(locked,{headers:{cookie:'vane_share=99999999999999.forged'}})).status,401,'a forged cookie is refused')
 const opened=await unlock('correct horse');assert.equal(opened.status,303);const cookie=a.cookieOf(opened)
 page=await a.request(locked,{headers:{cookie}});const html=await page.text();assert.equal(page.status,200)
 for(const part of [`<h2>Pageviews</h2><p class="vane-metric">${summary.pageviews}</p>`,`<h2>Unique visitors</h2><p class="vane-metric">${summary.visitors}</p>`,'<h2>Top pages</h2>'])assert.ok(html.includes(part),part)
 for(const part of ['Revenue','$40.00','Oak Books','/app','Settings','<h2>Sources</h2>'])assert.equal(html.includes(part),false,part)
 assert.equal(page.headers.get('x-robots-tag'),'noindex, nofollow');assert.match(page.headers.get('content-security-policy'),/frame-ancestors https:\/\/fern\.example https:\/\/blog\.example$/)
 assert.equal((await a.request('/api/vane/summary?siteId='+id,{headers:{cookie}})).status,401,'the link cookie opens no private route');assert.equal((await a.request('/app',{headers:{cookie}})).status,303)
 // Ten wrong passwords in 15 minutes lock the link until the window ends.
 for(let i=0;i<9;i++)assert.equal((await unlock('wrong horse')).status,401)
 assert.equal((await unlock('correct horse')).status,429);await a.clock(start+16*60000);assert.equal((await unlock('correct horse')).status,303)
 // A saved segment's link with no password, embedded dark on the site's own origin and refused on an unlisted one.
 const saved=await a.form({operation:'segment.save',siteId:id,name:'Thanks',filters:'page:is:/thanks'},a.owner),segment=new URL(saved.headers.get('location'),a.origin).searchParams.get('segment')
 const kept=await (await a.request(`/api/vane/summary?siteId=${id}&segment=${segment}`,owner)).json();assert.equal(kept.pageviews,1)
 const open=await create({label:'Blog',segment,share_totals:'on',share_revenue:'on',expiresDays:'30'})
 const {context}=await browse(t,a,{'https://fern.example/':`<!doctype html><title>Fern</title><iframe src="${a.origin}${open}?theme=dark"></iframe>`,'https://oak.example/':`<!doctype html><title>Oak</title><iframe src="${a.origin}${open}"></iframe>`}),tab=await context.newPage()
 await tab.goto('https://fern.example/');const frame=tab.frames().find(f=>f.url().includes('/share/'))
 assert.ok((await frame.content()).includes(`<h2>Pageviews</h2><p class="vane-metric">${kept.pageviews}</p>`),'the embed shows the segment figures');assert.ok((await frame.content()).includes('data-revenue="">$40.00'),'revenue shows when its report is chosen')
 assert.equal(await frame.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(15, 19, 28)','the dark theme')
 await tab.goto('https://oak.example/');assert.equal((await tab.frames().find(f=>f!==tab.mainFrame()).content()).includes('Pageviews'),false,'an unlisted origin cannot embed it')
 // Only the owner and administrators create links; revoking answers 404 at once, and a link expires after its days.
 assert.equal(await create({share_totals:'on'},await a.invite('member@example.test','member')),403)
 const listed=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text();assert.ok(listed.includes('Investors')&&listed.includes('password-protected')&&!listed.includes(locked),'listed without the token')
 const linkId=(await a.dump()).vane_share_links.find(l=>l.label==='Investors').id;assert.equal((await a.form({operation:'share.revoke',id:linkId},a.owner)).status,303)
 assert.equal((await a.request(locked,{headers:{cookie}})).status,404,'a revoked link returns 404');assert.equal((await a.request(open)).status,200)
 await a.clock(start+31*86400000);assert.equal((await a.request(open)).status,404,'an expired link returns 404')
 assert.deepEqual((await (await a.request('/api/vane/audit',owner)).json()).filter(e=>e.action.startsWith('share.')).map(e=>e.action).sort(),['share.create','share.create','share.revoke'])
})
test('CONV-003 in a browser an outbound link, a PDF link, a marked 404 page and a form submission send four automatic events with the right details and no form contents',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({autoEvents:['outbound','download','404','form']}),quiet=await a.addSite({origin:'https://oak.example'})
 const home=`<!doctype html><title>Fern</title><a id="out" href="https://elsewhere.example/guide?ref=fern#top">Guide</a> <a id="pdf" href="/files/menu.pdf?v=2">Menu</a><form id="signup" action="/thanks" method="post"><input name="email" value="secret@example.com"><button>Join</button></form><script src="${a.origin}/vane.js" data-site="${id}"></script>`
 const missing=`<!doctype html><title>Not found</title><meta name="vane-404"><script src="${a.origin}/vane.js" data-site="${id}"></script>`
 const {context}=await browse(t,a,{'https://fern.example/':home,'https://fern.example/missing-page':missing}),tab=await context.newPage()
 // Keepalive events outlive their page's navigation and are not page responses, so the installation's own report is watched.
 const recorded=async n=>{for(let i=0;i<100;i++){const r=await (await a.request('/api/vane/summary?siteId='+id,owner)).json();if(r.automaticEvents.length>=n)return r;await new Promise(done=>setTimeout(done,100))}assert.fail(`event ${n} did not arrive`)}
 const open=async()=>{const loaded=tab.waitForResponse(response=>new URL(response.url()).pathname==='/api/vane/collect');await tab.goto('https://fern.example/');await loaded}
 for(const [n,act] of [()=>tab.click('#out',{noWaitAfter:true}),()=>tab.click('#pdf',{noWaitAfter:true}),()=>tab.click('button',{noWaitAfter:true})].entries()){await open();await act();await recorded(n+1)}
 await tab.goto('https://fern.example/missing-page');const r=await recorded(4)
 assert.deepEqual(r.automaticEvents.map(e=>[e.kind,e.label,e.count]),[['404','/missing-page',1],['download','https://fern.example/files/menu.pdf',1],['form','signup',1],['outbound','https://elsewhere.example/guide',1]])
 assert.ok((await (await a.request(`/app/sites/${id}?section=report`,owner)).text()).includes('<th scope="row">Form submission</th><td>signup</td>'))
 const post=(siteId,body,origin='https://fern.example')=>a.post('/api/vane/event',{id:crypto.randomUUID(),siteId,consent:'not-required',...body},'',{origin})
 assert.equal((await post(quiet,{kind:'outbound',prop:'https://elsewhere.example/'},'https://oak.example')).status,403,'only turned-on events are accepted')
 assert.equal((await post(id,{kind:'outbound',prop:'https://elsewhere.example/?q=1'})).status,400,'no query is stored')
 assert.equal((await post(id,{kind:'form',prop:'/signup',email:'x@example.com'})).status,400,'no field values')
 assert.equal((await post(id,{kind:'404',prop:'/users/alice@example.com'})).status,202)
 const stored=JSON.stringify([await a.dump(),await a.archive()]);for(const secret of ['secret@example.com','ref=fern','v=2','alice@example.com'])assert.equal(stored.includes(secret),false,secret)
 assert.ok(stored.includes('(redacted)'))
 await context.close()
})
test('SITE-001 a site with apex and www origins counts both, changes time zone and currency through approval, transfers by site archive, and deletion leaves no history',async t=>{
 const a=await withApp(t),b=await withApp(t),id=await a.addSite({origins:['https://www.fern.example'],currency:'eur'}),get=(app,path)=>app.request(path,{headers:{cookie:app.owner}})
 for(const origin of ['https://fern.example','https://www.fern.example'])assert.equal((await a.collect(a.event(id),origin)).status,202,origin)
 assert.equal((await a.collect(a.event(id),'https://shop.fern.example')).status,403)
 await movein(a,id)
 const summary=async(app,siteId=id)=>(await get(app,'/api/vane/summary?siteId='+siteId)).json(),before=await summary(a);assert.equal(before.pageviews,2)
 const config=async app=>(await (await get(app,'/api/vane/sites')).json()).find(s=>s.id===id)?.config
 assert.deepEqual([(await config(a)).origins,(await config(a)).currency,(await config(a)).timeZone],[['https://www.fern.example'],'EUR','UTC'])
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',origins:'https://www.fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',timeZone:'America/Chicago',currency:'USD'}
 assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{...input,currency:'XYZ'}},a.owner)).status,400)
 const change=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json()
 assert.equal((await config(a)).currency,'EUR')
 assert.equal((await a.form({operation:'proposal.approve',id:change.id},a.owner)).status,303)
 assert.deepEqual([(await config(a)).currency,(await config(a)).timeZone],['USD','America/Chicago'])
 assert.match(await (await get(a,`/app/sites/${id}?section=settings`)).text(),/name="currency"[^>]*value="USD"/)
 // Transfer: the site archive carries settings, native and imported history into another installation.
 const admin=await a.invite('admin@example.test','admin'),member=await a.invite('member@example.test','member')
 for(const person of [admin,member])assert.equal((await a.request('/api/vane/export?siteId='+id,{headers:{cookie:person}})).status,403)
 const response=await get(a,'/api/vane/export?siteId='+id);assert.equal(response.status,200);const archive=await response.json()
 assert.equal((await b.post('/api/vane/site-import',{archive},(await b.invite('admin@example.test','admin')))).status,403)
 const corrupt=structuredClone(archive);corrupt.payload.tables.vane_events[0].path='/changed'
 assert.equal((await b.post('/api/vane/site-import',{archive:corrupt},b.owner)).status,400)
 assert.equal((await b.post('/api/vane/site-import',{archive},b.owner)).status,201)
 const moved=await summary(b),after=await summary(a);assert.deepEqual([moved.pageviews,moved.imported,moved.goals],[after.pageviews,after.imported,after.goals])
 assert.ok(archive.payload.tables.vane_import_events.length>0);assert.deepEqual((await b.dump()).vane_import_events,archive.payload.tables.vane_import_events)
 assert.deepEqual(await config(b),await config(a))
 assert.equal((await b.collect(b.event(id),'https://www.fern.example')).status,202)
 assert.equal((await b.post('/api/vane/site-import',{archive},b.owner)).status,409)
 // Deletion through approval removes the site and every row of its history; only journals naming the ID remain.
 const deletion=await (await a.post('/api/vane/commands',{command:'site.delete',input:{siteId:id}},a.owner)).json()
 assert.equal((await summary(a)).pageviews,after.pageviews)
 assert.equal((await a.form({operation:'proposal.approve',id:deletion.id},a.owner)).status,303)
 assert.equal((await get(a,'/api/vane/summary?siteId='+id)).status,404)
 const left=Object.entries(await a.dump()).filter(([,rows])=>JSON.stringify(rows).includes(id)).map(([name])=>name).sort()
 assert.deepEqual(left.filter(name=>!['vane_audit','vane_deletions','vane_proposals','vane_import_erasure_fences'].includes(name)&&!name.startsWith('ik_')),[])
 const dump=await a.dump();for(const name of ['vane_sites','vane_events','vane_signals','vane_auto_events','vane_admission','vane_salts','vane_import_events'])assert.equal(dump[name].filter(row=>JSON.stringify(row).includes(id)).length,0,name)
 assert.ok(dump.vane_audit.some(row=>row.action==='site.delete'&&row.subject===id)&&dump.vane_audit.some(row=>row.action==='site.export')&&(await b.dump()).vane_audit.some(row=>row.action==='site.import'))
 assert.equal((await a.post('/api/vane/site-import',{archive},a.owner)).status,409)
})
test('COLLECT-002 in a browser every page is collected with its hostname, paths are redacted and rewritten, UTM values, ref/source sources and the paid-click flag are kept, and titles and other queries never stored',async t=>{
 const a=await withApp(t),id=await a.addSite({paths:[],excludePaths:['/admin/**'],rewrites:['/orders/*=/orders/:id'],queryKeys:['plan'],origins:['https://www.fern.example']})
 const page=title=>`<!doctype html><title>${title}</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`
 const urls={
  'https://fern.example/users/jo%40example.com?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_term=pour-over&utm_content=hero&gclid=gclid-secret-1&ref=x':'/users/:email',
  'https://fern.example/reset/eyJhbGciOiJIUzI1NiJ9xQ2/confirm?fbclid=fb-secret-2':'/reset/:token/confirm',
  'https://fern.example/orders/1234567':'/orders/:id','https://fern.example/orders/42':'/orders/:id',
  'https://fern.example/invoices/0b8e4c1a-2f3d-4e5f-8a9b-1c2d3e4f5a6b':'/invoices/:uuid',
  'https://fern.example/blog/top-10-brews-2024':'/blog/top-10-brews-2024',
  'https://fern.example/?ref=producthunt':'/',
  'https://www.fern.example/?source=newsletter&plan=pro&secret=private-value':'/',
 }
 const {context}=await browse(t,a,Object.fromEntries([...Object.keys(urls),'https://fern.example/admin/panel'].map(url=>[url,page('Order 1234567 for jo@example.com')]))),tab=await context.newPage()
 for(const url of Object.keys(urls)){const sent=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await tab.goto(url);assert.equal((await sent).status(),202,url)}
 const excluded=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await tab.goto('https://fern.example/admin/panel');assert.equal((await excluded).status(),403)
 const dump=await a.dump(),rows=dump.vane_events.filter(e=>e.site_id===id&&e.kind==='pageview').sort((x,y)=>x.at-y.at||x.id.localeCompare(y.id))
 assert.deepEqual(rows.map(e=>e.path).sort(),Object.values(urls).sort())
 const first=rows.find(e=>e.path==='/users/:email')
 assert.deepEqual([first.hostname,first.source,first.campaign,first.utm_source,first.utm_medium,first.utm_term,first.utm_content,first.paid_click],['fern.example','google','spring','google','cpc','pour-over','hero',1],'utm_source wins over ref, every UTM field and the paid-click flag are kept')
 assert.equal(rows.find(e=>e.path==='/reset/:token/confirm').paid_click,1)
 assert.equal(rows.find(e=>e.path==='/blog/top-10-brews-2024').paid_click,0)
 const home=rows.filter(e=>e.path==='/').map(e=>[e.hostname,e.source,e.query])
 assert.deepEqual(home,[['fern.example','producthunt',null],['www.fern.example','newsletter','plan=pro']])
 const stored=JSON.stringify(dump)
 for(const secret of ['jo@example.com','jo%40example.com','1234567','eyJhbGciOiJIUzI1NiJ9xQ2','0b8e4c1a','gclid-secret-1','fb-secret-2','private-value','Order ','/admin/panel'])assert.equal(stored.includes(secret),false,secret)
 const r=await (await a.request('/api/vane/summary?siteId='+id,{headers:{cookie:a.owner}})).json()
 assert.deepEqual(Object.fromEntries(r.sources.map(s=>[s.label,s.count])),{direct:5,google:1,producthunt:1,newsletter:1})
 // The site has two hostnames, so page rows carry the hostname (DASH-013).
 assert.deepEqual(r.topPages.map(p=>p.path).filter(p=>p.includes('/orders')),['fern.example/orders/:id'])
 assert.equal(r.topPages.find(p=>p.path==='fern.example/orders/:id').pageviews,2)
 // Direct posts get the same treatment: a query in the path is refused, and an unknown kept key or UTM field is refused.
 for(const extra of [{path:'/thanks?email=x'},{query:{secret:'x'}},{utm:{campaign:'x'}}])assert.equal((await a.collect(a.event(id,extra))).status,400,JSON.stringify(extra))
})
test('DASH-004 Google organic and paid, Facebook, an email UTM, webmail, chatgpt.com and five-field UTMs land in their channels, every UTM field is reportable, and each row\'s visitors, bounce rate and duration match the seeded visits',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({goals:{signup:'/thanks',landing:'/'}}),start=Date.parse('2026-03-10T10:00:00Z')
 const send=async(n,at,extra)=>{await a.clock(at);const event=a.event(id,{source:'direct',campaign:'none',...extra});const r=await a.post('/api/vane/collect',event,'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':'Synthetic Browser '+n});assert.equal(r.status,202,JSON.stringify(extra));return event.id}
 await send(1,start,{referrer:'https://www.google.com/'});await send(1,start+120000,{path:'/thanks'})
 await send(2,start,{referrer:'https://www.google.com/',click:true})
 await send(3,start,{referrer:'https://l.facebook.com/'})
 const mail=await send(4,start,{utm:{source:'newsletter',medium:'email'},campaign:'october'})
 await a.clock(start+45000);assert.equal((await a.post('/api/vane/engage',{siteId:id,id:mail,scroll:40},'',{origin:'https://fern.example'})).status,202)
 await send(5,start,{referrer:'https://chatgpt.com/'})
 await send(6,start,{utm:{source:'brewnews',medium:'banner',term:'pour-over',content:'hero'},campaign:'launch'})
 await send(7,start,{referrer:'https://duckduckgo.com/'})
 await send(8,start,{})
 const webmail=await send(9,start,{referrer:'https://mail.google.com/mail/u/0/'})
 await a.clock(start+15000);assert.equal((await a.post('/api/vane/engage',{siteId:id,id:webmail,scroll:10},'',{origin:'https://fern.example'})).status,202)
 const summary=async(goal='')=>(await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-10&to=2026-03-11${goal?'&goal='+goal:''}`,owner)).json(),r=await summary('signup')
 const table=rows=>Object.fromEntries(rows.map(row=>[row.label,[row.visitors,row.visits,row.bounceRate,row.averageDuration,row.medianDuration,row.conversionRate]]))
 assert.deepEqual(table(r.channels),{'Organic Search':[2,2,50,60,60,50],'Email':[2,2,0,30,30,0],'AI Assistants':[1,1,100,0,0,0],'Direct':[1,1,100,0,0,0],'Display':[1,1,100,0,0,0],'Organic Social':[1,1,100,0,0,0],'Paid Search':[1,1,100,0,0,0]})
 assert.deepEqual(table(r.sourceVisits).Google,[2,2,50,60,60,50])
 assert.deepEqual(Object.keys(table(r.sourceVisits)).sort(),['ChatGPT','DuckDuckGo','Facebook','Google','Webmail','brewnews','direct','newsletter'])
 assert.deepEqual(Object.keys(table(r.referrers)).sort(),['chatgpt.com/','duckduckgo.com/','l.facebook.com/','www.google.com/'],'webmail addresses are never kept')
 for(const [key,labels] of [['utmSources',['brewnews','newsletter']],['utmMediums',['banner','email']],['utmCampaigns',['launch','october']],['utmTerms',['pour-over']],['utmContents',['hero']]])assert.deepEqual(r[key].map(row=>row.label).sort(),labels,key)
 assert.deepEqual(table(r.utmMediums).email,[1,1,0,45,45,0])
 // With any goal, every visit converts: each entered on / (the landing goal); the page tables follow the same choice.
 const any=await summary();assert.ok(any.channels.every(row=>row.conversionRate===100));assert.equal(any.topPages.find(p=>p.path==='/thanks').conversionRate,100);assert.equal(r.entryPages.find(p=>p.path==='/').conversionRate,11.1,'one of nine visits entering on / reached signup')
 assert.equal((await a.request(`/api/vane/summary?siteId=${id}&goal=nope`,owner)).status,400)
 const page=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=2026-03-10&to=2026-03-11`,owner)).text())
 assert.match(page,/<th scope="row">AI Assistants<\/th><td class="vane-number">1<\/td><td class="vane-number">1<\/td><td class="vane-number">100\.0%<\/td>/)
 // In a browser, a link followed from chatgpt.com reaches collection as its referring page and channel.
 const {context}=await browse(t,a,{'https://chatgpt.com/c/123?q=private':'<!doctype html><a href="https://fern.example/thanks?utm_medium=referral">Fern</a>','https://fern.example/thanks?utm_medium=referral':`<!doctype html><title>Journal</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`}),tab=await context.newPage()
 await a.clock(Date.now());await tab.goto('https://chatgpt.com/c/123?q=private');const sent=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await tab.click('a');assert.equal((await sent).status(),202)
 const followed=(await a.dump()).vane_events.find(e=>e.site_id===id&&e.path==='/thanks'&&e.kind==='pageview'&&e.referrer);assert.deepEqual([followed.source,followed.referrer,followed.channel,followed.utm_medium],['chatgpt.com','chatgpt.com/','AI Assistants','referral'])
})
test('DASH-014 Hacker News, two Slack referrers, Facebook and an unlisted blog report under named sources with a drill-down, and an approved owner rule regroups the blog',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite()
 for(const [n,referrer] of ['https://news.ycombinator.com/item?id=1','android-app://com.slack.android','https://app.slack.com/','https://l.facebook.com/','https://brewblog.example/'].entries())assert.equal((await a.post('/api/vane/collect',a.event(id,{source:'direct',campaign:'none',referrer}),'',{origin:'https://fern.example','cf-connecting-ip':'198.51.100.'+n,'user-agent':'Synthetic Browser'})).status,202,referrer)
 const summary=async()=>(await a.request('/api/vane/summary?siteId='+id,owner)).json(),pick=r=>Object.fromEntries(r.sources.map(s=>[s.label,s.count]))
 let r=await summary()
 assert.deepEqual(pick(r),{'Hacker News':1,Slack:2,Facebook:1,'brewblog.example':1})
 assert.deepEqual(Object.fromEntries(r.sourceVisits.map(s=>[s.label,s.visits])),{'Hacker News':1,Slack:2,Facebook:1,'brewblog.example':1})
 assert.deepEqual(r.sourceReferrers.filter(s=>s.source==='Slack').map(s=>s.referrer).sort(),['android-app://com.slack.android','app.slack.com'])
 assert.deepEqual(Object.fromEntries(r.channels.map(c=>[c.label,c.visits])),{'Organic Social':4,Referral:1})
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',sourceRules:'brewblog.example=Brew Blog'}
 const p=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json()
 assert.equal(pick(await summary())['brewblog.example'],1,'the rule waits for approval')
 assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)
 r=await summary();assert.deepEqual(pick(r),{'Hacker News':1,Slack:2,Facebook:1,'Brew Blog':1})
 assert.ok((await (await a.request(`/app/sites/${id}?section=report`,owner)).text()).includes('brewblog.example as Brew Blog'))
})
test('PRIVACY-001 the data inventory and generated policy text change with the site settings, and every stored column of the site is in its inventory',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite(),inv=async()=>(await a.request('/api/vane/inventory?siteId='+id,owner)).json()
 let i=await inv(),text=i.policyText.join(' ')
 assert.deepEqual(i.fields.map(f=>f.name).filter(name=>['Automatic events','Site search','Privacy-signal count','Kept query parameters'].includes(name)),[])
 assert.deepEqual([i.retention,i.processors.length,/Cloudflare/.test(i.processors[0]),/midnight in UTC/.test(i.salt)],['90 days',1,true,true])
 for(const phrase of ['sets no cookies','without asking for consent','kept for 90 days'])assert.ok(text.includes(phrase),phrase);assert.equal(text.includes('files you download'),false)
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'required',retentionDays:30,timeZone:'America/Chicago',searchParam:'q',signalCounter:true,autoEvents:['download','outbound'],queryKeys:['plan']}
 const p=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)
 i=await inv();text=i.policyText.join(' ')
 assert.deepEqual(i.fields.map(f=>f.name).filter(name=>['Automatic events','Site search','Privacy-signal count','Kept query parameters'].includes(name)),['Kept query parameters','Site search','Automatic events','Privacy-signal count'])
 assert.deepEqual([i.retention,/midnight in America\/Chicago/.test(i.salt)],['30 days',true])
 for(const phrase of ['files you download','links you follow to other sites','Search terms you enter','only records your visit after you give consent','we only count how many such page loads arrive','kept for 30 days'])assert.ok(text.includes(phrase),phrase)
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes('Data inventory'))
 // Everything the site stores is named by the inventory.
 const visitor={origin:'https://fern.example','cf-connecting-ip':'203.0.113.40','user-agent':'Synthetic Browser'},event=a.event(id,{consent:'granted',search:'Pour Over',query:{plan:'pro'},utm:{medium:'email',source:'news',term:'t',content:'c'},referrer:'https://news.ycombinator.com/item',click:true,width:390})
 await a.clock(Date.now());assert.equal((await a.post('/api/vane/collect',event,'',visitor)).status,202)
 await a.clock(Date.now()+15000);assert.equal((await a.post('/api/vane/engage',{siteId:id,id:event.id,scroll:60},'',visitor)).status,202)
 assert.equal((await a.post('/api/vane/event',{id:crypto.randomUUID(),siteId:id,kind:'download',prop:'https://fern.example/menu.pdf',consent:'granted'},'',visitor)).status,202)
 assert.equal((await a.request('/api/vane/signal/'+id,{method:'POST',headers:visitor,body:''})).status<300,true)
 const dump=await a.dump()
 for(const table of ['vane_events','vane_auto_events','vane_signals']) {
  const named=new Set(i.fields.filter(f=>f.table===table).flatMap(f=>f.columns)),rows=dump[table].filter(row=>row.site_id===id)
  assert.ok(rows.length,table)
  for(const row of rows)for(const [column,value] of Object.entries(row))if(value!==null)assert.ok(named.has(column),`${table}.${column} is in the inventory`)
 }
})
test('DASH-013 www and blog hostnames keep their pages apart, the Hostnames report and filter (is, is not, contains, wildcard) narrow the dashboard and Stats API, and a goal scoped to one hostname converts only there',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},www='https://www.fern.example',blog='https://blog.fern.example'
 const id=await a.addSite({origin:www,origins:[blog],paths:[],goals:{'blog-thanks':'blog.fern.example/thanks'},autoEvents:['outbound']})
 let n=0;const send=async(origin,path)=>{n++;const r=await a.post('/api/vane/collect',a.event(id,{path,source:'direct',campaign:'none'}),'',{origin,'cf-connecting-ip':'203.0.113.'+n,'user-agent':'Synthetic Browser'});assert.equal(r.status,202,origin+path)}
 for(const origin of [www,blog])for(const path of ['/','/pricing','/thanks'])await send(origin,path)
 for(const origin of [www,blog])assert.equal((await a.post('/api/vane/event',{id:crypto.randomUUID(),siteId:id,kind:'outbound',prop:'https://example.org/',consent:'not-required'},'',{origin})).status,202)
 assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/'}),'',{origin:'https://shop.fern.example'})).status,403,'a hostname the site does not allow is refused')
 const summary=async(query='')=>{const r=await a.request(`/api/vane/summary?siteId=${id}${query}`,owner);assert.equal(r.status,200,query);return r.json()}
 const all=await summary()
 assert.deepEqual(all.topPages.map(p=>p.path).sort(),['blog.fern.example/','blog.fern.example/pricing','blog.fern.example/thanks','www.fern.example/','www.fern.example/pricing','www.fern.example/thanks'])
 assert.deepEqual(all.hostnames.map(h=>[h.path,h.visitors,h.visits,h.pageviews,h.bounceRate,h.conversions]),[['blog.fern.example',3,3,3,100,1],['www.fern.example',3,3,3,100,0]])
 assert.deepEqual(all.goalBreakdown.map(g=>[g.label,g.count]),[['blog-thanks',1]],'the scoped goal converts only on its hostname')
 const shape=r=>[r.pageviews,r.visitors,r.goals,r.topPages.length,r.automaticEvents.reduce((sum,e)=>sum+Number(e.count),0),[...new Set(r.topPages.map(p=>p.path.split('/')[0]))].sort().join(' ')]
 assert.deepEqual(shape(await summary('&hostOp=is&host=blog.fern.example')),[3,3,1,3,1,'blog.fern.example'])
 assert.deepEqual(shape(await summary('&hostOp=is_not&host=blog.fern.example')),[3,3,0,3,1,'www.fern.example'])
 assert.deepEqual(shape(await summary('&hostOp=contains&host=blog')),[3,3,1,3,1,'blog.fern.example'])
 assert.deepEqual(shape(await summary('&hostOp=matches&host=*.fern.example')),[6,6,1,6,2,'blog.fern.example www.fern.example'])
 assert.equal((await a.request(`/api/vane/summary?siteId=${id}&hostOp=is&host=bl'og`,owner)).status,400)
 const page=await (await a.request(`/app/sites/${id}?section=report&hostOp=is&host=blog.fern.example`,owner)).text()
 assert.ok(page.includes('Filtered: hostname is blog.fern.example'));assert.ok(!page.includes('www.fern.example/pricing'))
})
test('COVERAGE-001 declined consent, excluded paths, privacy signals, sampling, an import and erased history are each shown with their denominator, and every total is labelled partial',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],excludePaths:['/admin/**'],consent:'required',declinedCounter:true,signalCounter:true,sampleRate:50})
 // In a browser, a page load without consent sends only an empty declined count.
 const {context}=await browse(t,a,{'https://fern.example/':`<!doctype html><title>Fern</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`}),tab=await context.newPage()
 const declined=tab.waitForRequest(r=>new URL(r.url()).pathname==='/api/vane/declined/'+id);await tab.goto('https://fern.example/');const request=await declined
 assert.equal(request.postData()??'',''); assert.equal((await request.response()).status(),202)
 const site={origin:'https://fern.example'}
 assert.equal((await a.post('/api/vane/declined/'+id,{path:'/private'},'',site)).status,400,'a declined count carries no fields')
 assert.equal((await a.request('/api/vane/declined/'+id,{method:'POST',headers:site,body:''})).status,202)
 for(const n of [1,2])assert.equal((await a.post('/api/vane/collect',a.event(id,{consent:'granted'}),'',{...site,'cf-connecting-ip':'203.0.113.'+n})).status,202)
 assert.equal((await a.post('/api/vane/collect',a.event(id,{consent:'granted',path:'/admin/users'}),'',site)).status,403)
 assert.equal((await a.request('/api/vane/signal/'+id,{method:'POST',headers:site,body:''})).status,202)
 const today=new Date(Date.now()-86400000).toISOString().slice(0,10),data=[{id:'cov-1',websiteId:'w',sessionId:'s',createdAt:today+'T00:00:01Z',urlPath:'/',urlQuery:'',referrerPath:'',referrerQuery:'',referrerDomain:'',pageTitle:'',eventType:1,eventName:''}]
 await movein(a,id,{data,count:1,page:1,pageSize:1})
 const r=await (await a.request('/api/vane/summary?siteId='+id,owner)).json()
 assert.deepEqual([r.complete,r.exclusions,r.privacySignals,r.imported],[false,[{reason:'consent-declined',count:2},{reason:'excluded-path',count:1}],1,1])
 const html=await (await a.request(`/app/sites/${id}?section=report`,owner)).text(),seen=r.pageviews
 for(const part of ['Every total below is partial',`Declined consent</dt><dd>2 of ${2+seen} page loads that reached Vane (${(200/(2+seen)).toFixed(1)}%)`,`Excluded paths</dt><dd>1 of ${1+seen} page loads that reached Vane`,'Sample rate</dt><dd>50%','Imported share</dt><dd>1 of','Totals</dt><dd>Partial.'])assert.ok(html.includes(part),part)
 const inventory=await (await a.request('/api/vane/inventory?siteId='+id,owner)).json();assert.ok(inventory.fields.some(f=>f.table==='vane_exclusions'&&/without consent/.test(f.description)))
 const p=await (await a.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)
 const after=await (await a.request('/api/vane/summary?siteId='+id,owner)).json();assert.deepEqual([after.deletedHistory.map(d=>d.reason),after.exclusions],[['owner-erasure'],[]])
 assert.ok((await (await a.request(`/app/sites/${id}?section=report`,owner)).text()).includes('Deleted history</dt><dd>Events before'))
})
test('DASH-002 events either side of the November daylight-saving change and midnight in America/Chicago fall in local days and hours, every preset range returns its totals, and the data table matches the chart',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 await a.clock(Date.parse('2025-05-01T17:00:00Z'));const id=await a.addSite({timeZone:'America/Chicago'})
 // Local times: noon on five earlier days, then 23:30 CDT on 31 October, 00:30 and 01:30 CDT, 01:30 CST (the repeated hour) and 23:50 CST on 1 November, and 00:10 CST on 2 November.
 for(const [at,path] of [['2025-06-01T17:00:00Z','/'],['2025-12-01T18:00:00Z','/'],['2026-01-10T18:00:00Z','/'],['2026-08-15T17:00:00Z','/'],['2026-10-10T17:00:00Z','/'],['2026-11-01T04:30:00Z','/'],['2026-11-01T05:30:00Z','/'],['2026-11-01T06:30:00Z','/'],['2026-11-01T07:30:00Z','/'],['2026-11-02T05:50:00Z','/'],['2026-11-02T06:10:00Z','/thanks']]){await a.clock(Date.parse(at));assert.equal((await a.collect(a.event(id,{path}))).status,202,at)}
 await a.clock(Date.parse('2026-11-02T18:00:00Z'))
 const summary=async query=>{const r=await a.request(`/api/vane/summary?siteId=${id}${query}`,owner);assert.equal(r.status,200,query);return r.json()}
 const presets={today:['2026-11-02','2026-11-03',1],yesterday:['2026-11-01','2026-11-02',4],'7d':['2026-10-27','2026-11-03',6],'30d':['2026-10-04','2026-11-03',7],'90d':['2026-08-05','2026-11-03',8],month:['2026-11-01','2026-11-03',5],'last-month':['2026-10-01','2026-11-01',2],year:['2026-01-01','2026-11-03',9],'12mo':['2025-12-01','2026-11-03',10],all:['2025-06-01','2026-11-03',11]}
 const sum=(r,key)=>r.series.reduce((n,b)=>n+b[key],0)
 for(const [period,[from,to,pageviews]] of Object.entries(presets))for(const interval of ['','week','month']){
  const r=await summary(`&period=${period}&interval=${interval}`)
  assert.deepEqual([r.from,r.to,r.pageviews],[from,to,pageviews],period)
  // Hours count their own distinct hashes, so only daily and longer buckets add up to the range's daily uniques.
  assert.deepEqual([sum(r,'pageviews'),sum(r,'visits'),r.interval==='hour'?r.visitors:sum(r,'visitors'),sum(r,'conversions')],[r.pageviews,r.visits,r.visitors,r.goals],`${period} by ${r.interval}: the buckets add up to the totals`)
 }
 // Daily buckets follow local days: 23:30 on 31 October and 00:10 on 2 November stay out of 1 November.
 const week=await summary('&period=7d');assert.equal(week.interval,'day')
 assert.deepEqual(week.series.map(b=>[b.label,b.pageviews,b.visits,b.conversions]),[['2026-10-27',0,0,0],['2026-10-28',0,0,0],['2026-10-29',0,0,0],['2026-10-30',0,0,0],['2026-10-31',1,1,0],['2026-11-01',4,4,0],['2026-11-02',1,1,1]])
 // The fall-back day has 25 hourly buckets; 01:00 happens twice, once in CDT and once in CST.
 const day=await summary('&period=yesterday');assert.equal(day.interval,'hour');assert.equal(day.series.length,25)
 assert.deepEqual(day.series.filter(b=>b.pageviews).map(b=>b.label),['2026-11-01 00:00 CDT','2026-11-01 01:00 CDT','2026-11-01 01:00 CST','2026-11-01 23:00 CST'])
 assert.equal((await a.request(`/api/vane/summary?siteId=${id}&period=90d&interval=hour`,owner)).status,400,'hourly charts cover at most 31 days')
 // The page draws the chosen metric and lists every bucket in its data table; each point equals its table cell.
 for(const [query,metric,expected] of [['period=7d&metric=pageviews','pageviews',['0','0','0','0','1','4','1']],['period=yesterday&metric=visits','visits',null]]){
  const html=await (await a.request(`/app/sites/${id}?section=report&${query}`,owner)).text()
  const points=[...html.matchAll(/<circle class="vane-chart-point"[^>]*data-value="([^"]*)"/g)].map(m=>m[1]),cells=[...html.matchAll(new RegExp(`<td class="vane-number" data-metric="${metric}">([^<]*)</td>`,'g'))].map(m=>m[1])
  assert.equal(points.length,metric==='pageviews'?7:25,query);assert.deepEqual(points,cells,query);if(expected)assert.deepEqual(points,expected)
  assert.match(html,/<svg class="vane-chart"[^>]*role="img"/);assert.match(html,/<caption>[^<]* by (day|hour), [^<]*\(Central Time\)<\/caption>/)
 }
 // A new site's time zone starts as the zone the owner's browser reports.
 const {context}=await browse(t,a,{},{timezoneId:'America/Chicago'});await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 const page=await context.newPage();await page.goto(a.origin+'/app',{waitUntil:'networkidle'})
 assert.equal(await page.getByRole('textbox',{name:'Time zone'}).inputValue(),'America/Chicago')
})
test('DASH-008 a day still running is compared like with like: at 6:30 AM, 9:30 AM and 4 PM Central flat weeks read flat, and Today stops at the current hour without being judged',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 await a.clock(Date.parse('2026-10-04T12:00:00Z'));const id=await a.addSite({timeZone:'America/Chicago'})
 // Identical days from Oct 5, 2026: one visitor each at 8 AM, noon and 6 PM Central; Monday Oct 19 runs up to each clock time.
 const load=async(d,n,hour)=>{await a.clock(Date.parse(`2026-10-${String(d).padStart(2,'0')}T${hour}:00:00Z`));assert.equal((await a.post('/api/vane/collect',a.event(id),'',{origin:'https://fern.example','cf-connecting-ip':`203.0.113.${n}`,'user-agent':'Synthetic Browser'})).status,202)}
 for(let d=5;d<=18;d++)for(const [n,hour] of [[1,13],[2,17],[3,23]])await load(d,n,hour)
 for(const [at,hour,sofar,arrived] of [['2026-10-19T11:30:00Z',6,0,[]],['2026-10-19T14:30:00Z',9,1,[[1,13]]],['2026-10-19T21:00:00Z',16,2,[[2,17]]]]){
  for(const [n,h] of arrived)await load(19,n,h)
  await a.clock(Date.parse(at))
  const week=await (await a.request(`/api/vane/summary?siteId=${id}&period=7d`,owner)).json(),today=await (await a.request(`/api/vane/summary?siteId=${id}&period=today`,owner)).json()
  assert.deepEqual([week.visitors,week.previousVisitors,week.pageviews,week.previousPageviews,week.visits,week.previousVisits],Array(6).fill(18+sofar),at)
  assert.deepEqual([today.visitors,today.previousVisitors,today.running.day,today.running.thenDay],[sofar,sofar,'2026-10-19','2026-10-18'],at)
  const html=await (await a.request(`/app/sites/${id}?section=report&period=today`,owner)).text()
  assert.equal((html.match(/<circle class="vane-chart-point"/g)??[]).length,hour+1,`${at}: the hourly line stops at the current hour`)
  assert.ok(html.includes('Today is still running')&&!/vane-moved-finding">[^<]*fell/.test(html),`${at}: Today is not judged`)
  assert.ok(!(await (await a.request(`/app/sites/${id}?section=report`,owner)).text()).match(/vane-delta is-bad/),`${at}: no card reads as a drop`)
  assert.match(await (await a.request('/app',owner)).text(),/data-change="0">[^<]*<\/span> so far/,`${at}: the site row's change is flat`)
 }
})
test('DASH-008 the last 30 days compared with the previous period, the same period last year and a custom period, with and without matched weekdays, overlay the chart and give every table row its absolute and percentage change',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 await a.clock(Date.parse('2025-05-01T10:00:00Z'));const id=await a.addSite({paths:['/','/pricing','/thanks']})
 const visit=async(at,people,path,source)=>{await a.clock(Date.parse(at));for(const n of people)assert.equal((await a.post('/api/vane/collect',a.event(id,{path,source}),'',{origin:'https://fern.example','cf-connecting-ip':`203.0.113.${n}`,'user-agent':'Synthetic Browser'})).status,202,at)}
 await visit('2025-06-10T10:00:00Z',[1],'/pricing','alpha.example');await visit('2025-06-20T10:00:00Z',[1,2,3,4],'/','beta.example')
 await visit('2026-04-28T10:00:00Z',[1],'/pricing','alpha.example');await visit('2026-05-15T10:00:00Z',[1,2],'/pricing','alpha.example');await visit('2026-05-29T10:00:00Z',[1],'/','gamma.example')
 await visit('2026-06-10T10:00:00Z',[1,2,3],'/pricing','alpha.example');await visit('2026-06-20T10:00:00Z',[4],'/','beta.example')
 await a.clock(Date.parse('2026-06-30T12:00:00Z'))
 const summary=async query=>{const r=await a.request(`/api/vane/summary?siteId=${id}&period=30d${query}`,owner);assert.equal(r.status,200,query);return r.json()}
 const sources=r=>Object.fromEntries(r.sources.map(row=>[row.label,[row.count,row.previous]])),at=(r,i)=>[r.series[i].pageviews,r.previousSeries[i].pageviews]
 const previous=await summary('');assert.deepEqual([previous.from,previous.to,previous.previousFrom,previous.previousTo,previous.pageviews,previous.previousPageviews],['2026-06-01','2026-07-01','2026-05-02','2026-06-01',4,3])
 assert.deepEqual(sources(previous),{'alpha.example':[3,2],'beta.example':[1,0],'gamma.example':[0,1]})
 assert.deepEqual([at(previous,9),at(previous,13),at(previous,19),at(previous,27)],[[3,0],[0,2],[1,0],[0,1]],'the overlay pairs each day with its compared day')
 const year=await summary('&compare=year');assert.deepEqual([year.previousFrom,year.previousTo,year.previousPageviews],['2025-06-01','2025-07-01',5])
 assert.deepEqual(sources(year),{'alpha.example':[3,1],'beta.example':[1,4]});assert.deepEqual([at(year,9),at(year,19)],[[3,1],[1,4]])
 assert.deepEqual(year.channels.map(row=>[row.label,row.visitors,row.previous]),[['Referral',4,5]])
 assert.deepEqual(year.topPages.map(row=>[row.path,row.visitors,row.previous]),[['/pricing',3,1],['/',1,4]])
 // Matching weekdays: 1 June 2026 is a Monday, and so is each compared start.
 const weekly=await summary('&weekdays=on');assert.deepEqual([weekly.previousFrom,weekly.previousTo],['2026-04-27','2026-05-27']);assert.deepEqual(sources(weekly),{'alpha.example':[3,3],'beta.example':[1,0]})
 assert.deepEqual((await summary('&compare=year&weekdays=on')).previousFrom,'2025-06-02')
 const custom=await summary('&compare=custom&compareFrom=2025-06-15&compareTo=2025-06-25');assert.deepEqual([custom.previousFrom,custom.previousTo,custom.previousPageviews],['2025-06-15','2025-06-25',4])
 const shifted=await summary('&compare=custom&compareFrom=2025-06-15&compareTo=2025-06-25&weekdays=on');assert.deepEqual([shifted.previousFrom,shifted.previousTo,shifted.previousPageviews],['2025-06-09','2025-06-19',1])
 assert.equal((await a.request(`/api/vane/summary?siteId=${id}&compare=custom&compareFrom=2025-06-25&compareTo=2025-06-15`,owner)).status,400)
 // On the page: both series on the chart, and every table row carries its change, absolute and in percent.
 for(const [query,r,rows] of [['',previous,[['alpha.example','+1 (+50.0%)'],['beta.example','+1 (new)'],['gamma.example','-1 (-100.0%)']]],['&compare=year',year,[['alpha.example','+2 (+200.0%)'],['beta.example','-3 (-75.0%)'],['/pricing','+2 (+200.0%)'],['Referral','-1 (-20.0%)']]]]){
  const html=unlinked(await (await a.request(`/app/sites/${id}?section=report&period=30d&metric=pageviews${query}`,owner)).text())
  const values=kind=>[...html.matchAll(new RegExp(`<circle class="${kind}"[^>]*data-value="([^"]*)"`,'g'))].map(m=>Number(m[1]))
  assert.deepEqual([values('vane-chart-point'),values('vane-chart-compare-point')],[r.series.map(b=>b.pageviews),r.previousSeries.map(b=>b.pageviews)],query)
  assert.equal((html.match(/<polyline class="vane-chart-compare"/g)??[]).length,1,query)
  for(const [label,text] of rows)assert.match(html,new RegExp(`<th scope="row">${label.replace('.','\\.')}</th>(<td[^>]*>[^<]*</td>)*<td class="vane-number" data-change="[^"]*">${text.replace(/[+().]/g,'\\$&')}</td>`),`${query} ${label}`)
  const tables=html.split('<table>').slice(1).map(part=>part.split('</table>')[0]).filter(table=>!table.includes('Compared with</th>'))
  assert.ok(tables.length>=10,query)
  for(const table of tables){assert.ok(table.includes('<th scope="col" class="vane-number">Change</th>'),table.slice(0,120));assert.equal((table.match(/<tr><th scope="row">/g)??[]).length,(table.match(/data-change="/g)??[]).length,table.slice(0,120))}
 }
})
