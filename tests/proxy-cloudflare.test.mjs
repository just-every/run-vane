import test from 'node:test'
import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { installation } from './harness.mjs'

const token='synthetic-vane-1',accountId='a'.repeat(32),zoneId='b'.repeat(32),workerName='analytics-vane'
const endpoint='/api/vane/proxy-connections',hostname='synthetic-vane-2.test'

// Only Cloudflare's HTTP edge is simulated. Connections, sessions, permissions,
// provider metadata and audits all run in the installation's actual Worker/D1.
function cloudflareEdge(a) {
 const state={zone:{id:zoneId,name:hostname,account:{id:accountId},status:'active'},settings:{bindings:[{type:'plain_text',name:'AUTH_ORIGIN',text:a.origin}]},routes:[],domains:[],dns:[],failure:null}
 const requests=[]
 a.fixtureSites['https://api.cloudflare.com']=async request=>{
  const url=new URL(request.url()),body=request.body?await request.json():undefined
  assert.equal(request.headers.get('authorization'),'Bearer '+token)
  requests.push({method:request.method,path:url.pathname+url.search,body})
  if(state.failure==='throw')throw new Error('synthetic-vane-27')
  if(state.failure==='refused')return Response.json({success:false,errors:[{message:token}]},{status:403})
  if(state.failure==='unreadable')return new Response(token,{status:502})
  const path=url.pathname.replace('/client/v4',''),ok=result=>Response.json({success:true,result})
  if(request.method==='GET'){
   if(path===`/zones/${zoneId}`)return ok(state.zone)
   if(path===`/accounts/${accountId}/workers/scripts/${workerName}/settings`)return ok(state.settings)
   if(path===`/zones/${zoneId}/workers/routes`)return ok(state.routes)
   if(path===`/accounts/${accountId}/workers/domains`){assert.equal(url.searchParams.size,1);assert.equal(url.searchParams.get('hostname'),'stats.'+hostname);return ok(state.domains)}
   if(path===`/zones/${zoneId}/dns_records`){assert.equal(url.searchParams.size,1);assert.equal(url.searchParams.get('name'),'stats.'+hostname);return ok(state.dns)}
  }
  if(request.method==='POST'&&path===`/zones/${zoneId}/workers/routes`){const route={id:'synthetic-vane-3',...body};state.routes.push(route);return ok(route)}
  if(request.method==='PUT'&&path===`/accounts/${accountId}/workers/domains`){const domain={id:'synthetic-vane-4',...body};state.domains.push(domain);return ok(domain)}
  assert.fail(`Unexpected Cloudflare request: ${request.method} ${path}`)
 }
 return {state,requests,writes:()=>requests.filter(r=>r.method!=='GET')}
}

test('owner connects an existing installation Worker with narrow idempotent Cloudflare routes and unused dedicated subdomains without retaining the transient token',async t=>{
 const logs=['log','info','debug','warn','error'].map(method=>t.mock.method(console,method))
 const a=await installation();t.after(()=>a.close())
 const cf=cloudflareEdge(a),siteId=await a.addSite({name:'synthetic-vane-2',origin:'https://'+hostname})
 const admin=await a.invite('synthetic-vane-5@example.test','admin'),member=await a.invite('synthetic-vane-6@example.test','member')
 const read=async(response,status=200)=>{
  const text=await response.text()
  assert.equal(text.includes(token),false,'the HTTP response must never echo the Cloudflare token')
  assert.equal(JSON.stringify([...response.headers]).includes(token),false)
  assert.equal(response.status,status,text)
  return JSON.parse(text)
 }
 const create=async(host,mode='worker',publicPrefix='/insights')=>(await read(await a.post(endpoint,{operation:'proxy.create',siteId,hostname:host,mode,publicPrefix},a.owner))).connection
 const connection=await create(hostname),subdomain=await create('stats.'+hostname)
 // Keep all connection commands on the public transport, including refusals.
 const command=async(operation,c=connection,overrides={},cookie=a.owner,status=200)=>read(await a.post(endpoint,{operation:'proxy.cloudflare.'+operation,siteId,connectionId:c.id,token,accountId,zoneId,workerName,...overrides},cookie),status)
 const stored=async()=>({connections:(await a.inspectDb.prepare('SELECT * FROM vane_proxy_connections ORDER BY id').all()).results,audit:(await a.inspectDb.prepare("SELECT * FROM vane_audit WHERE action LIKE 'proxy.%' ORDER BY id").all()).results})
 const refused=async(operation,c,status,overrides={},cookie=a.owner)=>{
  const before=await stored(),provider=structuredClone(cf.state),writes=cf.writes().length
  await command(operation,c,overrides,cookie,status)
  assert.deepEqual(await stored(),before,'a refused connection must not change native storage or audit')
  assert.deepEqual(cf.state,provider,'existing provider configuration remains untouched')
  assert.equal(cf.writes().length,writes,'a refused connection must not send provider writes')
 }
 for(const operation of ['route','domain'])for(const [cookie,status] of [['',401],[admin,403],[member,403]]){
  const before=cf.requests.length
  await refused(operation,connection,status,{},cookie)
  assert.equal(cf.requests.length,before,'authorization precedes every provider read and write')
 }
 for(const overrides of [{workerName:'synthetic-vane-7'},{accountId:'invalid'},{zoneId:'invalid'},{token:''}]){
  const before=cf.requests.length;await refused('route',connection,400,overrides);assert.equal(cf.requests.length,before)
 }
 const external=await create(hostname,'external','/external'),beforeExternal=cf.requests.length
 await refused('route',external,400);assert.equal(cf.requests.length,beforeExternal,'server adapters cannot attach the installation Worker')
 const validZone=structuredClone(cf.state.zone),validSettings=structuredClone(cf.state.settings)
 for(const zone of [{...validZone,account:{id:'c'.repeat(32)}},{...validZone,status:'pending'},{...validZone,id:'d'.repeat(32)},{...validZone,name:'unrelated.example'}]){
  cf.state.zone=zone;await refused('route',connection,403)
 }
 cf.state.zone=validZone
 for(const bindings of [[],[{type:'plain_text',name:'AUTH_ORIGIN',text:'https://unrelated.example'}],[{type:'secret_text',name:'AUTH_ORIGIN',text:a.origin}]]){
  cf.state.settings={bindings};await refused('route',connection,403)
 }
 cf.state.settings=validSettings
 const pattern=hostname+'/insights/*',unrelated=[{id:'synthetic-vane-8',pattern:hostname+'/shop/*',script:'synthetic-vane-9'},{id:'synthetic-vane-20',pattern:'unrelated.example/*',script:'synthetic-vane-9'}]
 for(const conflict of [{pattern,script:'synthetic-vane-9'},{pattern:hostname+'/*',script:workerName},{pattern:'*'+hostname+'/*',script:'synthetic-vane-9'},{pattern:'https://'+hostname+'/insights/admin/*',script:'synthetic-vane-9'}]){
  cf.state.routes=[...unrelated,{id:'synthetic-vane-21',...conflict}];await refused('route',connection,409)
 }
 cf.state.routes=structuredClone(unrelated)
 await command('route');await command('route')
 assert.deepEqual(cf.writes(),[{method:'POST',path:`/client/v4/zones/${zoneId}/workers/routes`,body:{pattern,script:workerName}}],'repeating the owner action creates the exact narrow route only once')
 assert.deepEqual(cf.state.routes,[...unrelated,{id:'synthetic-vane-3',pattern,script:workerName}])
 cf.state.routes.push({id:'synthetic-vane-22',pattern:hostname+'/*',script:'synthetic-vane-9'})
 // An exact existing route must not hide another overlapping route.
 await refused('route',connection,409)
 cf.state.routes=structuredClone(unrelated)
 await refused('domain',connection,400)
 for(const existing of [{service:'synthetic-vane-9',zone_id:zoneId},{service:workerName,zone_id:'c'.repeat(32)},{service:workerName,zone_id:zoneId,enabled:false}]){
  cf.state.domains=[{id:'synthetic-vane-23',hostname:subdomain.hostname,...existing}];await refused('domain',subdomain,409)
 }
 cf.state.domains=[]
 for(const type of ['A','CNAME','TXT']){
  cf.state.dns=[{id:'synthetic-vane-24',name:subdomain.hostname,type,content:type==='A'?'198.51.100.10':'synthetic-vane-25'}]
  await refused('domain',subdomain,409)
 }
 cf.state.dns=[];cf.state.routes=[{id:'synthetic-vane-26',pattern:subdomain.hostname+'/shop/*',script:'synthetic-vane-9'}]
 await refused('domain',subdomain,409)
 cf.state.routes=structuredClone(unrelated)
 await command('domain',subdomain);await command('domain',subdomain)
 assert.deepEqual(cf.writes().slice(1),[{method:'PUT',path:`/client/v4/accounts/${accountId}/workers/domains`,body:{hostname:subdomain.hostname,service:workerName,environment:'production',zone_id:zoneId}}],'a free custom subdomain is attached once without DNS replacements')
 assert.deepEqual(cf.state.routes,unrelated)
 assert.deepEqual(cf.state.domains,[{id:'synthetic-vane-4',hostname:subdomain.hostname,service:workerName,environment:'production',zone_id:zoneId}])
 for(const failure of ['refused','unreadable','throw']){cf.state.failure=failure;await refused('route',connection,502)}
 cf.state.failure=null
 const listed=await read(await a.request(endpoint+'?siteId='+siteId,{headers:{cookie:a.owner}}))
 for(const [c,kind,resourceId] of [[connection,'route','synthetic-vane-3'],[subdomain,'domain','synthetic-vane-4']]){
  const provider=listed.find(item=>item.id===c.id).provider
  assert.deepEqual({...provider,connectedAt:undefined},{kind,resourceId,accountId,zoneId,workerName,connectedBy:c.createdBy,connectedAt:undefined})
  assert.ok(Number.isFinite(provider.connectedAt))
  const row=(await stored()).connections.find(item=>item.id===c.id)
  assert.deepEqual(JSON.parse(row.provider_json),provider,'the provider resource receipt is durably recorded')
  const audit=await read(await a.request('/api/vane/audit',{headers:{cookie:a.owner}}))
  const entries=audit.filter(entry=>entry.action==='proxy.cloudflare.'+kind)
  assert.equal(entries.length,2,'both explicit owner actions are audited even though the provider write is idempotent')
  assert.ok(entries.every(entry=>entry.actor===c.createdBy&&entry.subject===siteId&&entry.detail.includes(c.id)&&entry.detail.includes(resourceId)))
 }
 const auditView=await a.request('/app?section=audit',{headers:{cookie:a.owner}})
 assert.equal(auditView.status,200);assert.equal((await auditView.text()).includes(token),false)
 assert.equal(JSON.stringify(await a.dump()).includes(token),false,'the transient token is absent from every stored table')
 assert.equal(JSON.stringify(await a.archive()).includes(token),false,'exports do not retain the token')
 assert.equal(JSON.stringify(a.sentMail).includes(token),false)
 assert.ok(a.egress.filter(url=>url.startsWith('https://api.cloudflare.com')).every(url=>url.startsWith('https://api.cloudflare.com/client/v4/')&&!url.includes(token)))
 assert.equal(inspect(logs.flatMap(log=>log.mock.calls.map(call=>call.arguments)),{depth:null}).includes(token),false,'provider response text and thrown errors cannot leak the token into application/runtime logs')
})
