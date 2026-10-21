import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

// DASH-005 (ct ruling 20 Oct 2026 22:31Z): Vane ships no US metro-area names. Codes are Cloudflare's own example (635,
// Austin, Texas) and synthetic codes and places; names come only from a synthetic owner-approved table.
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()}
const austin={country:'US',region:'Texas',regionCode:'TX',city:'Austin',metroCode:'635'}
const range='from=2026-03-09&to=2026-03-16&compare=previous'
const metroFigures=rows=>rows.map(r=>[r.metro_code,r.metro_name,r.visitors,r.visits,r.conversions,r.conversionRate,r.previous])
const csvRows=text=>{const [head,...lines]=text.trim().split('\r\n'),columns=head.split(',');return lines.map(line=>Object.fromEntries(line.split(',').map((value,i)=>[columns[i],value])))}
// The site ZIP's files (stored or deflated entries), read from its central directory.
function unzip(buffer){const bytes=Buffer.from(buffer),files={};let end=bytes.length-22;while(bytes.readUInt32LE(end)!==0x06054b50)end--;let at=bytes.readUInt32LE(end+16)
 for(let n=bytes.readUInt16LE(end+10);n>0;n--){const method=bytes.readUInt16LE(at+10),size=bytes.readUInt32LE(at+20),nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),local=bytes.readUInt32LE(at+42),name=bytes.subarray(at+46,at+46+nameLength).toString()
  const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),data=bytes.subarray(start,start+size);files[name]=(method===8?inflateRawSync(data):data).toString();at+=46+nameLength+extra+comment}
 return files}
// A browser's multipart form post (a file upload), encoded here with its boundary.
async function multipart(a,body,headers){const encoded=new Response(body);return a.request('/app/action',{method:'POST',headers:{origin:a.origin,...headers,'content-type':encoded.headers.get('content-type')},body:Buffer.from(await encoded.arrayBuffer())})}
// Each visitor has its own address; cf carries Cloudflare's request geolocation at the Worker's fetch door (Miniflare
// fills an absent field with its own Austin example, so an absent value is sent as null).
function visitor(a,siteId){let n=0;return async(cf,at,paths=['/'])=>{const ip='198.51.100.'+(++n)
 for(const [i,path] of paths.entries()){await a.clock(at+i*20000);const response=await a.request('/api/vane/collect',{method:'POST',headers:{origin:'https://fern.example','content-type':'application/json','user-agent':'Synthetic Browser','cf-connecting-ip':ip},body:JSON.stringify(a.event(siteId,{path})),cf:{...cf,postalCode:'RAW_POSTAL_SENTINEL',latitude:'RAW_LATITUDE_SENTINEL',longitude:'RAW_LONGITUDE_SENTINEL',timezone:'RAW_TIMEZONE_SENTINEL'}});assert.equal(response.status,202,await response.clone().text())}}}

test('DASH-005 COLLECT-003 PRIVACY-003 US metro codes keyed on the code with unnamed labels and observed places across reports, segments, APIs, exports, public folding, live expiry and portable history',async t=>{
 let active=await installation();t.after(()=>active.close())
 const a=active,id=await a.addSite({paths:[],retainForever:true,publicReports:['locations']}),owner={headers:{cookie:a.owner}},visit=visitor(a,id)
 const prior=Date.parse('2026-03-03T15:00:00Z'),now=Date.parse('2026-03-10T15:00:00Z')
 for(let n=0;n<30;n++)await visit(austin,prior+n*60000)
 for(let n=0;n<12;n++)await visit(austin,now+n*60000,n<3?['/','/thanks']:['/'])
 for(let n=0;n<3;n++)await visit({country:'US',region:'Texas',city:'Marfa',metroCode:'999'},now+(20+n)*60000)
 // Metro 998: 5 visitors, the most (3) from Fixture Town, so a public page names only its region; 997 has no city.
 for(let n=0;n<5;n++)await visit({country:'US',region:'Texas',city:n<3?'Fixture Town':'Fixture Village',metroCode:'998'},now+(40+n)*60000)
 await visit({country:'US',region:'Texas',city:null,metroCode:'997'},now+46*60000)
 // US loads without exactly three ASCII digits keep no code; unknown edge countries discard every location field.
 for(const [n,metroCode] of [null,'6355'].entries())await visit({country:'US',region:'Texas',city:'Austin',metroCode},now+(50+n)*60000)
 for(const [n,country] of [undefined,'XX','T1'].entries())await visit({...austin,country},now+(30+n)*60000)
 await visit({country:'CA',region:'Ontario',city:'Toronto',metroCode:'635'},now+33*60000)
 const summary=extra=>a.request(`/api/vane/summary?siteId=${id}&${range}${extra??''}`,owner).then(json)
 const report=await summary('&goal=signup'),expected=[['635',null,12,12,3,25,30],['998',null,5,5,0,0,0],['999',null,3,3,0,0,0],[null,null,2,2,0,0,0],['997',null,1,1,0,0,0]]
 assert.deepEqual(metroFigures(report.metros),expected,'US loads only, keyed on the code, with the selected goal and the compared period')
 assert.ok(report.metros.filter(r=>r.metro_code).every(r=>r.label.includes(r.metro_code)&&r.metro_name===null),'an unnamed code is labelled by its code, never by a guessed name')
 assert.match(report.metros[3].label,/unknown metro area/i);assert.equal(report.visitors,27)
 const us=report.countries.find(r=>r.label==='United States')
 assert.equal(report.metros.reduce((sum,r)=>sum+r.visits,0),us.visits,'DASH-005: coded and Unknown metro rows sum to all US visits before public folding')
 assert.equal(report.metros.reduce((sum,r)=>sum+r.visitors,0),us.visitors,'DASH-005: no non-US or unknown-country visitor enters the US metro table')
 assert.equal(report.metros.find(r=>r.metro_code===null).visits,2,'DASH-005: both US loads without a valid metro code remain in the explicit Unknown metro row')
 assert.equal(report.countries.find(r=>r.label==='Unknown location')?.visitors,3,'loads without geolocation stay in the Unknown location row')
 assert.equal(Object.hasOwn(report,'metroPlaces'),false,'the observed place never leaves through the summary door')
 // Filters, saved segments and movers key on the code.
 const filtered=await summary('&filter=metro:is:635')
 assert.deepEqual([filtered.visitors,filtered.visits,filtered.goals,filtered.pageviews],[12,12,3,15])
 assert.equal((await summary('&filter=metro:is_not:635')).visitors,15)
 const saved=await a.form({operation:'segment.save',siteId:id,name:'Austin metro',filters:'metro:is:635'},a.owner);assert.equal(saved.status,303)
 const segment=new URL(saved.headers.get('location'),a.origin).searchParams.get('segment');assert.ok(segment)
 assert.deepEqual(metroFigures((await summary('&segment='+segment)).metros),[expected[0]])
 assert.ok(report.explain.movers.some(m=>m.dimension==='US metro area'&&m.label.includes('635')&&m.then===30&&m.now===12))
 // The signed-in report shows each unnamed code's observed place, region alone when no city is known, and counts them.
 const page=await (await a.request(`/app/sites/${id}?section=report&${range}&goal=signup`,owner)).text()
 const placeOf=code=>page.match(new RegExp(`metro%3Ais%3A${code}[^"]*" data-filter-link>[^<]*</a><br><span class="vane-help" data-metro-place>([^<]*)</span>`))?.[1]
 assert.match(placeOf('635'),/Austin, Texas$/);assert.match(placeOf('998'),/Fixture Town, Texas$/);assert.match(placeOf('997'),/: Texas$/);assert.match(page,/data-metro-unnamed>4 metro codes/)
 // The Stats API and MCP carry metro_code and metro_name (null when unnamed), with the dashboard's figures.
 const created=await a.form({operation:'apikey.create',kind:'stats',label:'Metro reporting',[`site_${id}`]:'on'},a.owner);assert.equal(created.status,200)
 const key=(await created.text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)?.[1];assert.ok(key)
 const statsQuery=`site_id=${id}&${range}&dimension=metro&metrics=visitors,visits,conversion_rate`
 const stats=await json(await a.request('/api/v1/stats?'+statsQuery,{headers:{authorization:'Bearer '+key}}))
 assert.deepEqual(metroFigures(stats.breakdown),metroFigures((await summary()).metros));assert.deepEqual(stats.breakdown.slice(0,3).map(r=>r.value),['635','998','999'])
 assert.equal(/Austin|Fixture Town|Most visitors/.test(JSON.stringify(stats)),false,'no observed place in an API answer')
 const scoped=await json(await a.request('/api/v1/stats?'+statsQuery+'&filter=metro:is:635',{headers:{authorization:'Bearer '+key}}));assert.equal(scoped.results.visitors,12)
 assert.equal((await a.request('/api/v1/stats?'+statsQuery)).status,401)
 const rpc=async(method,params,rid=1)=>json(await a.request('/api/v1/mcp',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:rid,method,params})}))
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'metro-journey',version:'1'}})
 const mcp=await rpc('tools/call',{name:'query_stats',arguments:{site_id:id,from:'2026-03-09',to:'2026-03-16',compare:'previous',dimension:'metro',metrics:['visitors','visits','conversion_rate']}},2)
 assert.equal(mcp.result.isError,false);assert.deepEqual(mcp.result.structuredContent,stats)
 // CSV and the site ZIP: an empty name and the dashboard's figures; the place is never exported.
 const csv=await a.request(`/api/vane/csv?siteId=${id}&${range}&table=metros&goal=signup`,owner);assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/text\/csv/)
 const exported=csvRows(await csv.text());assert.deepEqual(exported.map(r=>[r.metro_code,r.metro_name,Number(r.visitors),Number(r.conversions),Number(r.previous)]),expected.map(([code,,visitors,,conversions,,previous])=>[code??'','',visitors,conversions,previous]))
 const zipped=await a.request(`/api/vane/site-zip?siteId=${id}`,owner);assert.equal(zipped.status,200)
 const files=unzip(await zipped.arrayBuffer()),metroText=files[Object.keys(files).find(name=>name.startsWith('imported_metros_'))],metroFile=csvRows(metroText)
 assert.ok(metroFile.every(r=>r.metro_name===''),'unnamed codes export an empty name')
 const byCode=rows=>rows.reduce((m,r)=>({...m,[r.metro_code]:(m[r.metro_code]??0)+Number(r.visits)}),{})
 assert.deepEqual(byCode(metroFile.filter(r=>r.date>='2026-03-09')),byCode(exported),'the ZIP metros file equals the dashboard per code')
 assert.equal(/Most visitors|Austin|Fixture Town/.test(metroText),false,'the metros file never carries an observed place')
 // Public pages: the observed place shows, a city under 5 visitors is never named (its region only), small metros fold.
 const shared=await a.form({operation:'share.create',siteId:id,label:'Metro partners',share_locations:'on'},a.owner);assert.equal(shared.status,200)
 const link=(await shared.text()).match(/data-share-url>[^<]*(\/share\/vane_s_[0-9a-f]{64})</)?.[1];assert.ok(link)
 const sharedPath=link+'?'+range,publicPath='/stats/'+id+'?'+range
 for(const path of [sharedPath,publicPath]){
  const html=await (await a.request(path)).text()
  assert.match(html,/Metro 635[^<]*<br><span class="vane-help" data-metro-place>[^<]*Austin, Texas</);assert.match(html,/Metro 998[^<]*<br><span class="vane-help" data-metro-place>[^<]*: Texas</)
  assert.ok(html.includes('Other metro areas'));for(const hidden of ['Metro 999','Metro 997','Marfa','Fixture Town'])assert.equal(html.includes(hidden),false,hidden)
 }
 const unchosen=await a.form({operation:'share.create',siteId:id,label:'Totals only',share_totals:'on'},a.owner),bare=(await unchosen.text()).match(/data-share-url>[^<]*(\/share\/vane_s_[0-9a-f]{64})</)?.[1]
 const plain=await (await a.request(bare+'?'+range)).text();assert.equal(plain.includes('US metro areas')||plain.includes('Austin')||plain.includes('data-metro-place'),false,'no location without the chosen report')
 // Storage keeps the code only; nothing raw persists.
 const historicalDump=await a.dump(),events=historicalDump.vane_events
 assert.ok(events.every(e=>!Object.hasOwn(e,'metro_name')),'events never store a metro name')
 assert.deepEqual([...new Set(events.map(e=>e.metro_code))].sort(),['635','997','998','999',null])
 assert.ok(events.filter(e=>e.country!=='United States').every(e=>e.metro_code===null))
 const archive=await a.archive(),stored=JSON.stringify([historicalDump,archive])
 for(const raw of ['198.51.100.','RAW_POSTAL_SENTINEL','RAW_LATITUDE_SENTINEL','RAW_LONGITUDE_SENTINEL','RAW_TIMEZONE_SENTINEL','Most visitors'])assert.equal(stored.includes(raw),false,raw+' must not persist')

 const liveAt=Date.parse('2026-03-16T18:00:00Z');await visit(austin,liveAt)
 const realtime=()=>a.request('/api/vane/realtime?siteId='+id,owner).then(json)
 const liveRows=(await realtime()).metros;assert.deepEqual(liveRows.map(r=>[r.metro_code,r.metro_name,r.visitors,r.previous]),[['635',null,1,0]]);assert.ok(liveRows[0].label.includes('635'));assert.equal(Object.hasOwn(liveRows[0],'place'),false)
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 let browserOpen=true;t.after(()=>browserOpen?browser.close():undefined)
 const context=await browser.newContext()
 await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==a.origin)return route.abort()
  const response=await a.request(url.pathname+url.search,{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()??undefined})
  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})
 })
 const tab=await context.newPage(),screens=process.env.VANE_SCREEN_DIR
 if(screens)await mkdir(screens,{recursive:true})
 async function capture(path,label,locator,check){
  for(const width of [1440,390]){
   await tab.setViewportSize({width,height:960});await tab.goto(a.origin+path)
   const target=locator();await target.waitFor({state:'visible'});await target.scrollIntoViewIfNeeded()
   await check();assert.equal(await tab.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label+' at '+width)
   if(screens)await tab.screenshot({path:`${screens}/locations-${label}-${width}.png`})
  }
 }
 const metroTable=()=>tab.locator('table[data-locations="US metro areas"]')
 await capture(`/app/sites/${id}?section=report&${range}&goal=signup`,'report',metroTable,async()=>{
  const text=await metroTable().innerText();for(const part of ['635','998','999','997','Austin, Texas','Fixture Town, Texas'])assert.ok(text.includes(part),part);assert.match(text,/25\.0%/)
 })
 await capture(`/app/sites/${id}?section=report&${range}&segment=${segment}`,'segment',metroTable,async()=>{
  const text=await metroTable().innerText();assert.ok(text.includes('635'));assert.equal(text.includes('999'),false)
 })
 await capture(`/app/sites/${id}?section=realtime`,'realtime',()=>tab.locator('table[data-live="Live US metro areas"]'),async()=>{
  const table=tab.locator('table[data-live="Live US metro areas"]'),text=await table.innerText();assert.ok(text.includes('635')&&text.includes('Austin, Texas'));assert.equal(await table.locator('[data-visitors]').innerText(),'1')
 })
 await capture(`/app/sites/${id}?section=settings`,'settings',()=>tab.locator('#metro-names'),async()=>{const text=await tab.locator('#metro-names').innerText();for(const code of ['635','997','998','999'])assert.ok(text.includes(code),code);assert.ok((await tab.locator('body').innerText()).includes('metro_code'))})
 await capture(`/app/sites/${id}?section=settings`,'exclusions',()=>tab.locator('#exclude-countries-help'),async()=>{assert.ok((await tab.locator('#exclude-countries-help').innerText()).includes('admitted loads keep the location names'))})
 // Public journeys run with an empty cookie jar.
 await context.clearCookies()
 for(const [path,label] of [[sharedPath,'shared'],[publicPath,'public']])await capture(path,label,metroTable,async()=>{
  const text=await metroTable().innerText();assert.ok(text.includes('635')&&text.includes('Austin, Texas'));assert.ok(text.includes('Other metro areas'));assert.equal(text.includes('999'),false)
  const totals=await metroTable().locator('tbody tr').evaluateAll(rows=>rows.reduce((sum,row)=>{const cells=row.querySelectorAll('td');return [sum[0]+Number(cells[0].textContent),sum[1]+Number(cells[1].textContent)]},[0,0]))
  assert.deepEqual(totals,[us.visitors,us.visits],'DASH-005: public folding preserves all US totals, including the Unknown metro row')
  assert.equal(/Marfa|Fixture Town/.test(await tab.locator('body').innerText()),false)
 })
 await capture('/methodology','methodology',()=>tab.getByRole('heading',{name:'Location',exact:true}),async()=>{
  const body=await tab.locator('body').innerText();assert.ok(body.includes('Nielsen'));assert.ok(body.includes('ships no metro names'))
 })
 await a.clock(liveAt+5*60000+1000);assert.deepEqual((await realtime()).metros,[])
 await browser.close();browserOpen=false

 // Restore the historical archive into a second installation after disposing the first Worker.
 await a.close();active=await installation()
 const b=active
 assert.equal((await b.post('/api/vane/restore',{archive},b.owner)).status,200)
 const restored=await json(await b.request(`/api/vane/summary?siteId=${id}&${range}&goal=signup`,{headers:{cookie:b.owner}}))
 assert.deepEqual(metroFigures(restored.metros),expected)
 assert.deepEqual((await b.archive()).payload.tables.vane_events,archive.payload.tables.vane_events)
 const prepared=await b.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},b.owner)
 assert.equal(prepared.status,201)
 const proposal=await prepared.json()
 assert.equal((await b.form({operation:'proposal.approve',id:proposal.id},b.owner)).status,303)
 assert.deepEqual((await json(await b.request(`/api/vane/summary?siteId=${id}&${range}`,{headers:{cookie:b.owner}}))).metros,[])
 assert.equal((await b.archive()).payload.tables.vane_events.length,0)
})

test('DASH-005 APPROVE-001 AUDIT-001 ARCHIVE-001 the owner-approved metro-name table: an administrator uploads, the owner approves, names reach every surface and public pages only when chosen, refusals change nothing, and clear, erasure, archive and transfer keep the rules',async t=>{
 let a=await installation();const opened=[a];t.after(()=>Promise.all(opened.map(app=>app.close())))
 const id=await a.addSite({paths:[],publicReports:['locations']}),owner={headers:{cookie:a.owner}},visit=visitor(a,id),day=Date.parse('2026-03-10T15:00:00Z')
 for(let n=0;n<6;n++)await visit(austin,day+n*60000)
 for(let n=0;n<2;n++)await visit({country:'US',region:'Texas',city:'Marfa',metroCode:'999'},day+(10+n)*60000)
 const admin=await a.invite('admin@example.test','admin')
 assert.equal((await a.form({operation:'team.invite',email:'analyst@example.test',role:'analyst',scope:'selected',['site_'+id]:'on'},a.owner)).status,303);const analyst=await a.accept('analyst@example.test')
 assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'selected',['site_'+id]:'on'},a.owner)).status,303);const viewer=await a.accept('viewer@example.test')
 const upload=(cookie,{csv='metro_code,metro_name\r\n635,Fixture Metro A\r\n997,"Fixture Metro, C"\r\n',file=true,label='Fixture licence 2026',statement=true,shown=false,extra={}}={})=>{
  const body=new FormData();body.set('operation','metro.prepare');body.set('siteId',id)
  if(file)body.set('metroNames',new Blob([csv],{type:'text/csv'}),'metros.csv');if(label!==null)body.set('label',label);if(statement)body.set('statement','on');if(shown)body.set('public','on')
  for(const [k,v] of Object.entries(extra))body.set(k,v)
  return multipart(a,body,{cookie})}
 const state=async()=>{const d=await a.dump();return JSON.stringify([d.vane_metro_names,d.vane_metro_tables,d.vane_proposals.filter(p=>p.command==='metro.names').map(p=>[p.id,p.state])])}
 const summary=()=>a.request(`/api/vane/summary?siteId=${id}&from=2026-03-09&to=2026-03-16`,owner).then(json)
 const metro=(rows,code)=>rows.find(r=>r.metro_code===code)
 // A5: every refusal changes nothing.
 const before=await state(),egress=a.egress.length
 for(const [cookie,status] of [[viewer,403],[analyst,403]])assert.equal((await upload(cookie)).status,status)
 const stats=(await (await a.form({operation:'apikey.create',kind:'stats',label:'Reader',[`site_${id}`]:'on'},a.owner)).text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1]
 const provisioning=(await (await a.form({operation:'apikey.create',kind:'provisioning',label:'Agency'},a.owner)).text()).match(/data-api-key>(vane_p_[0-9a-f]{64})</)[1]
 for(const key of [stats,provisioning]){
  const body=new FormData();body.set('operation','metro.prepare');body.set('siteId',id);body.set('metroNames',new Blob(['metro_code,metro_name\n635,Fixture Metro A\n']),'m.csv');body.set('label','x');body.set('statement','on')
  assert.equal((await multipart(a,body,{authorization:'Bearer '+key})).status,401)
  assert.ok([401,403,404].includes((await a.request(`/api/v1/sites/${id}/metro-names`,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'text/csv'},body:'metro_code,metro_name\n635,Fixture Metro A\n'})).status))
 }
 assert.equal((await a.post('/api/vane/commands',{command:'metro.names',input:{siteId:id,names:[['635','Fixture Metro A']]}},a.owner)).status,403,'the agent command API cannot prepare names')
 const fromUrl=await upload(a.owner,{file:false,extra:{url:'https://names.fixture.example/metros.csv'}});assert.equal(fromUrl.status,400);assert.equal(a.egress.length,egress,'nothing is fetched')
 const many=n=>'metro_code,metro_name\n'+Array.from({length:n},(_,i)=>`${String(i%1000).padStart(3,'0')},Fixture ${i}`).join('\n')
 for(const [csv,why] of [['metro_code,metro_name\n63,Fixture','two digits'],['metro_code,metro_name\n6355,Fixture','four digits'],['metro_code,metro_name\n6a5,Fixture','a letter'],['metro_code,metro_name\n635,Fixture A\n635,Fixture B','a duplicate code'],
  ['metro_code,metro_name\n635,   ','an empty name'],['metro_code,metro_name\n635,'+'x'.repeat(101),'an overlong name'],...['=','+','-','@'].map(c=>[`metro_code,metro_name\n635,${c}SUM(A1)`,'a formula '+c]),['metro_code,metro_name\n635,Fixture\u0007Metro','a control character'],
  ['code,name\n635,Fixture','wrong columns'],['metro_code,metro_name,extra\n635,Fixture,x','an extra column'],['metro_code\n635','a missing column'],[many(1001),'over 1,000 rows'],['metro_code,metro_name\n635,Fixture\n'+'#'.repeat(262200),'over 256 KB']]){
  const r=await upload(a.owner,{csv});assert.equal(r.status,400,why)
 }
 assert.match(await (await upload(a.owner,{csv:'metro_code,metro_name\n635,Fixture A\n63,Fixture B\n999,@x'})).text(),/row 2[^;]*;[^;]*row 3/,'the refusal names its rows')
 for(const missing of [{label:null},{label:'   '},{statement:false}])assert.equal((await upload(a.owner,missing)).status,400,JSON.stringify(missing))
 assert.equal(await state(),before,'no refusal prepared, stored or approved anything')
 // A4: an administrator uploads; the change waits, with its preview, until the owner approves.
 const events=JSON.stringify((await a.dump()).vane_events)
 assert.equal((await upload(admin)).status,303)
 const pending=(await json(await a.request('/api/vane/proposals',owner))).find(p=>p.command==='metro.names'&&p.state==='pending')
 const preview=JSON.parse(pending.payload_json).preview
 assert.deepEqual([preview.rows,preview.added.map(r=>r.code),preview.seenNamed,preview.seenUnnamed,preview.neverSeen],[2,['635','997'],['635'],['999'],['997']])
 assert.match(await (await a.request('/app?section=approvals',owner)).text(),/data-metro-preview>[\s\S]*Fixture Metro, C/)
 assert.equal(metro((await summary()).metros,'635').metro_name,null,'nothing is named before approval')
 assert.equal((await a.form({operation:'proposal.approve',id:pending.id},admin)).status,403,'only the owner approves')
 assert.equal((await a.form({operation:'proposal.approve',id:pending.id},a.owner)).status,303)
 // Every signed-in surface, export and API answer names 635 now, 999 stays unnamed, and event rows are unchanged.
 const r=await summary();assert.deepEqual([metro(r.metros,'635').metro_name,metro(r.metros,'635').label,metro(r.metros,'999').metro_name],['Fixture Metro A','Fixture Metro A',null])
 assert.equal(JSON.stringify((await a.dump()).vane_events),events,'approval rewrites no event')
 assert.ok(r.explain.movers.some(m=>m.dimension==='US metro area'&&m.label==='Fixture Metro A'&&m.now===6&&m.then===0),'the explanation names the mover')
 const page=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-09&to=2026-03-16`,owner)).text()
 assert.ok(page.includes('>Fixture Metro A</a>'));assert.match(page,/data-metro-attribution>[^<]*Fixture licence 2026/);assert.match(page,/data-metro-unnamed>1 metro code/)
 const csv=csvRows(await (await a.request(`/api/vane/csv?siteId=${id}&from=2026-03-09&to=2026-03-16&table=metros`,owner)).text());assert.deepEqual(csv.map(row=>[row.metro_code,row.metro_name]),[['635','Fixture Metro A'],['999','']])
 const api=await json(await a.request(`/api/v1/stats?site_id=${id}&from=2026-03-09&to=2026-03-16&dimension=metro`,{headers:{authorization:'Bearer '+stats}}));assert.deepEqual(api.breakdown.map(row=>[row.value,row.metro_code,row.metro_name]),[['635','635','Fixture Metro A'],['999','999',null]])
 const mcp=async(method,params,rid)=>json(await a.request('/api/v1/mcp',{method:'POST',headers:{authorization:'Bearer '+stats,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:rid,method,params})}))
 await mcp('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'metro-names',version:'1'}},1)
 assert.deepEqual((await mcp('tools/call',{name:'query_stats',arguments:{site_id:id,from:'2026-03-09',to:'2026-03-16',dimension:'metro'}},2)).result.structuredContent.breakdown.map(row=>[row.metro_code,row.metro_name]),[['635','Fixture Metro A'],['999',null]])
 const zip=unzip(await (await a.request(`/api/vane/site-zip?siteId=${id}`,owner)).arrayBuffer()),metros=csvRows(zip[Object.keys(zip).find(name=>name.startsWith('imported_metros_'))]);assert.deepEqual(metros.map(row=>[row.metro_code,row.metro_name]),[['635','Fixture Metro A'],['999','']])
 await visit(austin,day+30*60000);const live=await json(await a.request('/api/vane/realtime?siteId='+id,owner));assert.deepEqual(live.metros.map(row=>[row.label,row.metro_code,row.metro_name,row.visitors]),[['Fixture Metro A','635','Fixture Metro A',1]])
 // The warehouse export names the code at export time, empty when unnamed; its schema lists both columns.
 const objects={};a.fixtureSites['https://acct.r2.fixture.example']=async request=>{objects[new URL(request.url).pathname]=await request.text();return new Response(null,{status:200})}
 await a.clock(Date.parse('2026-03-11T00:30:00Z'))
 assert.equal((await a.form({operation:'export.save',siteId:id,endpoint:'https://acct.r2.fixture.example',bucket:'vane-export',region:'auto',prefix:'analytics',accessKeyId:'FIXTUREKEY0001',secretAccessKey:'fixture-secret',from:'2026-03-10'},a.owner)).status,303)
 await a.clock(Date.parse('2026-03-11T01:00:00Z'));await a.scheduled()
 const warehouse=csvRows(objects[`/vane-export/analytics/vane/${id}/events/2026-03-10.csv`]);assert.deepEqual([...new Set(warehouse.map(row=>`${row.metro_code}:${row.metro_name}`))].sort(),['635:Fixture Metro A','999:'])
 const schema=(await json(await a.request('/api/v1/export-schema.json'))).objects.events.columns.map(c=>c.name);assert.ok(schema.includes('metro_code')&&schema.includes('metro_name'))
 // Public pages keep codes unnamed until the owner approves public names; then the footnote names the source.
 const publicPath=`/stats/${id}?from=2026-03-09&to=2026-03-16`
 const hiddenNames=await (await a.request(publicPath)).text();assert.equal(hiddenNames.includes('Fixture Metro A'),false);assert.match(hiddenNames,/Metro 635[^<]*<br><span class="vane-help" data-metro-place>[^<]*Austin, Texas</)
 // PRIVACY-001 lists the table as a site setting with no visitor data; METRIC-004 carries the source statement and notice.
 const inventory=await json(await a.request('/api/vane/inventory?siteId='+id,owner));assert.deepEqual(inventory.fields.find(f=>f.name==='Location').columns,['country','region','city','metro_code'])
 assert.ok(inventory.fields.some(f=>f.table==='vane_metro_names'&&/no visitor data/.test(f.description)))
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['Nielsen DMA® codes from Cloudflare','ships no metro names','not affiliated with or endorsed by Nielsen'])assert.ok(methodology.includes(phrase),phrase)
 const audit=(await a.dump()).vane_audit.filter(e=>e.action==='metro.names');assert.equal(audit.length,1);assert.match(audit[0].detail,/2 names from Fixture licence 2026; shared and public pages off/)
 const settings=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text();assert.match(settings,/data-metro-table>[\s\S]*Fixture licence 2026[\s\S]* by Site owner<\/dd>[\s\S]*<dd>2<\/dd>[\s\S]*Show codes only[\s\S]*data-unnamed-codes>999</,'the settings page shows the source, approver, rows, public choice and unnamed codes seen')
 const stale=await upload(admin,{shown:true}),next=await upload(a.owner,{shown:true});assert.equal(stale.status,303);assert.equal(next.status,303)
 const [first,second]=(await json(await a.request('/api/vane/proposals',owner))).filter(p=>p.command==='metro.names'&&p.state==='pending').reverse()
 assert.equal((await a.form({operation:'proposal.approve',id:first.id},a.owner)).status,303);assert.equal((await a.form({operation:'proposal.approve',id:second.id},a.owner)).status,409,'a table prepared before another approval is stale')
 const shownNames=await (await a.request(publicPath)).text();assert.ok(shownNames.includes('>Fixture Metro A<'));assert.match(shownNames,/data-metro-attribution>[^<]*Fixture licence 2026, supplied by the site owner/)
 // A6 and ARCHIVE-001: erasure leaves the table; the archive and a site transfer carry it; clearing reverts to unnamed.
 const archive=await a.archive(),site=await json(await a.request(`/api/vane/export?siteId=${id}`,owner))
 const erase=await (await a.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:erase.id},a.owner)).status,303)
 assert.deepEqual((await a.dump()).vane_metro_names.map(row=>row.metro_code),['635','997'],'erasure leaves the site setting alone')
 assert.equal((await upload(admin,{file:false,extra:{operation:'metro.clear'}})).status,303)
 const clear=(await json(await a.request('/api/vane/proposals',owner))).find(p=>p.command==='metro.names'&&p.state==='pending');assert.equal((await a.form({operation:'proposal.approve',id:clear.id},a.owner)).status,303)
 assert.deepEqual((await a.dump()).vane_metro_names,[]);assert.match(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text(),/data-metro-table><dt>Source<\/dt><dd>No table approved/)
 const b=await installation();opened.push(b);assert.equal((await b.post('/api/vane/restore',{archive},b.owner)).status,200)
 const restored=await json(await b.request(`/api/vane/summary?siteId=${id}&from=2026-03-09&to=2026-03-16`,{headers:{cookie:b.owner}}));assert.equal(metro(restored.metros,'635').metro_name,'Fixture Metro A')
 assert.match(await (await b.request(`/stats/${id}?from=2026-03-09&to=2026-03-16`)).text(),/>Fixture Metro A</,'the public choice is restored with the table')
 const c=await installation();opened.push(c);assert.equal((await c.post('/api/vane/site-import',{archive:site},c.owner)).status,201)
 assert.equal(metro((await json(await c.request(`/api/vane/summary?siteId=${id}&from=2026-03-09&to=2026-03-16`,{headers:{cookie:c.owner}}))).metros,'635').metro_name,'Fixture Metro A','a site transfer carries the table')
})
