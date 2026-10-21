import test from 'node:test'
import { assert, readFile, createHash, createHmac, crc32, createRequire, installation, appsScript, fixture, unlinked, withApp, DESKTOP_CHROME, browse, movein } from './vane-helpers.mjs'

test('CONV-005 the funnel product → cart → checkout → purchase counts entrants, conversion, drop-off and median time per step against the compared day, the hostname filter recomputes it, and a drop-off opens the journeys',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],origins:['https://shop.fern.example'],goals:{purchase:'/thanks'},funnels:'checkout=/product/* > /cart > /checkout > goal:purchase'})
 assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:[],goals:{purchase:'/thanks'},consent:'not-required',funnels:'short=/cart'}},a.owner)).status,400,'a funnel has 2 to 8 steps')
 const visit=async(n,start,steps,origin='https://fern.example')=>{let at=Date.parse(start);for(const [path,after] of steps){at+=after*1000;await a.clock(at);assert.equal((await a.post('/api/vane/collect',a.event(id,{path,source:undefined,campaign:undefined}),'',{origin,'cf-connecting-ip':'203.0.113.'+n,'user-agent':'Synthetic Browser 5'})).status,202)}}
 const d='2026-03-03T10:00:00Z'
 await visit(1,d,[['/product/a',0],['/cart',30],['/checkout',90],['/thanks',60]]);await visit(2,d,[['/product/b',0],['/cart',40],['/checkout',30],['/thanks',120]])
 await visit(3,d,[['/product/a',0],['/cart',50],['/checkout',60]]);await visit(4,d,[['/product/a',0],['/cart',60]]);await visit(5,d,[['/product/c',0]])
 await visit(6,d,[['/cart',0],['/product/a',30]]);await visit(7,d,[['/product/a',0],['/cart',20]],'https://shop.fern.example');await visit(8,'2026-03-02T10:00:00Z',[['/product/a',0],['/cart',45]])
 const funnel=async extra=>(await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-03&to=2026-03-04${extra??''}`,owner)).json()).funnels[0]
 const f=await funnel();assert.equal(f.entrants,7)
 assert.deepEqual(f.steps.map(s=>[s.label,s.visits,s.conversionRate,s.stepRate,s.dropOff,s.medianSeconds,s.previous]),[['/product/*',7,100,null,2,null,1],['/cart',5,71.4,71.4,2,40,1],['/checkout',3,42.9,60,1,60,0],['goal:purchase',2,28.6,66.7,null,90,0]])
 const shop=await funnel('&host=shop.fern.example');assert.deepEqual(shop.steps.map(s=>s.visits),[1,1,0,0],'the hostname filter recomputes the funnel')
 const html=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-03&to=2026-03-04`,owner)).text()
 assert.ok(html.includes('<caption>checkout: 7 visits entered</caption>')&&html.includes('<th scope="row">2. /cart</th><td class="vane-number">5</td><td class="vane-number">71.4%</td><td class="vane-number">71.4%</td>'))
 const link=html.match(/<a href="([^"]+)" aria-label="Journeys onward from \/cart">2<\/a>/)[1].replaceAll('&amp;','&');assert.match(link,/journey=%2Fcart/)
 assert.ok((await (await a.request(`/app/sites/${id}${link}`,owner)).text()).includes('passed through /cart'),'the drop-off opens the journeys through /cart')
})
test('PERF-001 in a browser a page whose hero image arrives 3 seconds late reports an LCP p75 above 2.5 s on that page only, per page and device class, with no identifier in the report',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]}),{deflateSync,crc32}=await import('node:zlib'),{randomBytes}=await import('node:crypto')
 // A 160×120 noise PNG: high entropy, so Chrome counts it as a contentful image.
 const chunk=(type,data)=>{const head=Buffer.alloc(8);head.writeUInt32BE(data.length);head.write(type,4);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type),data])));return Buffer.concat([head,data,crc])},ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(160);ihdr.writeUInt32BE(120,4);ihdr[8]=8;ihdr[9]=2
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.concat(Array.from({length:120},()=>Buffer.concat([Buffer.from([0]),randomBytes(480)]))))),chunk('IEND',Buffer.alloc(0))])
 const script=`<script src="${a.origin}/vane.js" data-site="${id}"></script>`
 const {context}=await browse(t,a,{'https://fern.example/slow':`<!doctype html><title>Slow</title><img src="https://fern.example/hero.png" width="640" height="480" alt="">${script}`,'https://fern.example/fast':`<!doctype html><title>Fast</title><h1>Fast page</h1><p>Plain text renders at once.</p>${script}`})
 await context.route('https://fern.example/hero.png',async route=>{await new Promise(resolve=>setTimeout(resolve,3000));await route.fulfill({contentType:'image/png',body:png})})
 const tab=await context.newPage(),hide=()=>tab.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'))})
 const measure=async path=>{const collected=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await tab.goto('https://fern.example'+path,{waitUntil:'load'});assert.equal((await collected).status(),202);await tab.waitForTimeout(300);const sent=tab.waitForRequest(r=>new URL(r.url()).pathname==='/api/vane/perf');await hide();const request=await sent;assert.equal((await request.response()).status(),202);return JSON.parse(request.postData())}
 const slow=await measure('/slow'),fast=await measure('/fast')
 for(const body of [slow,fast])assert.ok(Object.keys(body).every(k=>['siteId','id','lcp','inp','cls','load'].includes(k)),'only the IDs and figures are sent')
 assert.ok(slow.lcp>2500&&slow.load>2500,`slow page LCP ${slow.lcp} ms`);assert.ok(fast.lcp<2500,`fast page LCP ${fast.lcp} ms`)
 const summary=await (await a.request('/api/vane/summary?siteId='+id,owner)).json(),pages=Object.fromEntries(summary.perf.pages.map(r=>[r.label,r]))
 assert.ok(pages['/slow'].lcp>2500&&pages['/fast'].lcp<2500,'LCP p75 is above 2.5 s on the slow page only');assert.deepEqual(summary.perf.devices.map(r=>[r.label,r.measured,r.lcp]),[['desktop',2,pages['/slow'].lcp]],'with two loads, nearest-rank p75 is the slower one')
 const html=unlinked(await (await a.request(`/app/sites/${id}?section=report`,owner)).text());assert.ok(html.includes(`<th scope="row">/slow</th><td class="vane-number">1</td><td class="vane-number" data-lcp="${pages['/slow'].lcp}">${(pages['/slow'].lcp/1000).toFixed(1)} s</td>`))
 assert.equal((await a.post('/api/vane/perf',{siteId:id,id:slow.id,lcp:100,url:'https://fern.example/slow'},'',{origin:'https://fern.example'})).status,400,'a report carries no other field')
 assert.equal((await a.post('/api/vane/perf',{siteId:id,id:crypto.randomUUID(),lcp:100},'',{origin:'https://fern.example'})).status,404,'a report names an existing page load')
 await context.close()
})
test('DASH-007 filtering the report by Organic Search, mobile and not /blog/* keeps hand-counted whole visits, saves a team segment that reopens in the report and the API and recomputes a funnel, and each comparison filters by visit',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/thanks'},funnels:'buy=/ > /pricing'})
 const desktop='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
 const start=Date.parse('2026-03-03T10:00:00Z'),google={referrer:'https://www.google.com/'},email={campaign:'spring',utm:{source:'newsletter',medium:'email'}}
 const visit=async(n,agent,first,paths)=>{for(const [i,path] of paths.entries()){await a.clock(start+n*600000+i*60000);assert.equal((await a.post('/api/vane/collect',a.event(id,{source:undefined,campaign:undefined,...(i?{}:first),path}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':agent})).status,202)}}
 // Organic Search + mobile + not /blog/* keeps visits 1, 5 and 6: 2 has /blog/a, 3 is desktop, 4 came from email, and /blog/* (one segment) does not match /blog/deep/post.
 await visit(1,iphone,google,['/','/pricing','/thanks']);await visit(2,iphone,google,['/blog/a','/pricing']);await visit(3,desktop,google,['/','/thanks'])
 await visit(4,iphone,email,['/','/pricing']);await visit(5,iphone,google,['/pricing']);await visit(6,iphone,google,['/','/blog/deep/post'])
 const range='from=2026-03-03&to=2026-03-04',summary=async query=>(await a.request(`/api/vane/summary?siteId=${id}&${range}&${query}`,owner)).json(),totals=r=>[r.visits,r.pageviews,r.goals,r.visitors]
 const all=await summary('');assert.deepEqual(totals(all),[6,12,2,6]);assert.deepEqual(all.funnels[0].steps.map(s=>s.visits),[4,2])
 // Each comparison keeps whole visits: acquisition and device by the first page load, page and goal by any page load (or none).
 for(const [filter,visits] of [['channel:is:Organic Search',5],['source:is:Google',5],['utm_medium:is:email',1],['device:is_not:desktop',5],['entry:is:/pricing',1],['page:contains:BLOG',2],['page:not_contains:blog',4],['page:matches:^/blog/[a-z]+$',1],['page:is:/blog/**',2],['goal:is:signup',2],['hostname:is:fern.example',6],['browser_version:matches:^Chrome ',1],['os_version:contains:ios',5]])assert.equal((await summary('filter='+encodeURIComponent(filter))).visits,visits,filter)
 assert.equal((await a.request(`/api/vane/summary?siteId=${id}&filter=${encodeURIComponent('page:matches:(')}`,owner)).status,400,'an invalid regular expression is refused')
 // A filtered report finds its kept visits once and deletes them when it returns.
 assert.deepEqual((await a.dump()).vane_report_kept,[],'no kept-visit rows outlive their report')
 // In the browser: click Organic Search in the channel table, add the device and page filters, and save the segment.
 const {context}=await browse(t,a,{},{viewport:{width:1440,height:900}});await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 const tab=await context.newPage();await tab.goto(`${a.origin}/app/sites/${id}?section=report&${range}`)
 await Promise.all([tab.waitForURL(/filter=channel/),tab.getByRole('link',{name:'Organic Search',exact:true}).first().click()])
 for(const [dimension,op,value] of [['device','is','mobile'],['page','is_not','/blog/*']]){await tab.getByLabel('Filter dimension').selectOption(dimension);await tab.getByLabel('Filter comparison').selectOption(op);await tab.getByLabel('Filter value').fill(value);await Promise.all([tab.waitForURL(u=>new URL(u).searchParams.get('filterValue')===value),tab.getByRole('button',{name:'Add filter'}).click()])}
 assert.deepEqual(await tab.locator('[data-active-filters] li').allTextContents(),['Channel is Organic Search Remove','Device is mobile Remove','Page is not /blog/* Remove'])
 assert.equal(await tab.locator('.vane-metrics .vane-metric').nth(1).textContent(),'3','visits 1, 5 and 6')
 // The save answers 303 to the report with the segment applied (the routed browser does not follow a fulfilled redirect).
 await tab.getByLabel('Segment name').fill('Organic mobile');const [saved]=await Promise.all([tab.waitForResponse(r=>r.request().method()==='POST'),tab.getByRole('button',{name:'Save as segment'}).click()])
 assert.equal(saved.status(),303);const segment=new URL(saved.headers().location,a.origin).searchParams.get('segment');assert.ok(segment)
 await tab.setViewportSize({width:390,height:844});await tab.goto(`${a.origin}/app/sites/${id}?section=report&${range}&segment=${segment}`)
 assert.equal(await tab.locator('[data-segment-applied]').textContent(),'Segment: Organic mobile.');assert.ok(await tab.locator('#filters').evaluate(e=>e.scrollWidth<=e.clientWidth),'the filters panel fits 390 px')
 // Reopened in the report and the API, the segment's totals, tables and funnel equal the hand count.
 const kept=await summary('segment='+segment);assert.deepEqual(totals(kept),[3,6,1,3]);assert.deepEqual(kept.channels.map(r=>[r.label,r.visits]),[['Organic Search',3]]);assert.deepEqual(kept.devices.map(r=>r.label),['mobile'])
 assert.deepEqual(kept.funnels[0].steps.map(s=>s.visits),[2,1],'the funnel counts visits 1 and 6 entering and visit 1 reaching /pricing')
 assert.deepEqual(totals(await summary(`segment=${segment}&filter=${encodeURIComponent('page:is:/pricing')}`)),[2,4,1,2],'an added filter narrows the segment')
 // Members apply saved segments; only the owner and administrators save or delete them, and each change is audited.
 assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'all'},a.owner)).status,303);const viewer=await a.accept('viewer@example.test')
 assert.equal((await (await a.request(`/api/vane/summary?siteId=${id}&${range}&segment=${segment}`,{headers:{cookie:viewer}})).json()).visits,3)
 assert.equal((await a.form({operation:'segment.save',siteId:id,name:'Mine',filters:'channel:is:Email'},viewer)).status,403)
 assert.ok((await (await a.request('/api/vane/audit',owner)).json()).some(e=>e.action==='segment.save'&&e.detail.includes('Organic mobile')))
 assert.equal((await a.form({operation:'segment.delete',siteId:id,id:segment},a.owner)).status,303);assert.equal((await a.request(`/api/vane/summary?siteId=${id}&segment=${segment}`,owner)).status,404)
})
test('INSTALL-007 a TanStack React Router app and a hash-routed one each record four views with their paths and no duplicates, and manual pageviews replace automatic ones',async t=>{
 const a=await withApp(t),id=await a.addSite({paths:[]})
 const {build}=await import('esbuild'),bundle=(await build({entryPoints:[new URL('./fixtures/spa-router.jsx',import.meta.url).pathname],bundle:true,write:false,format:'iife',jsx:'automatic',minify:true,define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'})).outputFiles[0].text.replaceAll('</script','<\\/script')
 const app=(hashed,attrs='')=>`<!doctype html><title>Fern app</title><div id="app"></div><script>${hashed?'window.FIXTURE_HASH=true;':''}${bundle}</script><script src="${a.origin}/vane.js" data-site="${id}"${attrs}></script>`
 const manual=`<!doctype html><title>Fern manual</title><script>window.vane=window.vane||function(){(vane.q=vane.q||[]).push(arguments)};vane('pageview')</script><script src="${a.origin}/vane.js" data-site="${id}" data-manual></script>`
 const {context}=await browse(t,a,{'https://fern.example/':app(false),'https://fern.example/app/':app(true,' data-hash'),'https://fern.example/manual':manual})
 const paths=async()=>(await a.dump()).vane_events.filter(e=>e.kind==='pageview').map(e=>e.path).sort()
 const collected=tab=>tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect'&&r.status()===202)
 const tour=async(url,expected)=>{const tab=await context.newPage(),first=collected(tab);await tab.goto(url);await first
  for(const to of ['/pricing','/docs','/about']){const sent=collected(tab);await tab.getByRole('link',{name:'Go '+to,exact:true}).click();await tab.getByRole('heading',{name:'View '+to}).waitFor();await sent}
  // Clicking the current view again and replacing its history entry are not new pageviews.
  await tab.getByRole('link',{name:'Go /about',exact:true}).click();await tab.evaluate(()=>history.pushState({},'',location.href));await tab.waitForTimeout(500)
  assert.deepEqual(await paths(),expected);await tab.close()}
 await tour('https://fern.example/',['/','/about','/docs','/pricing'])
 await tour('https://fern.example/app/',['/','/about','/app/','/app/about','/app/docs','/app/pricing','/docs','/pricing'])
 // Manual mode: the queued call and vane('pageview', {url}) are recorded; History API navigation is not.
 const tab=await context.newPage(),first=collected(tab);await tab.goto('https://fern.example/manual');await first
 const second=collected(tab);await tab.evaluate(()=>{history.pushState({},'','/manual/step-1');vane('pageview',{url:'/manual/step-2?utm_source=newsletter'})});await second;await tab.waitForTimeout(500)
 const rows=(await a.dump()).vane_events.filter(e=>e.kind==='pageview'&&e.path.startsWith('/manual'));assert.deepEqual(rows.map(e=>[e.path,e.utm_source]).sort(),[['/manual',null],['/manual/step-2','newsletter']])
 const settings=await (await a.request(`/app/sites/${id}?section=settings`,{headers:{cookie:a.owner}})).text();assert.ok(settings.includes('data-spa-help')&&settings.includes('data-hash')&&settings.includes('data-manual'))
})
test('CONV-002 Signup with plan=pro and plan=free through vane() and CSS classes breaks down by plan, an email property is refused, manual and attribute pageview properties break down by author, and a funnel step and a filter on plan=pro count only the pro signups',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],funnels:'pro=/ > event:Signup[plan=pro]',publicReports:['totals','sources','campaigns','pages','goals','devices']})
 const script=(attrs='')=>`<script src="${a.origin}/vane.js" data-site="${id}"${attrs}></script>`
 const pages={'https://fern.example/':`<!doctype html><title>Fern</title><button class="vane-event-name=Signup vane-event-plan=free">Free plan</button><form class="vane-event-name=Signup vane-event-plan=pro" action="/" onsubmit="return false"><button>Pro plan</button></form>${script()}`,
  'https://fern.example/post':`<!doctype html><title>Post</title><script>window.vane=window.vane||function(){(vane.q=vane.q||[]).push(arguments)};vane('pageview',{props:{author:'jo'}})</script>${script(' data-manual')}`,
  'https://fern.example/essay':`<!doctype html><title>Essay</title>${script(' data-prop-author="sam"')}`}
 const open=async(n,url)=>{const {context}=await browse(t,a,pages,{extraHTTPHeaders:{'cf-connecting-ip':'203.0.113.'+n}}),tab=await context.newPage(),loaded=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect'&&r.status()===202);await tab.goto(url);await loaded;return tab}
 const fired=async(tab,act)=>{const sent=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/custom');await act();assert.equal((await sent).status(),202)}
 // Pro and free, each once through a CSS class (a form and a button) and once through vane().
 const one=await open(1,'https://fern.example/');await fired(one,()=>one.getByRole('button',{name:'Pro plan'}).click())
 const two=await open(2,'https://fern.example/');await fired(two,()=>two.evaluate(()=>vane('Signup',{props:{plan:'free'}})))
 const three=await open(3,'https://fern.example/');await fired(three,()=>three.getByRole('button',{name:'Free plan'}).click())
 const four=await open(4,'https://fern.example/');await fired(four,()=>four.evaluate(()=>vane('Signup',{props:{plan:'pro'}})))
 await open(5,'https://fern.example/post');await open(6,'https://fern.example/essay')
 // Through the public door: an email address refuses the event, a phone number is dropped and counted.
 const pageId=(await a.dump()).vane_events.find(e=>e.kind==='pageview'&&e.path==='/').id.split(':')[1],custom=body=>a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId:id,page:pageId,consent:'not-required',...body},'',{origin:'https://fern.example'})
 assert.equal((await custom({name:'Signup',props:{plan:'pro',contact:'jo@example.com'}})).status,400);assert.equal((await custom({name:'jo@example.com'})).status,400)
 assert.equal((await custom({name:'Callback',props:{phone:'+1 (555) 123-4567'}})).status,202);assert.equal((await custom({name:'Signup',props:Object.fromEntries(Array.from({length:31},(_,i)=>['k'+i,'v']))})).status,400,'at most 30 properties')
 const day=(await a.dump()).vane_events[0].day,summary=async query=>(await a.request(`/api/vane/summary?siteId=${id}&from=${day}&to=${new Date(Date.parse(day)+86400000).toISOString().slice(0,10)}&${query}`,owner)).json(),all=await summary('')
 assert.deepEqual(all.customEvents.map(r=>[r.name,r.events,r.visitors]),[['Signup',4,4],['Callback',1,1]])
 assert.deepEqual(all.eventProps.map(r=>[r.name,r.key,r.value,r.events]),[['Signup','plan','free',2],['Signup','plan','pro',2]])
 assert.deepEqual(all.pageProps.map(r=>[r.key,r.value,r.pageviews]),[['author','jo',1],['author','sam',1]])
 assert.deepEqual(all.exclusions,[{reason:'dropped-property',count:1}]);assert.ok(!JSON.stringify(await a.dump()).includes('123-4567'),'the phone number is not stored')
 // The funnel step on Signup with plan=pro, and the DASH-007 filters, count only the pro signups.
 assert.deepEqual(all.funnels[0].steps.map(s=>s.visits),[4,2])
 for(const [filter,visits] of [['prop.plan:is:pro',2],['prop.plan:is_not:pro',4],['event:is:Signup',4],['prop.author:is:jo',1]])assert.equal((await summary('filter='+encodeURIComponent(filter))).visits,visits,filter)
 const html=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=${day}&to=${new Date(Date.parse(day)+86400000).toISOString().slice(0,10)}`,owner)).text())
 for(const row of ['<th scope="row">Signup</th><td class="vane-number">4</td>','<th scope="row">Signup</th><td>plan</td><td>pro</td><td class="vane-number">2</td>','<th scope="row">author</th><td>jo</td><td class="vane-number">1</td>','Dropped properties'])assert.ok(html.includes(row),row)
 assert.ok((await (await a.request('/api/vane/inventory?siteId='+id,owner)).json()).fields.some(f=>f.table==='vane_event_props'))
 const published=await (await a.request(`/stats/${id}?from=${day}&to=${new Date(Date.parse(day)+86400000).toISOString().slice(0,10)}`)).text();assert.ok(published.includes('/essay')&&!/Signup|Callback|Event properties|Page properties/.test(published),'public stats show no custom event or property')
})
test('CONV-006 USD and CAD purchases returning from Stripe Checkout total in USD at the owner-entered rate with credit to the original source, revenue joins the chart, comparisons, channel rows and roll-ups, unconverted revenue is listed apart, and the public page shows revenue only once the owner adds the revenue report',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{purchase:'/thanks',signup:'/signup'},rates:'CAD 0.73 from 2026-03-01',publicReports:['totals','pages','devices']}),oak=await a.addSite({name:'Oak Books',origin:'https://oak.example',paths:[]})
 const agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
 const google={source:undefined,campaign:undefined,referrer:'https://www.google.com/'},email={source:undefined,campaign:'spring',utm:{source:'newsletter',medium:'email'}},stripe={source:undefined,campaign:undefined,referrer:'https://checkout.stripe.com/c/pay/cs_test_a1'},inside={source:undefined,campaign:undefined}
 const load=async(n,at,first,path,site=id,origin='https://fern.example')=>{await a.clock(Date.parse(at));const event=a.event(site,{...first,path});assert.equal((await a.post('/api/vane/collect',event,'',{origin,'cf-connecting-ip':'203.0.113.'+n,'user-agent':agent})).status,202);return event.id}
 const pay=async(page,revenue,name='Purchase',site=id,origin='https://fern.example')=>{const r=await a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId:site,page,name,revenue,consent:'not-required'},'',{origin});assert.equal(r.status,202,await r.clone().text())}
 // The day before: one USD 20 purchase, for the comparison.
 await pay(await load(9,'2026-03-09T12:00:00Z',google,'/thanks'),{amount:20,currency:'USD'})
 // A Google visitor returns from Stripe Checkout after the visit timeout (a new visit) and pays USD 100; a newsletter
 // visitor returns within the visit and pays CAD 50 (CAD 0.73 from 1 March: USD 36.50); a Google visitor signs up and
 // donates EUR 10, which no rate converts; a fourth visitor buys nothing.
 await load(1,'2026-03-10T10:00:00Z',google,'/pricing');await pay(await load(1,'2026-03-10T10:40:00Z',stripe,'/thanks'),{amount:100,currency:'USD'})
 await load(2,'2026-03-10T11:00:00Z',email,'/pricing');await pay(await load(2,'2026-03-10T11:05:00Z',stripe,'/thanks'),{amount:50,currency:'cad'})
 await load(3,'2026-03-10T12:00:00Z',google,'/');await pay(await load(3,'2026-03-10T12:02:00Z',inside,'/signup'),{amount:10,currency:'EUR'},'Donate')
 await load(4,'2026-03-10T13:00:00Z',google,'/')
 await pay(await load(5,'2026-03-10T14:00:00Z',google,'/',oak,'https://oak.example'),{amount:5,currency:'USD'},'Purchase',oak,'https://oak.example')
 for(const revenue of [{amount:-1,currency:'USD'},{amount:5,currency:'XYZ'},{amount:5},{amount:5,currency:'USD',note:'x'}])assert.equal((await a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId:id,page:(await a.dump()).vane_events.find(e=>e.kind==='pageview').id.split(':')[1],name:'Purchase',revenue,consent:'not-required'},'',{origin:'https://fern.example'})).status,400,JSON.stringify(revenue))
 await a.clock(Date.parse('2026-03-10T20:00:00Z'))
 const summary=async query=>(await a.request(`/api/vane/summary?from=2026-03-10&to=2026-03-11&${query}`,owner)).json(),all=await summary('siteId='+id)
 assert.deepEqual([all.revenue.currency,all.revenue.total,all.revenue.orders,all.revenue.averageOrderValue,all.revenue.perVisitor,all.revenue.previous],['USD',136.5,2,68.25,34.13,20],'USD 100 + CAD 50 at 0.73; the compared day had USD 20')
 assert.deepEqual(all.revenue.unconverted,[{currency:'EUR',amount:10,orders:1}]);assert.deepEqual(all.revenue.rates.map(r=>[r.currency,r.rate,r.from]),[['CAD',0.73,'2026-03-01']])
 // Attribution: no Stripe source; the checkout returns keep Google and the newsletter.
 assert.ok(!JSON.stringify([all.sources,all.sourceVisits,all.referrers]).toLowerCase().includes('stripe'),'Stripe never takes credit')
 const pick=rows=>Object.fromEntries(rows.map(r=>[r.label??r.path,[r.visits,r.conversions,r.revenue]]))
 const purchase=await summary(`siteId=${id}&goal=purchase`),signup=await summary(`siteId=${id}&goal=signup`)
 assert.deepEqual(pick(purchase.channels),{'Organic Search':[4,1,100],Email:[1,1,36.5]});assert.deepEqual(pick(purchase.sourceVisits),{Google:[4,1,100],newsletter:[1,1,36.5]})
 assert.deepEqual(pick(signup.channels),{'Organic Search':[4,1,0],Email:[1,0,0]},'the signup visit carried only unconverted revenue');assert.deepEqual(pick(all.channels),{'Organic Search':[4,2,100],Email:[1,1,36.5]})
 assert.deepEqual([pick(purchase.entryPages)['/thanks'],pick(purchase.topPages)['/thanks'],purchase.devices.map(r=>[r.label,r.revenue,r.revenuePerVisitor])],[[1,1,100],[2,2,136.5],[['desktop',136.5,34.13]]])
 // DASH-002 and DASH-008: the revenue chart and its data table, with the compared day.
 const chart=await summary(`siteId=${id}&metric=revenue&interval=day`);assert.deepEqual([chart.series.map(b=>b.revenue),chart.previousSeries.map(b=>b.revenue)],[[136.5],[20]])
 const html=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=2026-03-10&to=2026-03-11&goal=purchase&metric=revenue&interval=day`,owner)).text())
 for(const text of ['data-revenue>$136.50','+$116.50 against $20.00','data-aov>$68.25','data-rpv>$34.13','Exchange rates (owner-entered)','1 CAD = 0.73 USD from 2026-03-01','€10.00 from 1 event','<td class="vane-number" data-metric="revenue">$136.50</td>','<th scope="row">Organic Search</th>','<td class="vane-number">$100.00</td><td class="vane-number">$33.33</td>','href="/methodology#revenue"'])assert.ok(html.includes(text),text)
 // DASH-010: a roll-up adds revenue as an exact sum.
 const created=await a.form({operation:'rollup.create',name:'Fern and Oak',[`site_${id}`]:'on',[`site_${oak}`]:'on'},a.owner),rollupId=created.headers.get('location').match(/^\/app\/rollups\/([\w-]+)\?/)[1]
 assert.equal((await summary('rollupId='+rollupId)).revenue.total,(await summary('siteId='+id)).revenue.total+(await summary('siteId='+oak)).revenue.total);assert.equal((await summary('rollupId='+rollupId)).revenue.total,141.5)
 const methodology=await (await a.request('/methodology')).text()
 for(const rule of ['id="revenue"','an exchange rate the owner entered','never fetched','Stripe Checkout: checkout.stripe.com','adds revenue as an exact sum'])assert.ok(methodology.includes(rule),rule)
 // SHARE-002: revenue is public only once the owner adds the revenue report; the other reports' rows stay bare.
 const publicPage=async()=>(await a.request(`/stats/${id}?from=2026-03-10&to=2026-03-11`)).text()
 let shared=await publicPage();assert.ok(shared.includes('<h2>Top pages</h2>'));for(const text of ['Revenue','$136.50','CA$50.00','0.73'])assert.equal(shared.includes(text),false,`no revenue by default: ${text}`)
 const proposal=await (await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:[],goals:{purchase:'/thanks',signup:'/signup'},consent:'not-required',sampleRate:100,retentionDays:90,rates:'CAD 0.73 from 2026-03-01',publicReports:['totals','pages','devices','revenue']}},a.owner)).json()
 assert.equal((await a.form({operation:'proposal.approve',id:proposal.id},a.owner)).status,303)
 shared=await publicPage()
 for(const text of ['data-revenue>$136.50','<li>$100.00 sent in USD by 1 event.</li>','<li>CA$50.00 sent in CAD by 1 event.</li>','<li>€10.00 sent in EUR by 1 event.</li>','Exchange rates (owner-entered)','1 CAD = 0.73 USD from 2026-03-01, entered by the owner; Vane never fetches a rate.','€10.00 from 1 event: no exchange rate for EUR is in effect','data-aov>$68.25'])assert.ok(shared.includes(text),text)
 assert.equal(shared.includes('Revenue per visitor</th>'),false,'page and device rows carry no revenue column')
})
test('CONV-007 a test purchase through the standard ecommerce events fills the ready-made ecommerce funnel and the product report with the product, quantity and revenue, and malformed or personal product lines are refused',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]})
 const page=title=>`<!doctype html><title>${title}</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`,pages=Object.fromEntries(['product','cart','thanks'].map(p=>[`https://fern.example/${p}`,page(p)]))
 const {context}=await browse(t,a,pages),visit=async(tab,url)=>{const loaded=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect'&&r.status()===202);await tab.goto(url);await loaded}
 const send=async(tab,name,items,currency='USD')=>{const sent=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/custom');await tab.evaluate(([n,i,c])=>vane(n,{items:i,currency:c}),[name,items,currency]);assert.equal((await sent).status(),202,name)}
 const tee=(quantity=1)=>({sku:'TEE-1',name:'Fern tee',category:'Shirts',quantity,price:25}),mug={sku:'MUG-1',name:'Fern mug',category:'Kitchen',quantity:1,price:12.5}
 // One shopper buys two tees and a mug across three page loads of one visit.
 const one=await context.newPage();await visit(one,'https://fern.example/product');await send(one,'Product view',[tee()]);await send(one,'Add to cart',[tee(2)])
 await visit(one,'https://fern.example/cart');await send(one,'Add to cart',[mug]);await send(one,'Begin checkout',[tee(2),mug]);await visit(one,'https://fern.example/thanks');await send(one,'Purchase',[tee(2),mug])
 // A second shopper (another network) views and adds one tee, then stops.
 const {context:other}=await browse(t,a,pages,{extraHTTPHeaders:{'cf-connecting-ip':'198.51.100.7'}}),two=await other.newPage();await visit(two,'https://fern.example/product');await send(two,'Product view',[tee()]);await send(two,'Add to cart',[tee()])
 // Through the public door: a euro purchase keeps its own currency, rounded to its minor units; malformed or personal lines are refused.
 const pageId=(await a.dump()).vane_events.find(e=>e.kind==='pageview'&&e.path==='/thanks').id.split(':')[1],custom=body=>a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId:id,page:pageId,consent:'not-required',...body},'',{origin:'https://fern.example'})
 assert.equal((await custom({name:'Purchase',items:[{...tee(),price:19.999}],currency:'eur'})).status,202)
 for(const [body,why] of [[{name:'Signup',items:[tee()],currency:'USD'},'only the standard events carry lines'],[{name:'Purchase',items:[{...tee(),name:'jo@example.com'}],currency:'USD'},'an email address refuses the event'],[{name:'Purchase',items:[tee(0)],currency:'USD'},'a quantity is at least 1'],[{name:'Purchase',items:[tee()],currency:'XYZ'},'an unknown currency'],[{name:'Purchase',items:[tee()]},'lines need a currency'],[{name:'Purchase',items:[{...tee(),email:'x'}],currency:'USD'},'only the declared line fields'],[{name:'Purchase',items:Array.from({length:51},tee),currency:'USD'},'at most 50 lines']])assert.equal((await custom(body)).status,400,why)
 assert.ok(!JSON.stringify(await a.dump()).includes('jo@example.com'),'the refused line is not stored')
 const day=(await a.dump()).vane_events[0].day,to=new Date(Date.parse(day)+86400000).toISOString().slice(0,10),summary=await (await a.request(`/api/vane/summary?siteId=${id}&from=${day}&to=${to}`,owner)).json()
 assert.deepEqual(summary.products.map(r=>[r.sku,r.currency,r.views,r.added,r.checkouts,r.purchased,r.revenue]),[['TEE-1','USD',2,3,2,2,50],['TEE-1','EUR',0,0,0,1,20],['MUG-1','USD',0,1,1,1,12.5]])
 const funnel=summary.funnels.find(f=>f.name==='Ecommerce');assert.deepEqual(funnel.steps.map(s=>[s.label,s.visits]),[['event:Product view',2],['event:Add to cart',2],['event:Begin checkout',1],['event:Purchase',1]])
 const html=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=${day}&to=${to}`,owner)).text())
 for(const row of ['<th scope="row">Fern tee</th><td>TEE-1</td><td>Shirts</td><td class="vane-number">2</td>','$50.00','€20.00','$12.50','data-funnel="Ecommerce"','<th scope="row">4. event:Purchase</th><td class="vane-number">1</td>'])assert.ok(html.includes(row),row)
 assert.ok((await (await a.request('/api/vane/inventory?siteId='+id,owner)).json()).fields.some(f=>f.table==='vane_ecommerce_lines'))
})
test('EXPERIMENT-001 a seeded 20% lift reaches significance with the expected interval once powered, a null test never does, a skewed exposure split triggers the mismatch warning, and the script applies and reports its variant',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/signup',demo:'/demo'},experiments:'lift = /pricing > signup : control, cheaper\nnull = /pricing > demo : a, b\nskew = /pricing > signup : left, right'})
 const agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
 const visit=async(i,path)=>{const event=a.event(id,{path,source:undefined,campaign:undefined}),r=await a.post('/api/vane/collect',event,'',{origin:'https://fern.example','cf-connecting-ip':`198.18.${i>>8}.${i&255}`,'user-agent':agent});assert.equal(r.status,202);return {page:event.id,body:await r.json()}}
 const expose=async(page,experiment)=>{const r=await a.post('/api/vane/exposure',{page,siteId:id,experiment,consent:'not-required'},'',{origin:'https://fern.example'});assert.equal(r.status,202,await r.clone().text());return (await r.json()).variant}
 const tests=async()=>Object.fromEntries((await (await a.request(`/api/vane/summary?siteId=${id}&period=today`,owner)).json()).experiments.map(x=>[x.name,x]))
 // Control converts 7 in 10 visitors (70%), cheaper 21 in 25 (84%: a 20% lift); the null test's arms both convert 7 in 10.
 // Visitors arrive eight at a time; the skew test loses 60% of its right-hand exposures.
 const arms={lift:{control:[],cheaper:[]},null:{a:[],b:[]}};let right=0
 const one=async i=>{
  const {page,body}=await visit(i,'/pricing'),v=body.experiments
  assert.equal(await expose(page,'lift'),v.lift,'the exposure door recomputes the assigned variant');await expose(page,'null')
  if(v.skew==='left'||right++%10<4)await expose(page,'skew')
  const k=arms.lift[v.lift].push(i)-1,m=arms.null[v.null].push(i)-1
  if(v.lift==='control'?k%10<7:k%25<21)await visit(i,'/signup')
  if(m%10<7)await visit(i,'/demo')
 }
 for(let b=0;b<360;b+=8){await Promise.all(Array.from({length:8},(_,j)=>one(b+j)));if(b===88){const early=await tests();assert.ok(early.lift.underpowered&&early.lift.variants[1].verdict==='underpowered','no result is called while underpowered')}}
 const r=await tests(),[control,cheaper]=r.lift.variants,n=[arms.lift.control.length,arms.lift.cheaper.length],c=[Math.floor(n[0]/10)*7+Math.min(n[0]%10,7),Math.floor(n[1]/25)*21+Math.min(n[1]%25,21)]
 assert.deepEqual([control.visitors,control.conversions,cheaper.visitors,cheaper.conversions],[n[0],c[0],n[1],c[1]])
 const z=1.959964,pc=c[0]/n[0],pv=c[1]/n[1],d=pv-pc,se=Math.sqrt(pc*(1-pc)/n[0]+pv*(1-pv)/n[1]),round=x=>Math.round(x*1e4)/1e4
 assert.deepEqual(cheaper.differenceInterval,[round(d-z*se),round(d+z*se)],'the difference interval');assert.ok(cheaper.differenceInterval[0]>0&&cheaper.differenceInterval[0]<0.14&&cheaper.differenceInterval[1]>0.14,'the interval holds the seeded 14-point lift')
 const den=1+z*z/n[0],mid=(pc+z*z/(2*n[0]))/den,half=z*Math.sqrt(pc*(1-pc)/n[0]+z*z/(4*n[0]*n[0]))/den;assert.deepEqual(control.interval,[round(mid-half),round(mid+half)],'the control’s Wilson interval')
 assert.equal(r.lift.underpowered,false);assert.equal(cheaper.verdict,'beats control');assert.ok(cheaper.probabilityBeatsControl>0.99)
 assert.equal(r.null.underpowered,false);assert.equal(r.null.variants[1].verdict,'no difference','the null test never reaches significance')
 assert.equal(r.skew.sampleRatioMismatch,true);assert.ok(r.skew.sampleRatioP<0.01)
 const html=await (await a.request(`/app/sites/${id}?section=report&period=today`,owner)).text()
 for(const text of ['data-experiment="lift"','data-variant="cheaper" data-verdict="beats control"','data-variant="b" data-verdict="no difference"','data-srm'])assert.ok(html.includes(text),text)
 // The script: vane('experiment', ...) calls back with the page load's variant after its pageview, and reports the exposure.
 const {context}=await browse(t,a,{'https://fern.example/pricing':`<!doctype html><title>Pricing</title><script>window.vane=window.vane||function(){(vane.q=vane.q||[]).push(arguments)};vane('experiment','lift',v=>{document.body.dataset.variant=v})</script><script src="${a.origin}/vane.js" data-site="${id}"></script>`}),tab=await context.newPage()
 const exposed=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/exposure');await tab.goto('https://fern.example/pricing');const response=await exposed
 assert.equal(response.status(),202);const page=JSON.parse(response.request().postData()).page,stored=(await a.dump()).vane_exposures.find(x=>x.page_id===id+':'+page&&x.experiment==='lift');assert.equal(await tab.evaluate(()=>document.body.dataset.variant),stored.variant,'the page shows the variant the server recorded')
 assert.equal((await a.post('/api/vane/exposure',{page:crypto.randomUUID(),siteId:id,experiment:'lift',consent:'not-required'},'',{origin:'https://fern.example'})).status,404)
 assert.equal((await a.post('/api/vane/exposure',{page:crypto.randomUUID(),siteId:id,experiment:'lift',variant:'cheaper',consent:'not-required'},'',{origin:'https://fern.example'})).status,400,'the variant is never taken from the request')
})
test('CONV-009 a click on #book-demo, a contact form, a visible pricing table and a docs pageview defined in the app, previewed against the live page and approved, arrive as custom events with no site code change',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]})
 const html=`<!doctype html><title>Fern</title><button id="book-demo" class="cta">Book a demo</button><form class="contact" action="/" onsubmit="return false"><button>Send</button></form><div style="height:3000px"></div><section id="pricing">Pricing</section><script src="${a.origin}/vane.js" data-site="${id}"></script>`
 a.fixtureSites['https://fern.example']=()=>new Response(html,{headers:{'content-type':'text/html'}})
 // Preview: the selector is run over the live page; nothing is stored, and only owners and administrators preview.
 const preview=await a.form({operation:'event.preview',siteId:id,selector:'#book-demo',path:'/'},a.owner),shown=await preview.text()
 assert.equal(preview.status,200);assert.ok(shown.includes('data-preview-total="1"')&&shown.includes('<code>&lt;button id="book-demo" class="cta"&gt;</code> Book a demo'),'the matched element is shown')
 assert.ok((await (await a.form({operation:'event.preview',siteId:id,selector:'.missing',path:'/'},a.owner)).text()).includes('data-preview-total="0"'))
 assert.equal((await a.form({operation:'event.preview',siteId:id,selector:'#x{}',path:'/'},a.owner)).status,400,'an invalid selector is refused')
 assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'all'},a.owner)).status,303);assert.equal((await a.form({operation:'event.preview',siteId:id,selector:'#book-demo',path:'/'},await a.accept('viewer@example.test'))).status,403)
 // Defined in the settings and applied only once the owner approves (APPROVE-001).
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:[],goals:{},consent:'not-required',eventDefinitions:'Book demo = click #book-demo\nLead = submit form.contact\nPricing seen = visible #pricing\nDocs = pageview /docs/**'}
 assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{...input,eventDefinitions:'Book demo = hover #book-demo'}},a.owner)).status,400)
 const proposed=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json(),config=async()=>(await a.request('/api/vane/config/'+id,{headers:{origin:'https://fern.example'}})).json()
 assert.deepEqual((await config()).eventDefinitions,[],'nothing is live before approval')
 assert.equal((await a.form({operation:'proposal.approve',id:proposed.id},a.owner)).status,303);assert.equal((await config()).eventDefinitions.length,4)
 // The live page, unchanged: each interaction arrives as its custom event.
 const {context}=await browse(t,a,{'https://fern.example/':html}),tab=await context.newPage(),names=[]
 tab.on('request',r=>{if(new URL(r.url()).pathname==='/api/vane/custom')names.push(JSON.parse(r.postData()).name)})
 const custom=()=>tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/custom'&&r.status()===202),loaded=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await tab.goto('https://fern.example/');await loaded
 for(const act of [()=>tab.getByRole('button',{name:'Book a demo'}).click(),()=>tab.getByRole('button',{name:'Send'}).click(),()=>tab.locator('#pricing').scrollIntoViewIfNeeded(),()=>tab.evaluate(()=>history.pushState({},'','/docs/intro'))]){const sent=custom();await act();await sent}
 // The pushState to /docs/intro is a new pageview, so the still-visible pricing table counts once more for it.
 for(let i=0;i<50&&names.length<5;i++)await tab.waitForTimeout(100);await tab.waitForTimeout(300);assert.deepEqual(names,['Book demo','Lead','Pricing seen','Docs','Pricing seen'])
 const day=(await a.dump()).vane_events[0].day,summary=await (await a.request(`/api/vane/summary?siteId=${id}&from=${day}&to=${new Date(Date.parse(day)+86400000).toISOString().slice(0,10)}`,owner)).json()
 assert.deepEqual(summary.customEvents.map(r=>[r.name,r.events]).sort(),[['Book demo',1],['Docs',1],['Lead',1],['Pricing seen',2]])
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes('Book demo = click #book-demo'))
})
