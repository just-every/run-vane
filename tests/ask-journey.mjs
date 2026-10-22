import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { installation } from './vane-helpers.mjs'

// Shared synthetic questions and analytics data. Live mode below forwards only the real deployment model edge.
export const now=Date.parse('2026-03-18T15:00:00Z')
const query=(extra={})=>({kind:'query',query:{metrics:['visitors'],period:'7d',filters:[],...extra}})
export const SCRIPT={
 'How many visitors and pageviews did we have in the last 7 days?':query({metrics:['visitors','pageviews']}),
 'Which campaigns brought paying customers from Texas this month?':query({metrics:['visitors','conversion_rate'],dimension:'utm_campaign',period:'month',filters:['region:is:Texas','goal:is:purchase']}),
 'What are our top sources by visitors and visits over the last 30 days?':query({metrics:['visitors','visits'],dimension:'source',period:'30d'}),
 'Which pages get the most pageviews this month?':query({metrics:['pageviews'],dimension:'page',period:'month'}),
 'How did visits over the last 30 days change against the previous period?':query({metrics:['visits'],period:'30d',compare:'previous'}),
 'Which regions sent visitors between March 5 and March 12?':query({metrics:['visitors'],dimension:'region',period:undefined,from:'2026-03-05',to:'2026-03-13'}),
 'What was our bounce rate by device last month?':query({metrics:['bounce_rate','visitors'],dimension:'device',period:'last-month'}),
 'How is the site doing?':{kind:'clarify',prompt:'Do you mean traffic or engagement?',choices:[{label:'Visitors over the last 7 days',query:{metrics:['visitors'],period:'7d',filters:[]}},{label:'Pageviews by page this month',query:{metrics:['pageviews'],dimension:'page',period:'month',filters:[]}}]},
 'Who is the person that visited from Austin?':{kind:'unanswerable',reason:'people',explanation:'Visitors are anonymous daily hashes, so no person can be named.'},
 'Why did traffic dip on Tuesday?':{kind:'unanswerable',reason:'causes',explanation:'Vane shows what moved, not a proven cause.'},
}
export async function seed(a,siteId){
 let n=0
 const visit=async(at,{campaign='launch',region='Texas',source='search.example',paths=['/'],ua='Synthetic Browser'}={})=>{const ip='198.51.100.'+(++n)
  for(const [i,path] of paths.entries()){await a.clock(at+i*20000);const r=await a.request('/api/vane/collect',{method:'POST',headers:{origin:'https://fern.example','content-type':'application/json','user-agent':ua,'cf-connecting-ip':ip},body:JSON.stringify(a.event(siteId,{path,campaign,source})),cf:{country:'US',region,regionCode:'XX',city:null,metroCode:null}});assert.equal(r.status,202,await r.clone().text())}}
 const day=86400000
 for(let d=1;d<=14;d++){
  await visit(now-d*day,{campaign:d%3?'launch':'spring',paths:d%4?['/','/pricing']:['/','/thanks']})
  await visit(now-d*day+3600000,{campaign:'spring',region:'Ohio',source:'news.example',paths:['/blog']})
 }
 await visit(now-30*day,{campaign:'winter',paths:['/']})
}

// The fixture plans include useful extra measures; these are the measures explicitly needed to answer each question.
const requiredMetrics={
 'Which campaigns brought paying customers from Texas this month?':['visitors'],
 'What was our bounce rate by device last month?':['bounce_rate'],
}
let liveStage='configuration',providerFailure=null
// An explicit command, outside push Verify: no scripted model response is installed in this journey.
async function live() {
 const {AI_API_KEY,AI_MODEL}=process.env,AI_BASE_URL=process.env.AI_BASE_URL||'https://api.openai.com/v1'
 assert.ok(AI_API_KEY&&AI_MODEL,'Provide AI_API_KEY and AI_MODEL through the private environment wrapper.')
 const base=new URL(AI_BASE_URL)
 assert.ok(base.protocol==='https:'&&!base.username&&!base.password&&!base.search&&!base.hash,'Use a public HTTPS deployment model base URL without credentials in its URL.')
 const endpoint=AI_BASE_URL.replace(/\/$/,'')+'/chat/completions'
 const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
 liveStage='installation'
 const a=await installation({vars:{AI_ENABLED:'true',AI_API_KEY,AI_MODEL,AI_BASE_URL}})
 const receipt={revision,journey:'AGENT-007 real-model sandbox',at:new Date().toISOString(),provider:base.origin,model:AI_MODEL,questions:[],calls:0}
 try {
  a.fixtureSites[base.origin]=async request=>{
   assert.equal(request.url,endpoint,'Only the configured deployment model endpoint may receive the question.')
   receipt.calls++
   let response
   try{response=await fetch(endpoint,{method:'POST',headers:Object.fromEntries(['authorization','accept','content-type'].map(name=>[name,request.headers.get(name)])),body:await request.text(),redirect:'manual',signal:AbortSignal.timeout(20000)})}
   catch(error){providerFailure={transport:error.name,code:/^[A-Z_0-9]{1,80}$/.test(error.cause?.code??'')?error.cause.code:null,headerNames:[...request.headers.keys()]};throw error}
   const reply=await response.clone().json().catch(()=>null);let plan;try{plan=JSON.parse(reply?.choices?.[0]?.message?.content)}catch{}
   providerFailure={status:response.status,encoded:response.headers.has('content-encoding'),replyKeys:Object.keys(reply??{}),contentType:typeof reply?.choices?.[0]?.message?.content,planShape:plan?{keys:Object.keys(plan),kind:plan.kind,queryKeys:Object.keys(plan.query??{}),metrics:plan.query?.metrics,period:plan.query?.period}:null}
   if(!response.ok){
    // Only structural provider codes/parameter names are diagnostic; never print its message/body or credentials.
    const body=await response.clone().json().catch(()=>null),safe=v=>typeof v==='string'&&/^[a-z_0-9]{1,80}$/.test(v)?v:null
    providerFailure={status:response.status,code:safe(body?.error?.code),type:safe(body?.error?.type),parameter:safe(body?.error?.param)}
   }
   // Node fetch decodes the wire body; do not tell workerd to decode it again.
   const headers=new Headers(response.headers);for(const name of ['content-encoding','content-length','transfer-encoding','connection'])headers.delete(name)
   return new Response(response.body,{status:response.status,headers})
  }
  liveStage='synthetic analytics setup'
  await a.clock(now)
  const siteId=await a.addSite({paths:[],retainForever:true,goals:{purchase:'/thanks'}});await seed(a,siteId);await a.clock(now)
  assert.equal((await a.post('/api/vane/ask-settings',{siteId,enabled:true},a.owner)).status,200)
  const created=await a.form({operation:'apikey.create',kind:'stats',label:'Live sandbox',...{['site_'+siteId]:'on'}},a.owner)
  const key=(await created.text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)?.[1]
  assert.ok(key,'Create a site-scoped Stats API key for independent figure parity.')
  const parity=async answer=>{
   assert.equal(answer.kind,'answer')
   const response=await a.request(answer.api,{headers:{authorization:'Bearer '+key}})
   assert.equal(response.status,200)
   assert.deepEqual(answer.stats,await response.json(),'Every numeric answer equals the shown Stats API query.')
  }
  for(const [question,expected] of Object.entries(SCRIPT)) {
   liveStage='synthetic question '+(receipt.questions.length+1)
   const response=await a.post('/api/vane/ask',{siteId,question},a.owner)
   if(response.status!==200) {
    const refused=await response.json().catch(()=>null)
    const code=['ask_plan','ask_model','ask_limit','ask_disabled'].includes(refused?.error)?refused.error:'unexpected_response'
    const kind=refused?.message?.match(/did not answer \(([a-z ]+)\)/)?.[1]?.replaceAll(' ','_');providerFailure={...providerFailure,calls:receipt.calls,kind:kind??'unclassified',planReason:refused?.error==='ask_plan'?refused?.message:null}
    throw new Error(`public response ${response.status}, ${code}`)
   }
   const answer=await response.json()
   assert.equal(answer.kind,expected.kind==='query'?'answer':expected.kind,'The live model must distinguish answers, ambiguity and refusals.')
   if(answer.kind==='answer') {
    await parity(answer)
    for(const metric of requiredMetrics[question]??expected.query.metrics)assert.ok(answer.query.metrics.includes(metric),'The translated plan includes each requested metric.')
    assert.equal(answer.query.dimension,expected.query.dimension)
    // Compare the effective business range, not whether the model used a preset or equivalent dates.
    const expectedParams=new URLSearchParams({site_id:siteId,metrics:expected.query.metrics.join(',')})
    for(const field of ['period','from','to','compare','dimension'])if(expected.query[field]!==undefined)expectedParams.set(field,expected.query[field])
    for(const filter of expected.query.filters)expectedParams.append('filter',filter)
    const expectedResponse=await a.request('/api/v1/stats?'+expectedParams,{headers:{authorization:'Bearer '+key}})
    assert.equal(expectedResponse.status,200);const expectedStats=await expectedResponse.json()
    assert.deepEqual(answer.range,{from:expectedStats.from,to:expectedStats.to,timeZone:expectedStats.time_zone},'The translated query uses the requested dates.')
    assert.equal(answer.query.compare,expected.query.compare)
    assert.deepEqual([...answer.query.filters].sort(),[...expected.query.filters].sort())
   } else if(answer.kind==='clarify') {
    assert.ok(answer.choices.length>=2&&answer.choices.length<=4)
    const calls=receipt.calls
    const picked=await a.post('/api/vane/ask',{siteId,query:answer.choices[0].query},a.owner)
    assert.equal(picked.status,200);await parity(await picked.json());assert.equal(receipt.calls,calls)
   } else {assert.equal(answer.reason,expected.reason);assert.ok(answer.explanation);assert.equal(answer.stats,undefined)}
   receipt.questions.push({question,kind:answer.kind,...(answer.kind==='answer'?{query:answer.query,api:answer.api,figures:answer.stats.results}:answer.kind==='clarify'?{choices:answer.choices.length}:{reason:answer.reason})})
  }
  liveStage='call and custody assertions'
  assert.equal(receipt.calls,Object.keys(SCRIPT).length,'Exactly one real model request per question; no repairs or retries.')
  const dump=await a.dump(),audit=dump.vane_audit.filter(row=>row.action==='ask.question')
  assert.equal(audit.length,Object.keys(SCRIPT).length)
  for(const question of Object.keys(SCRIPT))assert.equal(JSON.stringify(dump).includes(question),false,'No question text enters custody.')
  receipt.result='passed'
  console.log(JSON.stringify(receipt,null,2))
 } finally {await a.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try{await live()}catch(error){
  const status=/^public response [0-9]{3}, [a-z_]+$/.test(error.message)?'; '+error.message:''
  if(error.code==='ERR_ASSERTION')console.error('Sandbox assertion: '+error.message.split('\n')[0])
  console.error(`AGENT-007 live sandbox failed at ${liveStage}${status}; no complete receipt. Provider bodies and credentials are withheld.`);if(providerFailure)console.error(JSON.stringify(providerFailure));process.exitCode=1
 }
}
