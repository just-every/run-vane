import test from 'node:test'
import assert from 'node:assert/strict'
import { installation } from './harness.mjs'
import { oidcInstallation,samlInstallation,enroll,login,otp,session } from './security-fixtures.mjs'

const patch='urn:ietf:params:scim:api:messages:2.0:PatchOp',userSchema='urn:ietf:params:scim:schemas:core:2.0:User'
const scim=(a,path,method='GET',body,token='synthetic-vane-1')=>a.request('/scim/v2/'+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/scim+json'},...(body?{body:JSON.stringify(body)}:{})})
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
 assert.deepEqual((await a.dump()).vane_security_policy,[])
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
 const changed=await a.dump();assert.deepEqual(changed.vane_security_policy,[{singleton:1,require_sso:1,require_second:0}]);assert.equal(changed.vane_audit.filter(item=>item.action==='security.policy'&&item.actor===changed.oa_operators.find(p=>p.role==='owner').id).length,1)
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

test('SCIM credentials are owner-issued once, hashed, isolated from native and API authority, rotatable and revocable with audit',async t=>{
 const {a,issuer}=await oidcInstallation(t),member=await a.invite('member@example.test','member')
 for(const cookie of ['',member])for(const action of ['issue','revoke'])assert.equal((await a.post('/auth/security/scim/'+action,{issuer},cookie)).status,cookie?403:401)
 assert.equal((await a.post('/auth/security/scim/issue',{issuer:'https://synthetic-vane-foreign.example'},a.owner)).status,400)
 assert.equal((await a.post('/auth/security/scim/issue',{issuer},a.owner,{origin:'https://synthetic-vane-foreign.example'})).status,403)
 assert.equal((await scim(a,'ServiceProviderConfig')).status,401)
 const issue=async()=>{const r=await a.post('/auth/security/scim/issue',{issuer},a.owner);assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');return (await r.json()).credential}
 const first=await issue();assert.equal(typeof first,'string');assert.equal((await scim(a,'ServiceProviderConfig','GET',undefined,first)).status,200)
 assert.equal((await a.request('/api/v1/stats?site_id=synthetic-vane-1',{headers:{authorization:'Bearer '+first}})).status,401)
 assert.equal((await a.post('/auth/invite',{email:'synthetic-vane-1@example.test'},'',{authorization:'Bearer '+first})).status,401)
 assert.equal((await a.post('/auth/security/break-glass',{confirm:'disable-sso'},'',{authorization:'Bearer '+first})).status,401)
 const settings=await(await a.request('/auth/security',{headers:{cookie:a.owner}})).text();assert.equal(settings.includes(first),false)
 const second=await issue();assert.notEqual(second,first);assert.equal((await scim(a,'ServiceProviderConfig','GET',undefined,first)).status,401);assert.equal((await scim(a,'ServiceProviderConfig','GET',undefined,second)).status,200)
 let dump=await a.dump();assert.equal(JSON.stringify(dump).includes(first),false);assert.equal(JSON.stringify(dump).includes(second),false);assert.ok(dump.vane_scim_credentials[0].token_hash)
 assert.equal((await a.post('/auth/security/scim/revoke',{issuer},a.owner)).status,200);assert.equal((await scim(a,'ServiceProviderConfig','GET',undefined,second)).status,401)
 assert.equal((await a.post('/auth/security/scim/revoke',{issuer},a.owner)).status,200)
 dump=await a.dump();assert.deepEqual(dump.vane_audit.filter(v=>v.action.startsWith('security.scim.')).map(v=>v.action),['security.scim.issue','security.scim.rotate','security.scim.revoke'])
 assert.equal(JSON.stringify(await a.archive()).includes(second),false)
})

test('SCIM provisions bound zero-site Viewers without mail or email merges and never grants sites or raises roles',async t=>{
 for(const kind of ['oidc','saml']) {
  const fx=kind==='oidc'?await oidcInstallation(t):await samlInstallation(t),{a,issuer}=fx
  const issued=await a.post('/auth/security/scim/issue',{issuer},a.owner);assert.equal(issued.status,200);const token=(await issued.json()).credential
  const send=(path,method='GET',body)=>scim(a,path,method,body,token),input={schemas:[userSchema],userName:'member@example.test',externalId:'synthetic-vane-member',active:true}
  const site=await a.addSite({name:'Fern Studio',paths:[]}),mail=a.sentMail.length
  const provision=await send('Users','POST',input);assert.equal(provision.status,201,await provision.clone().text());const person=await provision.json();assert.equal(person.active,true);assert.equal(a.sentMail.length,mail)
  const before=await a.dump(),binding=before.oa_external_identities.find(p=>p.operator_id===person.id);assert.deepEqual(binding,{issuer,subject:input.externalId,operator_id:person.id})
  const replay=await send('Users','POST',input);assert.equal(replay.status,200);assert.equal((await replay.json()).id,person.id)
  const after=await a.dump();for(const table of ['oa_operators','oa_external_identities','vane_grants','vane_scim_users','vane_audit'])assert.deepEqual(after[table],before[table],table)
  for(const extra of [{roles:['admin']},{groups:['synthetic-vane-1']},{siteIds:[site]}])assert.equal((await send('Users','POST',{...input,...extra})).status,400)
  for(const body of [{...input,userName:'owner@example.test',externalId:'synthetic-vane-owner'},{...input,externalId:'synthetic-vane-other'},{...input,userName:'synthetic-vane-other@example.test'}])assert.equal((await send('Users','POST',body)).status,409)
  assert.equal((await a.post('/auth/invite',{email:'invited@example.test',role:'member',displayName:'Invited analyst'},a.owner)).status,202);assert.equal((await send('Users','POST',{...input,userName:'invited@example.test',externalId:'synthetic-vane-invited'})).status,409)
  assert.equal((await a.dump()).oa_operators.find(p=>p.email==='invited@example.test').status,'invited')
  const native=await login(a,input.userName);assert.equal((await(await session(a,native)).json()).operator.role,'member');assert.deepEqual(await(await a.request('/api/vane/sites',{headers:{cookie:native}})).json(),[])
  assert.equal((await a.post('/api/vane/commands',{command:'site.create',input:{name:'Synthetic site',origin:'https://synthetic-vane-2.example'}},native)).status,403)
  const signed=kind==='oidc'?(await fx.signin('google',input.userName)).response:await(await fx.response()).complete();assert.equal(signed.status,303,await signed.clone().text());assert.equal((await session(a,a.cookieOf(signed))).status,200)
  if(kind==='oidc'){
   const altered=await fx.signin('google',input.userName,{sub:'synthetic-vane-other'});assert.equal(altered.response.status,403)
   const foreign=await fx.signin('microsoft',input.userName);assert.equal(foreign.response.status,403)
   const scoped=await a.post('/auth/security/scim/issue',{issuer:'https://login.microsoftonline.com/synthetic-vane-1/v2.0'},a.owner);const other=(await scoped.json()).credential
   assert.equal((await scim(a,'Users/'+person.id,'GET',undefined,other)).status,404)
   assert.equal((await scim(a,'Users/'+person.id,'DELETE',undefined,other)).status,404)
  }
  const admin=await a.invite('admin@example.test','admin');assert.equal((await a.form({operation:'team.grant',operatorId:person.id,role:'viewer',scope:'all'},admin)).status,403)
  assert.equal((await a.form({operation:'team.grant',operatorId:person.id,role:'viewer',scope:'all'},a.owner)).status,303)
  assert.equal((await(await a.request('/api/vane/sites',{headers:{cookie:native}})).json()).length,1)
  const granted=await a.dump();assert.equal((await send('Users','POST',input)).status,200);assert.deepEqual((await a.dump()).vane_grants,granted.vane_grants)
 }
})

test('SCIM deactivation ends native and federated sessions, API keys and push tokens on the next request; replays and owner removal never reactivate',async t=>{
 for(const kind of ['oidc','saml']) {
  const fx=kind==='oidc'?await oidcInstallation(t):await samlInstallation(t),{a,issuer}=fx
  const issued=await a.post('/auth/security/scim/issue',{issuer},a.owner),token=(await issued.json()).credential,send=(path,method='GET',body)=>scim(a,path,method,body,token)
  const input={schemas:[userSchema],userName:'member@example.test',externalId:'synthetic-vane-member',active:true}
  const provision=await send('Users','POST',input);assert.equal(provision.status,201);const person=await provision.json(),site=await a.addSite({name:'Fern Studio',paths:[]})
  assert.equal((await a.form({operation:'team.grant',operatorId:person.id,role:'viewer',scope:'all'},a.owner)).status,303)
  assert.equal((await a.post('/auth/operator/role',{operatorId:person.id,role:'admin'},a.owner)).status,200)
  const native=await login(a,input.userName),signed=kind==='oidc'?(await fx.signin('google',input.userName)).response:await(await fx.response()).complete();assert.equal(signed.status,303);const federated=a.cookieOf(signed)
  const keys={};for(const keyKind of ['stats','events']){const r=await a.form({operation:'apikey.create',kind:keyKind,label:'Synthetic reporting',[`site_${site}`]:'on'},native);assert.equal(r.status,200);keys[keyKind]=(await r.text()).match(/data-api-key>([^<]+)</)[1]}
  const stats=()=>a.request(`/api/v1/stats?site_id=${site}`,{headers:{authorization:'Bearer '+keys.stats}})
  const events=()=>a.post('/api/v1/events',{id:crypto.randomUUID(),path:'/',client_ip:'192.0.2.1',user_agent:'Mozilla/5.0 synthetic-vane-1'},'',{authorization:'Bearer '+keys.events})
  assert.equal((await stats()).status,200);assert.equal((await events()).status,200)
  const point=Buffer.alloc(65,1);point[0]=4
  assert.equal((await a.post('/api/vane/push/subscribe',{endpoint:'https://synthetic-vane-1.example/push',keys:{p256dh:point.toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}},native)).status,201)
  assert.equal((await a.post('/auth/magic-link',{email:input.userName})).status,202)
  const link=a.sentMail.findLast(m=>JSON.stringify(m.to).includes(input.userName)).html.match(/href="([^" ]*\/auth\/confirm\?token=[^"]+)"/)[1],pending=new URL(link.replaceAll('&amp;','&'),a.origin).searchParams.get('token')
  assert.equal((await scim(a,'Users/'+person.id,'PATCH',{schemas:[patch],Operations:[{op:'replace',path:'active',value:false}]})).status,401)
  assert.equal((await send('Users/'+person.id,'PATCH',{schemas:[patch],Operations:[{op:'replace',value:{active:false}}]})).status,200)
  for(const cookie of [native,federated])for(const path of ['/auth/session','/api/vane/sites'])assert.equal((await a.request(path,{headers:{cookie}})).status,401)
  assert.equal((await stats()).status,401);assert.equal((await events()).status,401);assert.equal((await a.post('/auth/confirm',{token:pending})).status,400)
  let dump=await a.dump();assert.equal(dump.vane_push_subscriptions.some(s=>s.operator_id===person.id),false)
  const before={person:dump.oa_operators.find(p=>p.id===person.id),scim:dump.vane_scim_users,audit:dump.vane_audit,keys:dump.vane_api_keys}
  assert.equal((await send('Users/'+person.id,'DELETE')).status,204)
  assert.equal((await send('Users/'+person.id,'PATCH',{schemas:[patch],Operations:[{op:'replace',path:'active',value:false}]})).status,200)
  const replay=await send('Users','POST',input);assert.equal(replay.status,200);assert.equal((await replay.json()).active,false)
  assert.equal((await send('Users/'+person.id,'PATCH',{schemas:[patch],Operations:[{op:'replace',path:'active',value:true}]})).status,400)
  dump=await a.dump();assert.deepEqual({person:dump.oa_operators.find(p=>p.id===person.id),scim:dump.vane_scim_users,audit:dump.vane_audit,keys:dump.vane_api_keys},before)
  const retry=kind==='oidc'?(await fx.signin('google',input.userName)).response:await(await fx.response()).complete();assert.equal(retry.status,kind==='oidc'?403:400)
  const owner=(await(await session(a,a.owner)).json()).operator;assert.equal((await send('Users/'+owner.id,'DELETE')).status,404)
  const removed={...input,userName:'removed@example.test',externalId:'synthetic-vane-removed'},second=await send('Users','POST',removed);assert.equal(second.status,201);const secondPerson=await second.json()
  assert.equal((await a.form({operation:'team.remove',operatorId:secondPerson.id},a.owner)).status,303)
  const removal=await a.dump(),late=await send('Users','POST',removed);assert.equal(late.status,200);assert.equal((await late.json()).active,false)
  assert.equal((await send('Users/'+secondPerson.id,'DELETE')).status,204)
  dump=await a.dump();for(const table of ['oa_operators','vane_scim_users','vane_grants','vane_audit'])assert.deepEqual(dump[table],removal[table],table)
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
 assert.deepEqual((await a.dump()).vane_security_policy,[])
 const site=await a.addSite({name:'Fern Studio',paths:[]}),keyPage=await(await a.form({operation:'apikey.create',kind:'stats',label:'Team reporting',[`site_${site}`]:'on'},other)).text(),key=keyPage.match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1]
 const stats=()=>a.request(`/api/v1/stats?site_id=${site}`,{headers:{authorization:'Bearer '+key}});assert.equal((await stats()).status,200)
 const secondSite=await a.addSite({name:'Oak Books',origin:'https://oak.example',paths:[]})
 const createdRollup=await a.form({operation:'rollup.create',name:'Fern and Oak report',[`site_${site}`]:'on',[`site_${secondSite}`]:'on'},a.owner);assert.equal(createdRollup.status,303);const rollupPath=createdRollup.headers.get('location');assert.match(rollupPath,/^\/app\/rollups\//);assert.equal((await a.request(rollupPath,{headers:{cookie:a.owner}})).status,200)
 assert.equal((await a.post('/auth/security/policy',{requireSecond:true},a.owner)).status,409)
 await enroll(a,a.owner);assert.equal((await a.post('/auth/security/policy',{requireSecond:true},a.owner)).status,303)
 const policy=await a.dump();assert.deepEqual(policy.vane_security_policy,[{singleton:1,require_sso:0,require_second:1}]);assert.equal(policy.vane_audit.filter(item=>item.action==='security.policy'&&item.actor===policy.oa_operators.find(p=>p.role==='owner').id).length,1)
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
