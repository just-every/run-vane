import test from 'node:test'
import assert from 'node:assert/strict'
import { installation } from './harness.mjs'
import { oidcInstallation,samlInstallation,enroll,login,otp,session } from './security-fixtures.mjs'

const patch='urn:ietf:params:scim:api:messages:2.0:PatchOp',userSchema='urn:ietf:params:scim:schemas:core:2.0:User'
const scim=(a,path,method='GET',body,token='synthetic-vane-123456789012345678901234')=>a.request('/scim/v2/'+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/scim+json'},...(body?{body:JSON.stringify(body)}:{})})
// Current private HTTP doors, including Base account/dependency administration.
// Primary sign-in, factor ceremonies and sign-out stay reachable by design.
const privateDoors=[
 '/app',...['team','api','agency','audit','history','approvals','alerts'].map(section=>'/app?section='+section),
 ...['heat','proxy-connections','proxy-setup','bing/report','search-console/report','chat/slack/callback','search-console/callback','cutover-scans','import-definitions','agency','sites','summary','csv','site-zip','realtime','inventory','audit','proposals','import-journal','export'].map(path=>'/api/vane/'+path),
 '/auth/session','/auth/operators','/auth/sessions','/auth/providers','/auth/domain-rules','/auth/settings/identity','/auth/dependencies/status','/setup',
]
const privateWrites=[
 '/setup','/app/action','/app/agency/logo',
 ...['agency','heat-settings','commands','proxy-connections','parallel-run','import-preview','import-apply','import-undo','cutover-scan','install-check','site-import','restore','push/subscribe','push/unsubscribe'].map(path=>'/api/vane/'+path),
 ...['bootstrap','invite','invite/cancel','operator/status','operator/role','session/revoke','step-up','domain-rules','providers/unlink','providers/relink','settings/identity','setup-complete','email','display-name','dependencies/relink','dependencies/setup','dependencies/unlink'].map(path=>'/auth/'+path),
]
async function held(a,cookie,mode,extra=[]) {
 const settings=await a.request('/auth/security',{headers:{cookie}});assert.equal(settings.status,mode==='sso'?403:303);if(mode!=='sso')assert.equal(settings.headers.get('location'),'/auth/security/'+mode)
 for(const path of [...privateDoors,...extra]) {
  const r=await a.request(path,{headers:{cookie}})
  if(path.startsWith('/api/')){assert.equal(r.status,403,path);assert.equal((await r.json()).error,mode==='sso'?'sso_required':'second_step_required',path)}
  else {assert.equal(r.status,303,path);assert.equal(r.headers.get('location'),'/auth/security/'+mode,path)}
 }
 for(const path of privateWrites){const r=await a.post(path,{},cookie);assert.equal(r.status,403,path);assert.equal((await r.json()).error,mode==='sso'?'sso_required':'second_step_required',path)}
}


test('organization OIDC signs in Google and Entra members, refuses altered proofs and replay, and fences existing sessions when SSO is required',async t=>{
 const {a,signin,begin}=await oidcInstallation(t)
 const member=await a.invite('member@example.test','member')
 for(const id of ['google','microsoft']) {
  const r=await signin(id,'member@example.test');assert.equal(r.response.status,303,await r.response.clone().text());assert.equal((await session(a,r.nativeCookie)).status,200)
  assert.equal((await a.request(r.callback,{headers:{cookie:r.binding}})).status,400)
 }
 for(const overrides of [{aud:'synthetic-vane-wrong'},{iss:'https://synthetic-vane-foreign.example'},{nonce:'synthetic-vane-wrong'},{exp:1}]) {
  const bad=await signin('google','member@example.test',overrides);assert.equal(bad.response.status,400);assert.equal(bad.nativeCookie.includes('operator_session'),false)
 }
 const unbound=await begin('google','member@example.test');assert.equal((await a.request(unbound.callback)).status,400)
 assert.equal((await a.post('/auth/security/policy',{requireSso:true},a.owner)).status,409)
 const owner=await signin('google','owner@example.test');assert.equal(owner.response.status,303)
 assert.equal((await a.post('/auth/security/policy',{requireSso:true},owner.nativeCookie)).status,303)
 for(const cookie of [a.owner,member])await held(a,cookie,'sso')
 assert.equal((await a.post('/auth/invite',{email:'refused@example.test',role:'member'},a.owner)).status,403)
 assert.equal((await a.post('/auth/security/policy',{},member)).status,403)
 assert.equal((await session(a,owner.nativeCookie)).status,200)
})

test('SAML fixture signs existing invited accounts into native sessions, enforces signed binding constraints and refuses response replay',async t=>{
 const {a,response}=await samlInstallation(t)
 assert.equal((await a.post('/auth/invite',{email:'member@example.test',role:'member',displayName:'Fern analyst'},a.owner)).status,202)
 const valid=await response(),r=await valid.complete();assert.equal(r.status,303,await r.clone().text());const cookie=a.cookieOf(r)
 assert.equal((await session(a,cookie)).status,200);assert.equal((await valid.complete()).status,400)
 for(const overrides of [{recipient:'https://synthetic-vane-foreign.example'},{destination:'https://synthetic-vane-foreign.example'},{audience:'synthetic-vane-wrong'},{expiry:'2000-01-01T00:00:00Z'},{requestId:'synthetic-vane-wrong'},{tamper:true}])assert.equal((await(await response('synthetic-vane-member',overrides)).complete()).status,400,JSON.stringify(overrides))
 const meta=await a.request('/auth/saml/metadata');assert.equal(meta.status,200);assert.ok((await meta.text()).includes(a.origin+'/auth/saml/callback'))
 const owner=await(await response('synthetic-vane-owner')).complete();assert.equal(owner.status,303)
 assert.equal((await a.post('/auth/security/policy',{requireSso:true},a.cookieOf(owner))).status,303)
 assert.equal((await session(a,a.owner)).status,303);assert.equal((await session(a,cookie)).status,200)
})

test('SCIM provisions zero-site viewers and deprovisioning immediately ends native, OIDC and SAML access without removing the owner',async t=>{
 for(const kind of ['oidc','saml']) {
  const fx=kind==='oidc'?await oidcInstallation(t):await samlInstallation(t),{a}=fx
  await a.addSite({name:'Fern Studio',paths:[]})
  const provision=await scim(a,'Users','POST',{schemas:[userSchema],userName:'member@example.test',externalId:'synthetic-vane-2',active:true});assert.equal(provision.status,201,await provision.clone().text());const person=await provision.json();assert.equal(person.active,true)
  assert.equal((await scim(a,'Users','POST',{schemas:[userSchema],userName:'owner@example.test'})).status,409)
  const native=await login(a,'member@example.test');assert.deepEqual(await(await a.request('/api/vane/sites',{headers:{cookie:native}})).json(),[])
  assert.equal((await a.form({operation:'team.grant',operatorId:person.id,role:'viewer',scope:'all'},a.owner)).status,303)
  assert.equal((await(await a.request('/api/vane/sites',{headers:{cookie:native}})).json()).length,1)
  const signed=kind==='oidc'?(await fx.signin('google','member@example.test')).response:await(await fx.response()).complete();assert.equal(signed.status,303)
  const cookie=a.cookieOf(signed);assert.equal((await session(a,cookie)).status,200)
  assert.equal((await scim(a,'Users/'+person.id,'PATCH',{schemas:[patch],Operations:[{op:'replace',path:'active',value:false}]},'synthetic-vane-wrong')).status,401)
  assert.equal((await scim(a,'Users/'+person.id,'PATCH',{schemas:[patch],Operations:[{op:'replace',value:{active:false}}]})).status,200)
  for(const held of [native,cookie])for(const path of ['/auth/session','/api/vane/sites'])assert.equal((await a.request(path,{headers:{cookie:held}})).status,401)
  const owner=await(await session(a,a.owner)).json();assert.equal((await scim(a,'Users/'+owner.operator.id,'DELETE')).status,404)
  assert.equal((await scim(a,'Users/'+person.id,'PATCH',{schemas:[patch],Operations:[{op:'replace',path:'active',value:true}]})).status,400)
  const retry=kind==='oidc'?(await fx.signin('google','member@example.test')).response:await(await fx.response()).complete();assert.equal(retry.status,kind==='oidc'?403:400)
 }
})

test('authenticator sign-in refuses wrong and replayed codes, consumes a recovery code once, and excludes credentials from analytics archives',async t=>{
 const a=await installation();t.after(()=>a.close());const email='member@example.test',member=await a.invite(email,'member'),{secret,codes}=await enroll(a,member)
 let cookie=await login(a,email)
 await held(a,cookie,'challenge')
 assert.equal((await a.post('/auth/security/verify',{code:'wrong'},cookie)).status,403)
 assert.equal((await a.post('/auth/security/verify',{code:otp(secret,Math.floor(Date.now()/30000)+1)},cookie)).status,303)
 assert.equal((await session(a,cookie)).status,200)
 cookie=await login(a,email)
 assert.equal((await a.post('/auth/security/verify',{code:codes[0]},cookie)).status,303)
 cookie=await login(a,email)
 assert.equal((await a.post('/auth/security/verify',{code:codes[0]},cookie)).status,403)
 const archive=await a.archive();assert.equal(Object.keys(archive.payload.tables).some(k=>/^vane_(totp|second_step|security|saml|scim)_/.test(k)),false)
 const text=JSON.stringify(await a.dump());assert.equal(text.includes(secret),false);assert.equal(text.includes(codes[0]),false)
})

test('owner enforcement holds every account without a factor at enrollment, refuses private mutations and enrolls it before authenticator sign-in',async t=>{
 const a=await installation();t.after(()=>a.close());const member=await a.invite('member@example.test','member'),other=await a.invite('other@example.test','admin')
 const site=await a.addSite({name:'Fern Studio',paths:[]}),keyPage=await(await a.form({operation:'apikey.create',kind:'stats',label:'Team reporting',[`site_${site}`]:'on'},other)).text(),key=keyPage.match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1]
 const stats=()=>a.request(`/api/v1/stats?site_id=${site}`,{headers:{authorization:'Bearer '+key}});assert.equal((await stats()).status,200)
 const secondSite=await a.addSite({name:'Oak Books',origin:'https://oak.example',paths:[]})
 const createdRollup=await a.form({operation:'rollup.create',name:'Fern and Oak report',[`site_${site}`]:'on',[`site_${secondSite}`]:'on'},a.owner);assert.equal(createdRollup.status,303);const rollupPath=createdRollup.headers.get('location');assert.match(rollupPath,/^\/app\/rollups\//);assert.equal((await a.request(rollupPath,{headers:{cookie:a.owner}})).status,200)
 assert.equal((await a.post('/auth/security/policy',{requireSecond:true},a.owner)).status,409)
 await enroll(a,a.owner);assert.equal((await a.post('/auth/security/policy',{requireSecond:true},a.owner)).status,303)
 for(const cookie of [member,other])await held(a,cookie,'enroll',[rollupPath,`/app/sites/${site}`, ...['settings','realtime','heat','history','approvals'].map(section=>`/app/sites/${site}?section=${section}`)])
 for(const [method,path] of [['GET',`/api/v1/stats?site_id=${site}`],...['/api/v1/events','/api/v1/mcp','/api/v2/query','/api/v1/sites',`/api/v1/sites/${site}/goals`,`/api/v1/sites/${site}/shared-links`].map(path=>['POST',path])]){const r=await a.request(path,{method,headers:{authorization:'Bearer '+key,'content-type':'application/json'},...(method==='POST'?{body:'{}'}:{})});assert.equal(r.status,403,path);assert.equal((await r.json()).error,'second_step_required',path)}
 await enroll(a,other);assert.equal((await stats()).status,200)
 assert.equal((await a.post('/app/action',{operation:'site.create'},member)).status,403)
 assert.equal((await a.post('/auth/security/identity',{},member)).status,303)
 const {secret}=await enroll(a,member);assert.equal((await a.request('/api/vane/sites',{headers:{cookie:member}})).status,200)
 const signed=await login(a,'member@example.test');assert.equal((await a.request('/api/vane/sites',{headers:{cookie:signed}})).status,403)
 assert.equal((await a.post('/auth/security/verify',{code:otp(secret,Math.floor(Date.now()/30000)+1)},signed)).status,303)
 assert.equal((await a.request('/api/vane/sites',{headers:{cookie:signed}})).status,200)
 assert.equal((await a.post('/auth/security/policy',{},a.owner,{origin:'https://foreign.example'})).status,403)
})
