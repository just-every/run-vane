import test from 'node:test'
import { assert, readFile, createHash, createHmac, crc32, createRequire, installation, appsScript, fixture, unlinked, withApp, DESKTOP_CHROME, browse, movein } from './vane-helpers.mjs'

test('TEAM-001 an analyst invited to one site and a viewer invited to two act only within their role and sites at every door, removal ends access at once, and ownership moves only on the owner\'s confirmation',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 const A=await a.addSite(),B=await a.addSite({name:'Oak Store',origin:'https://oak.example'}),C=await a.addSite({name:'Elm Clinic',origin:'https://elm.example'})
 a.fixtureSites['https://fern.example']=()=>new Response('<button id="book-demo">Book a demo</button>',{headers:{'content-type':'text/html'}})
 // The owner invites by email with a role and chosen sites; Base sends the invitation and the person accepts it.
 const join=async(email,role,sites)=>{const r=await a.form({operation:'team.invite',email,role,scope:sites?'chosen':'all',...Object.fromEntries((sites??[]).map(id=>['site_'+id,'on']))},a.owner);assert.equal(r.status,303,await r.clone().text());return a.accept(email)}
 const analyst=await join('analyst@example.test','analyst',[A]),viewer=await join('viewer@example.test','viewer',[A,B]),admin=await join('admin@example.test','admin')
 const team=await (await a.request('/app?section=team',owner)).text()
 assert.match(team,/data-person="analyst@example.test">[\s\S]*?>analyst<\/span>[\s\S]*?<td>Fern Studio<\/td>/);assert.match(team,/data-person="viewer@example.test">[\s\S]*?>viewer<\/span>[\s\S]*?<td>Fern Studio, Oak Store<\/td>/)
 // Objects on every site for the delete and revoke doors.
 const shared=await a.form({operation:'share.create',siteId:A,label:'Board',share_totals:'on'},a.owner);assert.equal(shared.status,200)
 const shareId=(await a.dump()).vane_share_links[0].id
 assert.equal((await a.form({operation:'segment.save',siteId:C,name:'Email',filters:'channel:is:Email'},a.owner)).status,303)
 assert.equal((await a.form({operation:'annotation.add',siteId:C,day:new Date().toISOString().slice(0,10),text:'Owner note'},a.owner)).status,303)
 const state0=await a.dump(),segmentC=state0.vane_segments[0].id,noteC=state0.vane_annotations[0].id
 const pending=await (await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:B,name:'Oak Store',origin:'https://oak.example',paths:['/'],goals:{},consent:'required'}},a.owner)).json()
 const rollAll=await a.form({operation:'rollup.create',name:'Every site',[`site_${A}`]:'on',[`site_${B}`]:'on',[`site_${C}`]:'on'},a.owner),rollTwo=await a.form({operation:'rollup.create',name:'Two sites',[`site_${A}`]:'on',[`site_${B}`]:'on'},a.owner)
 const rollAllId=rollAll.headers.get('location').match(/rollups\/([\w-]+)/)[1],rollTwoId=rollTwo.headers.get('location').match(/rollups\/([\w-]+)/)[1]
 const operators=await (await a.request('/auth/operators',owner)).json(),list=Array.isArray(operators)?operators:operators.operators,id=email=>list.find(p=>p.email===email).id
 // Reads: each person sees only their sites in every list and read door; every other site's door answers 403.
 const sitesOf=async cookie=>(await (await a.request('/api/vane/sites',{headers:{cookie}})).json()).map(s=>s.id).sort()
 assert.deepEqual(await sitesOf(analyst),[A]);assert.deepEqual(await sitesOf(viewer),[A,B].sort())
 const reads=site=>[`/api/vane/summary?siteId=${site}`,`/api/vane/realtime?siteId=${site}`,`/api/vane/inventory?siteId=${site}`,`/app/sites/${site}`,`/app/sites/${site}?section=settings`]
 for(const [cookie,open,closed] of [[analyst,[A],[B,C]],[viewer,[A,B],[C]]]) {
  for(const site of open)for(const path of reads(site))assert.equal((await a.request(path,{headers:{cookie}})).status,200,path)
  for(const site of closed)for(const path of [...reads(site),`/api/vane/import-journal?siteId=${site}&jobId=x`])assert.equal((await a.request(path,{headers:{cookie}})).status,403,path)
  const home=await (await a.request('/app',{headers:{cookie}})).text();assert.ok(!home.includes('Elm Clinic'),'out-of-scope sites are not listed')
  for(const path of ['/api/vane/audit','/api/vane/proposals','/api/vane/export',`/api/vane/export?siteId=${open[0]}`,'/app?section=team','/app?section=audit',`/app/rollups/${rollAllId}`,`/api/vane/summary?rollupId=${rollAllId}`])assert.equal((await a.request(path,{headers:{cookie}})).status,403,path)
 }
 assert.equal((await a.request(`/app/rollups/${rollTwoId}`,{headers:{cookie:viewer}})).status,200)
 // Writes: every out-of-role or out-of-scope call through its public door is refused with no write.
 const writable=dump=>Object.fromEntries(Object.entries(dump).filter(([name])=>name.startsWith('vane_')||name==='oa_operators'))
 const archive=JSON.stringify({payload:{format:'vane-history/1',tables:{}},sha256:'0'})
 const forms=site=>[
  {operation:'site.prepare',name:'New',origin:'https://new.example',paths:'/',consent:'required',sampleRate:'100'},{operation:'config.prepare',siteId:site,name:'X',origin:'https://x.example',paths:'/',consent:'required'},
  {operation:'site.delete.prepare',siteId:site},{operation:'history.erase.prepare',siteId:site},{operation:'site.import',archive},{operation:'proposal.approve',id:pending.id},{operation:'proposal.reject',id:pending.id},
  {operation:'history.restore',archive},{operation:'import.preview',siteId:site,document:JSON.stringify(fixture)},{operation:'import.apply',siteId:site,document:JSON.stringify(fixture),fingerprint:'x'},{operation:'import.undo',siteId:site,jobId:'x'},
  {operation:'install.verify',siteId:site},{operation:'history.retention',siteId:site},{operation:'annotation-hook.create',siteId:site},{operation:'annotation-hook.revoke',siteId:site},{operation:'annotation-github.create',siteId:site},{operation:'annotation-github.revoke',siteId:site},
  {operation:'share.create',siteId:site,label:'Mine',share_totals:'on'},{operation:'share.revoke',id:shareId},{operation:'segment.delete',id:segmentC},{operation:'annotation.delete',id:noteC},
  {operation:'rollup.create',name:'Mine',[`site_${A}`]:'on',[`site_${B}`]:'on'},{operation:'team.invite',email:'new@example.test',role:'viewer',scope:'chosen',[`site_${A}`]:'on'},{operation:'team.grant',operatorId:id('viewer@example.test'),role:'analyst',scope:'chosen',[`site_${A}`]:'on'},
  {operation:'team.remove',operatorId:id('viewer@example.test')},{operation:'team.transfer',operatorId:id('admin@example.test'),confirm:'admin@example.test'}]
 const apis=site=>[['/api/vane/commands',{command:'site.create',input:{name:'New',origin:'https://new.example',paths:['/'],goals:{},consent:'required'}}],['/api/vane/commands',{command:'history.erase',input:{siteId:site}}],['/api/vane/commands',{command:'site.delete',input:{siteId:site}}],
  ['/api/vane/import-preview',{siteId:site,document:fixture}],['/api/vane/import-apply',{siteId:site,document:fixture,fingerprint:'x'}],['/api/vane/import-undo',{siteId:site,jobId:'x'}],['/api/vane/install-check',{siteId:site}],['/api/vane/site-import',{archive:JSON.parse(archive)}],['/api/vane/restore',{archive:JSON.parse(archive)}]]
 const scoped=site=>[{operation:'segment.save',siteId:site,name:'Mine',filters:'channel:is:Email'},{operation:'event.preview',siteId:site,selector:'#book-demo',path:'/'},{operation:'annotation.add',siteId:site,day:new Date().toISOString().slice(0,10),text:'Out of scope'},{operation:'config.prepare',siteId:site,eventDefinitions:'book-demo = click #book-demo'}]
 const before=writable(await a.dump())
 for(const [who,cookie,inSite,outSite] of [['analyst',analyst,A,C],['viewer',viewer,B,C]]) {
  for(const body of [...forms(inSite).filter(b=>who==='viewer'||b.operation!=='config.prepare'),...forms(outSite),...scoped(outSite),...(who==='viewer'?scoped(inSite).filter(b=>b.operation!=='annotation.add'):[])])assert.equal((await a.form(body,cookie)).status,403,`${who} ${body.operation} ${body.siteId===outSite?'out of scope':'out of role'}`)
  for(const [path,body] of [...apis(inSite),...apis(outSite),['/api/vane/commands',{command:'site.configure',input:{siteId:outSite,goals:{}}}]])assert.equal((await a.post(path,body,cookie)).status,403,`${who} ${path} ${body.command??''}`)
  if(who==='viewer')assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:inSite,goals:{}}},cookie)).status,403)
 }
 assert.deepEqual(writable(await a.dump()),before,'no refused call wrote anything')
 // In role: the analyst saves a segment (DASH-007), previews and prepares a no-code event (CONV-009) and adds a note; the viewer adds a note (DASH-009).
 assert.equal((await a.form({operation:'segment.save',siteId:A,name:'Email visits',filters:'channel:is:Email'},analyst)).status,303)
 assert.equal((await a.form({operation:'event.preview',siteId:A,selector:'#book-demo',path:'/'},analyst)).status,200)
 assert.equal((await a.form({operation:'config.prepare',siteId:A,name:'Renamed',origin:'https://evil.example',consent:'required',goals:'signup=/thanks',eventDefinitions:'book-demo = click #book-demo'},analyst)).status,303)
 for(const cookie of [analyst,viewer])assert.equal((await a.form({operation:'annotation.add',siteId:A,day:new Date().toISOString().slice(0,10),text:'Team note'},cookie)).status,303)
 // The analyst's proposal carries only the event definition; the site's name, origin and consent stay as they are until the owner approves.
 const proposal=(await (await a.request('/api/vane/proposals',owner)).json()).find(p=>p.prepared_by===id('analyst@example.test')),payload=JSON.parse(proposal.payload_json),current=(await (await a.request('/api/vane/sites',owner)).json()).find(s=>s.id===A)
 assert.equal(payload.name,'Fern Studio');assert.equal(payload.origin,'https://fern.example');assert.equal(payload.config.consent,current.config.consent);assert.deepEqual(payload.config.eventDefinitions,[{name:'book-demo',kind:'click',target:'#book-demo'}])
 assert.equal((await a.form({operation:'proposal.approve',id:proposal.id},a.owner)).status,303)
 // A change of sites applies at once; removal ends the person's sessions at once.
 assert.equal((await a.form({operation:'team.grant',operatorId:id('viewer@example.test'),role:'viewer',scope:'chosen',[`site_${B}`]:'on'},a.owner)).status,303)
 assert.equal((await a.request(`/api/vane/summary?siteId=${A}`,{headers:{cookie:viewer}})).status,403)
 assert.equal((await a.form({operation:'team.remove',operatorId:id('viewer@example.test')},a.owner)).status,303)
 assert.equal((await a.request('/api/vane/sites',{headers:{cookie:viewer}})).status,401)
 // Ownership moves only with the current owner's typed confirmation: the admin cannot take it, and a wrong confirmation changes nothing.
 assert.equal((await a.form({operation:'team.transfer',operatorId:id('admin@example.test'),confirm:'admin@example.test'},admin)).status,403)
 assert.equal((await a.form({operation:'team.transfer',operatorId:id('admin@example.test'),confirm:'someone@example.test'},a.owner)).status,400)
 const roles=async()=>Object.fromEntries((await a.dump()).oa_operators.map(p=>[p.email,p.role]))
 assert.equal((await roles())['admin@example.test'],'admin')
 // Base asks the owner for a fresh emailed proof first; once the owner follows it in this session, the transfer applies.
 assert.equal((await a.form({operation:'team.transfer',operatorId:id('admin@example.test'),confirm:'Admin@example.test'},a.owner)).status,403)
 assert.equal((await roles())['owner@example.test'],'owner')
 assert.equal((await a.post('/auth/step-up',{action:'owner:transfer',returnTo:'/app?section=team'},a.owner)).status,202)
 const proof=a.sentMail.findLast(m=>JSON.stringify(m.to).includes('owner@example.test')).html.match(/href="([^"]*\/auth\/confirm\?token=[^"]+)"/)[1]
 assert.equal((await a.post('/auth/confirm',{token:new URL(proof.replaceAll('&amp;','&'),a.origin).searchParams.get('token')},a.owner)).status,303)
 assert.equal((await a.form({operation:'team.transfer',operatorId:id('admin@example.test'),confirm:'Admin@example.test'},a.owner)).status,303)
 const after=await roles();assert.equal(after['admin@example.test'],'owner');assert.equal(after['owner@example.test'],'admin')
 assert.ok((await a.dump()).vane_audit.some(e=>e.action==='team.transfer'&&e.subject===id('admin@example.test')))
})
test('API-001 a site-scoped Stats API key answers visitors by channel with a filter, a saved segment and a comparison equal to the dashboard, refuses another site, a revoked key and a burst over the published limit, the Plausible v2 route returns the same figures, and a provisioning key creates a site, a goal and a shared link that appear in the app',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/thanks'}}),other=await a.addSite({name:'Oak Store',origin:'https://oak.example'})
 const desktop='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
 const start=Date.parse('2026-03-10T10:00:00Z'),google={referrer:'https://www.google.com/'},email={campaign:'spring',utm:{source:'newsletter',medium:'email'}}
 const visit=async(at,n,agent,first,paths)=>{for(const [i,path] of paths.entries()){await a.clock(at+n*600000+i*60000);assert.equal((await a.post('/api/vane/collect',a.event(id,{source:undefined,campaign:undefined,...(i?{}:first),path}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':agent})).status,202)}}
 // The compared day before, then this day: Organic Search and Email, on desktop and phones, some reaching /pricing.
 await visit(start-86400000,1,desktop,google,['/','/pricing']);await visit(start-86400000,2,desktop,email,['/'])
 for(const [n,agent,first,paths] of [[1,desktop,google,['/','/pricing']],[2,desktop,google,['/pricing','/thanks']],[3,desktop,email,['/','/pricing']],[4,iphone,google,['/pricing']],[5,desktop,email,['/']],[6,desktop,{},['/pricing']]])await visit(start,n,agent,first,paths)
 assert.equal((await a.form({operation:'segment.save',siteId:id,name:'Pricing',filters:'page:is:/pricing'},a.owner)).status,303)
 const segment=(await a.dump()).vane_segments[0].id
 // The owner creates a read-only key for one site; it is shown once and only its SHA-256 is kept.
 const created=await (await a.form({operation:'apikey.create',kind:'stats',label:'Reporting',[`site_${id}`]:'on'},a.owner)).text(),key=created.match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1]
 assert.ok(!(await (await a.request('/app?section=api',owner)).text()).includes(key),'shown once');assert.ok(!JSON.stringify(await a.dump()).includes(key),'only the hash is kept')
 const bearer=token=>({headers:{authorization:'Bearer '+token}}),v1=(query,token=key)=>a.request('/api/v1/stats?'+query,bearer(token))
 const query=`from=2026-03-10&to=2026-03-11&compare=previous&filter=device:is:desktop&segment=${segment}`
 const dashboard=await (await a.request(`/api/vane/summary?siteId=${id}&${query}`,owner)).json()
 const answer=await v1(`site_id=${id}&${query}&dimension=channel&metrics=visitors,visits,pageviews,bounce_rate`);assert.equal(answer.status,200,await answer.clone().text());const stats=await answer.json()
 assert.deepEqual(stats.results,{visitors:dashboard.visitors,visits:dashboard.visits,pageviews:dashboard.pageviews,bounce_rate:dashboard.bounceRate});assert.equal(stats.results.visits,4,'desktop visits that reached /pricing: 1, 2, 3 and 6')
 assert.deepEqual(stats.previous,{visitors:dashboard.previousVisitors,visits:dashboard.previousVisits,pageviews:dashboard.previousPageviews,bounce_rate:dashboard.previousBounceRate});assert.equal(stats.previous.visits,1)
 assert.deepEqual(stats.breakdown.map(r=>[r.value,r.visitors,r.visits,r.previous]),dashboard.channels.map(r=>[r.label,r.visitors,r.visits,r.previous]))
 assert.deepEqual(Object.fromEntries(stats.breakdown.filter(r=>r.visits).map(r=>[r.value,r.visits])),{'Organic Search':2,Email:1,Direct:1})
 // The Plausible v2-compatible route answers a Plausible query with the same figures (date_range is inclusive, as Plausible's).
 const plausible=body=>a.request('/api/v2/query',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)})
 const fixture={site_id:'fern.example',metrics:['visitors','visits','pageviews','bounce_rate'],date_range:['2026-03-10','2026-03-10'],filters:[['is','visit:device',['Desktop']]],include:{comparisons:{mode:'previous_period'}}}
 const plain=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-10&to=2026-03-11&compare=previous&filter=device:is:Desktop`,owner)).json()
 const totals=await (await plausible(fixture)).json();assert.deepEqual(totals.results[0].metrics,[plain.visitors,plain.visits,plain.pageviews,plain.bounceRate]);assert.deepEqual(totals.results[0].comparison.metrics,[plain.previousVisitors,plain.previousVisits,plain.previousPageviews,plain.previousBounceRate])
 assert.deepEqual(totals.query.date_range,['2026-03-10','2026-03-10'])
 const byChannel=await (await plausible({...fixture,dimensions:['visit:channel'],include:undefined})).json();assert.deepEqual(byChannel.results.map(r=>[r.dimensions[0],r.metrics[0],r.metrics[1]]),plain.channels.map(r=>[r.label,r.visitors,r.visits]))
 // Another site, an unknown or revoked key, a stats key at the Sites API and a burst over the published limit are each refused.
 assert.equal((await v1(`site_id=${other}&period=7d`)).status,403);assert.equal((await plausible({...fixture,site_id:'oak.example'})).status,403)
 assert.equal((await v1(`site_id=${id}&period=7d`,'vane_k_'+'0'.repeat(64))).status,401);assert.equal((await a.request(`/api/v1/stats?site_id=${id}`)).status,401)
 assert.equal((await a.request('/api/v1/sites',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:'{}'})).status,403)
 const openapi=await (await a.request('/api/v1/openapi.json')).json();assert.ok(openapi.paths['/api/v1/stats']&&openapi.paths['/api/v2/query']&&openapi.paths['/api/v1/sites']);const limit=openapi['x-rate-limits'].burst
 await a.clock(Math.ceil(Date.now()/(limit.seconds*1000))*limit.seconds*1000+limit.seconds*1000)
 const burst=[];for(let i=0;i<=limit.requests;i++)burst.push((await v1(`site_id=${id}&period=today&metrics=visitors`)));
 assert.ok(burst.slice(0,limit.requests).every(r=>r.status===200),'within the limit');assert.equal(burst.at(-1).status,429);assert.ok(Number(burst.at(-1).headers.get('retry-after'))>0)
 const keyId=(await a.dump()).vane_api_keys[0].id;assert.equal((await a.form({operation:'apikey.revoke',id:keyId},a.owner)).status,303)
 await a.clock(Date.now()+3600000);assert.equal((await v1(`site_id=${id}&period=7d`)).status,401,'revoked at once')
 // Only the owner creates a provisioning key; it creates a site, a goal and a shared link that appear in the app.
 const admin=await a.invite('admin@example.test','admin');assert.equal((await a.form({operation:'apikey.create',kind:'provisioning',label:'Agency'},admin)).status,403)
 const provisioning=(await (await a.form({operation:'apikey.create',kind:'provisioning',label:'Agency'},a.owner)).text()).match(/data-api-key>(vane_p_[0-9a-f]{64})</)[1]
 const provision=(path,body)=>a.request(path,{method:'POST',headers:{authorization:'Bearer '+provisioning,'content-type':'application/json'},body:JSON.stringify(body)})
 const made=await provision('/api/v1/sites',{name:'Birch Bakery',origin:'https://birch.example',paths:[],goals:{},consent:'not-required'});assert.equal(made.status,201,await made.clone().text());const birch=(await made.json()).site_id
 assert.equal((await provision(`/api/v1/sites/${birch}/goals`,{name:'order',path:'/order/thanks'})).status,201)
 const link=await provision(`/api/v1/sites/${birch}/shared-links`,{label:'Client view',reports:['totals']});assert.equal(link.status,201);const url=new URL((await link.json()).url)
 assert.equal((await a.request(url.pathname)).status,200)
 assert.match(await (await a.request('/app?section=api',owner)).text(),/Reporting<\/td>[\s\S]*?<td class="vane-number">\d+<\/td>/,'each key shows its requests today')
 const settings=await (await a.request(`/app/sites/${birch}?section=settings`,owner)).text();assert.ok(settings.includes('Birch Bakery')&&settings.includes('order=/order/thanks'))
 assert.ok((await a.dump()).vane_audit.some(e=>e.detail.includes('via key:Agency')))
 assert.equal((await provision('/api/v1/sites',{name:'Bad',origin:'not an origin'})).status,400)
})
test('API-002 every table of a filtered, compared report downloads as CSV with the dashboard\'s figures, for a site the person may open',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/thanks'}}),other=await a.addSite({name:'Oak Store',origin:'https://oak.example'})
 const start=Date.parse('2026-03-10T10:00:00Z')
 for(const [n,first,paths] of [[1,{referrer:'https://www.google.com/'},['/','/thanks']],[2,{campaign:'spring',utm:{source:'newsletter',medium:'email'}},['/pricing']],[3,{referrer:'https://www.google.com/'},['/','/pricing']]])for(const [i,path] of paths.entries()){await a.clock(start+n*600000+i*60000);assert.equal((await a.post('/api/vane/collect',a.event(id,{source:undefined,campaign:undefined,...(i?{}:first),path}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'})).status,202)}
 const query='from=2026-03-10&to=2026-03-11&compare=previous&filter=page:contains:pricing'
 const dashboard=await (await a.request(`/api/vane/summary?siteId=${id}&${query}`,owner)).json()
 const html=await (await a.request(`/app/sites/${id}?section=report&${query}`,owner)).text()
 const links=[...html.matchAll(/href="([^"]+)" data-csv="(\w+)"/g)].map(m=>[m[2],m[1].replaceAll('&amp;','&')])
 for(const table of ['channels','topPages','entryPages','sources','series'])assert.ok(links.some(([name])=>name===table),table)
 const parse=text=>{const [head,...rows]=text.trim().split('\r\n');const columns=head.split(',');return rows.map(r=>Object.fromEntries(r.split(',').map((v,i)=>[columns[i],v])))}
 for(const [table,href] of links) {
  const r=await a.request(href,owner);assert.equal(r.status,200,table);assert.match(r.headers.get('content-type'),/^text\/csv/);assert.match(r.headers.get('content-disposition'),new RegExp(`attachment; filename="vane-${id}-${table}-2026-03-10-2026-03-11.csv"`))
  const rows=parse(await r.text());assert.equal(rows.length,dashboard[table].length,table)
  for(const [i,row] of rows.entries())for(const [column,value] of Object.entries(row))if(['number','string'].includes(typeof dashboard[table][i][column])&&!/[",\r\n]/.test(String(dashboard[table][i][column])))assert.equal(value,String(dashboard[table][i][column]).replace(/^([=+\-@])/,"'$1"),`${table}.${column}`)
 }
 const channels=parse(await (await a.request(links.find(([name])=>name==='channels')[1],owner)).text());assert.deepEqual(Object.fromEntries(channels.filter(r=>r.visits!=='0').map(r=>[r.label,r.visits])),{'Organic Search':'1',Email:'1'})
 // A viewer of another site gets 403, and a table the report does not have 404.
 assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'chosen',[`site_${other}`]:'on'},a.owner)).status,303);const viewer=await a.accept('viewer@example.test')
 assert.equal((await a.request(links[0][1],{headers:{cookie:viewer}})).status,403);assert.equal((await a.request(`/api/vane/csv?siteId=${id}&table=nope`,owner)).status,404)
})
// A stored ZIP's entries by name, each checked against its CRC-32.
function unzip(bytes){const b=Buffer.from(bytes),end=b.lastIndexOf(Buffer.from([0x50,0x4b,5,6])),files={};let at=b.readUInt32LE(end+16)
 for(let i=0;i<b.readUInt16LE(end+10);i++){const size=b.readUInt32LE(at+20),length=b.readUInt16LE(at+28),name=b.toString('utf8',at+46,at+46+length),offset=b.readUInt32LE(at+42),start=offset+30+b.readUInt16LE(offset+26)+b.readUInt16LE(offset+28),data=b.subarray(start,start+size);assert.equal(crc32(data),b.readUInt32LE(at+16),name);files[name]=data.toString('utf8');at+=46+length+b.readUInt16LE(at+30)+b.readUInt16LE(at+32)}
 return files}
const csvRows=text=>{const [head,...rows]=text.trim().split('\r\n');const columns=head.split(',');return Object.assign(rows.map(r=>Object.fromEntries(r.split(',').map((v,i)=>[columns[i],v]))),{columns})}
const sumBy=(rows,key,field)=>rows.reduce((m,r)=>({...m,[r[key]]:(m[r[key]]??0)+Number(r[field])}),{})
test('API-002 a whole-site ZIP in Plausible\'s layout, the Looker Studio connector and a scheduled R2 export each match the dashboard and the declared schema; only the owner sets the export, with a sealed key, a public https endpoint and every run audited',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/thanks'}}),other=await a.addSite({name:'Oak Store',origin:'https://oak.example'})
 const desktop='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
 const google={referrer:'https://www.google.com/'},email={campaign:'spring',utm:{source:'newsletter',medium:'email'}}
 const visit=async(at,n,agent,first,paths)=>{for(const [i,path] of paths.entries()){await a.clock(at+n*600000+i*60000);assert.equal((await a.post('/api/vane/collect',a.event(id,{source:undefined,campaign:undefined,...(i?{}:first),path}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':agent})).status,202)}}
 const day1=Date.parse('2026-03-09T10:00:00Z'),day2=Date.parse('2026-03-10T10:00:00Z')
 for(const [n,agent,first,paths] of [[1,desktop,google,['/','/pricing']],[2,iphone,email,['/']]])await visit(day1,n,agent,first,paths)
 for(const [n,agent,first,paths] of [[1,desktop,google,['/','/pricing']],[2,desktop,google,['/pricing','/thanks']],[3,desktop,email,['/','/pricing']],[4,iphone,google,['/pricing']],[5,desktop,email,['/']],[6,desktop,{},['/pricing']]])await visit(day2,n,agent,first,paths)
 const summary=async query=>(await a.request(`/api/vane/summary?siteId=${id}&${query}`,owner)).json()
 const both=await summary('from=2026-03-09&to=2026-03-11'),tenth=await summary('from=2026-03-10&to=2026-03-11')
 // The site ZIP: Plausible's file names and columns, every date, and sums equal to the dashboard's.
 const html=await (await a.request(`/app/sites/${id}?section=report`,owner)).text(),href=html.match(/href="([^"]+)" data-site-zip/)[1].replaceAll('&amp;','&')
 const zipped=await a.request(href,owner);assert.equal(zipped.status,200);assert.equal(zipped.headers.get('content-type'),'application/zip');assert.match(zipped.headers.get('content-disposition'),new RegExp(`attachment; filename="vane-${id}_20260309_20260310.zip"`))
 const files=unzip(await zipped.arrayBuffer()),file=name=>csvRows(files[`imported_${name}_20260309_20260310.csv`])
 assert.equal(file('locations').reduce((n,r)=>n+Number(r.visits),0),both.visits,'location export preserves every visit, including unknown locations');assert.deepEqual(sumBy(file('metros').map(r=>({...r,label:r.metro_name||(r.metro_code?`Metro ${r.metro_code} (unnamed)`:'Unknown metro area')})),'label','visits'),Object.fromEntries(both.metros.map(r=>[r.label,r.visits])),'metro export figures equal the dashboard')
 const visitors=file('visitors');assert.deepEqual(visitors.columns,['date','visitors','pageviews','bounces','visits','visit_duration']);assert.deepEqual(visitors.map(r=>r.date),['2026-03-09','2026-03-10'])
 const total=field=>visitors.reduce((n,r)=>n+Number(r[field]),0)
 assert.deepEqual([total('visitors'),total('visits'),total('pageviews'),Math.round(total('bounces')/total('visits')*1000)/10],[both.visitors,both.visits,both.pageviews,both.bounceRate])
 const row10=visitors.find(r=>r.date==='2026-03-10');assert.deepEqual([+row10.visitors,+row10.visits,+row10.pageviews],[tenth.visitors,tenth.visits,tenth.pageviews])
 const sources=file('sources');assert.deepEqual(sources.columns,['date','source','referrer','utm_source','utm_medium','utm_campaign','utm_content','utm_term','pageviews','visitors','visits','visit_duration','bounces'])
 assert.deepEqual(Object.fromEntries(Object.entries(sumBy(sources,'source','visits')).map(([k,v])=>[k||'direct',v])),Object.fromEntries(both.sourceVisits.map(r=>[r.label,r.visits])))
 assert.deepEqual(sumBy(file('devices'),'device','visits'),Object.fromEntries(both.deviceVisits.map(r=>[r.label,r.visits])))
 assert.deepEqual(sumBy(file('entry_pages'),'entry_page','entrances'),Object.fromEntries(both.entryPages.map(r=>[r.path,r.visits])))
 assert.deepEqual(sumBy(file('pages'),'page','pageviews'),Object.fromEntries(both.topPages.map(r=>[r.path,r.pageviews])))
 assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'chosen',[`site_${other}`]:'on'},a.owner)).status,303);const viewer=await a.accept('viewer@example.test')
 assert.equal((await a.request(href,{headers:{cookie:viewer}})).status,403,'the ZIP follows the viewer\'s site scope')
 // The Looker Studio connector, run as Apps Script against the Stats API with a site's Stats API key.
 const key=(await (await a.form({operation:'apikey.create',kind:'stats',label:'Looker Studio',[`site_${id}`]:'on'},a.owner)).text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1]
 const looker=appsScript(await readFile(new URL('../connectors/looker-studio/Code.gs',import.meta.url),'utf8'),async(url,options)=>{const u=new URL(url);assert.equal(u.origin,a.origin);const r=await a.request(u.pathname+u.search,{headers:{authorization:options.headers.Authorization}});return {status:r.status,body:await r.text()}});t.after(()=>looker.close())
 assert.equal((await looker.call('getAuthType')).type,'KEY');assert.equal((await looker.call('setCredentials',{key:'nope'})).errorCode,'INVALID_CREDENTIALS');assert.equal((await looker.call('setCredentials',{key})).errorCode,'NONE');assert.equal(await looker.call('isAuthValid'),true)
 assert.equal((await looker.call('getConfig')).dateRangeRequired,true);const schema=(await looker.call('getSchema')).schema;assert.ok(['channel','page','visitors','bounce_rate'].every(name=>schema.some(f=>f.name===name)))
 const request={configParams:{origin:a.origin,site_id:id},dateRange:{startDate:'2026-03-10',endDate:'2026-03-10'}}
 const byChannel=await looker.call('getData',{...request,fields:[{name:'channel'},{name:'visitors'},{name:'visits'},{name:'bounce_rate'}]})
 assert.deepEqual(byChannel.schema.map(f=>f.name),['channel','visitors','visits','bounce_rate']);assert.deepEqual(byChannel.rows.map(r=>r.values),tenth.channels.map(r=>[r.label,r.visitors,r.visits,r.bounceRate===null?null:r.bounceRate/100]))
 const totals=await looker.call('getData',{...request,dateRange:{startDate:'2026-03-09',endDate:'2026-03-10'},fields:[{name:'visitors'},{name:'pageviews'}]});assert.deepEqual(totals.rows,[{values:[both.visitors,both.pageviews]}])
 assert.ok(looker.fetches.every(f=>new URL(f.url).pathname==='/api/v1/stats'&&f.options.headers.Authorization==='Bearer '+key))
 // The published schema of the warehouse export.
 const published=await (await a.request('/api/v1/export-schema.json')).json(),columns=name=>published.objects[name].columns.map(c=>c.name)
 assert.ok(published.never.includes('visitor hash')&&!columns('events').includes('visitor'))
 // Only the owner schedules an export, to a public https endpoint.
 const admin=await a.invite('admin@example.test','admin'),input={operation:'export.save',siteId:id,endpoint:'https://acct.r2.fixture.example',bucket:'vane-export',region:'auto',prefix:'analytics',accessKeyId:'FIXTUREKEY0001',secretAccessKey:'fixture-secret-'+crypto.randomUUID(),from:'2026-03-09'}
 assert.equal((await a.form(input,admin)).status,403)
 for(const endpoint of ['http://acct.r2.fixture.example','https://127.0.0.1','https://10.0.0.5','https://192.168.1.4','https://169.254.169.254','https://localhost','https://[::1]','https://metadata.internal','https://printer.local','https://bucket'])assert.equal((await a.form({...input,endpoint},a.owner)).status,400,endpoint)
 const objects={};let refuse=false
 a.fixtureSites['https://acct.r2.fixture.example']=async request=>{
  const u=new URL(request.url),body=await request.text(),auth=request.headers.get('authorization').match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/auto\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/)
  // The fixture checks the Signature Version 4 itself, so a PUT signed without the owner's secret key is refused.
  const headers={'content-type':request.headers.get('content-type'),host:u.host,'x-amz-content-sha256':request.headers.get('x-amz-content-sha256'),'x-amz-date':request.headers.get('x-amz-date')},hash=createHash('sha256').update(body).digest('hex')
  const canonical=['PUT',u.pathname,'',...auth[3].split(';').map(name=>`${name}:${headers[name]}`),'',auth[3],hash].join('\n'),scope=`${auth[2]}/auto/s3/aws4_request`
  let signing=createHmac('sha256','AWS4'+input.secretAccessKey).update(auth[2]).digest();for(const part of ['auto','s3','aws4_request'])signing=createHmac('sha256',signing).update(part).digest()
  const valid=request.method==='PUT'&&auth[1]===input.accessKeyId&&headers['x-amz-content-sha256']===hash&&createHmac('sha256',signing).update(['AWS4-HMAC-SHA256',headers['x-amz-date'],scope,createHash('sha256').update(canonical).digest('hex')].join('\n')).digest('hex')===auth[4]
  if(!valid||refuse)return new Response('<Error><Code>AccessDenied</Code></Error>',{status:403})
  objects[decodeURIComponent(u.pathname)]=body;return new Response(null,{status:200})
 }
 assert.equal((await a.form(input,a.owner)).status,303)
 const settings=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text();assert.match(settings,/data-export-status>Daily export to <code>acct\.r2\.fixture\.example\/vane-export\/analytics\/vane\//)
 assert.ok(!settings.includes(input.secretAccessKey)&&!JSON.stringify(await a.dump()).includes(input.secretAccessKey),'the key is sealed');assert.ok(!('vane_exports' in (await a.archive()).payload.tables),'the export and its key are left out of history archives')
 assert.ok(!(await (await a.request(`/app/sites/${id}?section=settings`,{headers:{cookie:admin}})).text()).includes('value="export.save"'),'an admin sees no export form')
 // The scheduled run after both dates end: two objects per date, the rollup equal to that date's dashboard.
 const before=a.egress.length;await a.clock(Date.parse('2026-03-11T01:00:00Z'));await a.scheduled()
 const prefix=`/vane-export/analytics/vane/${id}`
 assert.deepEqual(Object.keys(objects).sort(),[`${prefix}/daily_rollups/2026-03-09.csv`,`${prefix}/daily_rollups/2026-03-10.csv`,`${prefix}/events/2026-03-09.csv`,`${prefix}/events/2026-03-10.csv`])
 const rollup=csvRows(objects[`${prefix}/daily_rollups/2026-03-10.csv`]);assert.deepEqual(rollup.columns,columns('daily_rollups'))
 assert.deepEqual(rollup.map(r=>[r.date,r.site_id,+r.visitors,+r.visits,+r.pageviews,+r.bounce_rate,+r.visit_duration]),[['2026-03-10',id,tenth.visitors,tenth.visits,tenth.pageviews,tenth.bounceRate,tenth.averageDuration]])
 const dump=await a.dump(),events=csvRows(objects[`${prefix}/events/2026-03-10.csv`]);assert.deepEqual(events.columns,columns('events'))
 assert.deepEqual(events.map(r=>r.id).sort(),dump.vane_events.filter(e=>e.site_id===id&&e.day==='2026-03-10').map(e=>e.id).sort())
 for(const hash of new Set(dump.vane_events.map(e=>e.visitor).filter(Boolean)))assert.ok(Object.values(objects).every(text=>!text.includes(hash)),'no visitor hash leaves')
 const runs=()=>a.dump().then(d=>d.vane_audit.filter(e=>e.action.startsWith('export.')&&e.action!=='export.configure').map(e=>[e.action,e.detail]))
 assert.deepEqual((await runs()).map(([action,detail])=>[action,detail.match(/^(\S+): 1 rollup row and (\d+) event rows/)?.slice(1)]).sort(),[['export.run',['2026-03-09','3']],['export.run',['2026-03-10',String(events.length)]]])
 await a.scheduled();assert.equal(Object.keys(objects).length,4,'each date is exported once')
 // A refused upload is audited with no rows sent, keeps the date for later and holds the export back for an hour.
 refuse=true;await a.clock(Date.parse('2026-03-12T01:00:00Z'));await a.scheduled();const sent=a.egress.length;await a.scheduled()
 assert.equal(a.egress.length,sent,'held back after a refusal');assert.ok((await runs()).some(([action,detail])=>action==='export.fail'&&detail.startsWith('2026-03-11 refused: HTTP 403')&&detail.includes('0 rows sent')))
 refuse=false;await a.clock(Date.parse('2026-03-12T02:01:00Z'));await a.scheduled();assert.ok(objects[`${prefix}/events/2026-03-11.csv`],'retried after an hour')
 assert.ok(a.egress.slice(before).every(url=>url.startsWith('https://acct.r2.fixture.example/')),'the export talks only to the owner\'s bucket')
})
test('a site-scoped administrator changes the team only through the team page and within their sites; Base\'s account doors refuse them and write nothing',async t=>{
 const a=await withApp(t),A=await a.addSite(),B=await a.addSite({name:'Oak Store',origin:'https://oak.example'})
 const invite=(email,role,site,cookie=a.owner)=>a.form({operation:'team.invite',email,role,scope:'chosen',['site_'+site]:'on'},cookie)
 for(const [email,role,site] of [['fern-admin@example.test','admin',A],['oak-viewer@example.test','viewer',B],['oak-pending@example.test','viewer',B],['oak-removed@example.test','viewer',B]])assert.equal((await invite(email,role,site)).status,303,email)
 const admin=await a.accept('fern-admin@example.test'),oak=await a.accept('oak-viewer@example.test');await a.accept('oak-removed@example.test')
 const people=await (await a.request('/auth/operators',{headers:{cookie:a.owner}})).json(),id=email=>people.find(p=>p.email===email).id
 assert.equal((await a.form({operation:'team.remove',operatorId:id('oak-removed@example.test')},a.owner)).status,303)
 const oakSessions=await a.request('/auth/sessions',{headers:{cookie:oak}});assert.equal(oakSessions.status,200,'a person lists their own sessions');const oakSession=(await oakSessions.json())[0].id
 // Base's doors know people but not sites: an invitation there would open every site, and the others reach people outside the admin's sites.
 const before=(await a.dump()).oa_operators
 assert.equal((await a.post('/auth/invite',{email:'unscoped@example.test',role:'member',displayName:'Unscoped'},admin)).status,403)
 for(const [path,body] of [['/auth/invite/cancel',{operatorId:id('oak-pending@example.test')}],['/auth/operator/status',{operatorId:id('oak-viewer@example.test'),status:'inactive'}],['/auth/operator/status',{operatorId:id('oak-removed@example.test'),status:'active'}],['/auth/operator/role',{operatorId:id('oak-viewer@example.test'),role:'member'}],['/auth/session/revoke',{sessionId:oakSession}]])assert.equal((await a.post(path,body,admin)).status,403,`${path} ${body.status??''}`)
 for(const path of ['/auth/operators','/auth/sessions?operatorId='+id('oak-viewer@example.test')])assert.equal((await a.request(path,{headers:{cookie:admin}})).status,403,path)
 assert.deepEqual((await a.dump()).oa_operators,before,'no refused call wrote anything')
 assert.equal((await a.request('/api/vane/sites',{headers:{cookie:oak}})).status,200,'the other site\'s viewer stays signed in')
 assert.equal((await a.request('/auth/sessions',{headers:{cookie:admin}})).status,200,'the admin still lists their own sessions')
 // The team page still invites within the admin's own sites.
 assert.equal((await invite('fern-viewer@example.test','viewer',A,admin)).status,303)
 assert.deepEqual((await (await a.request('/api/vane/sites',{headers:{cookie:await a.accept('fern-viewer@example.test')}})).json()).map(s=>s.id),[A])
})
