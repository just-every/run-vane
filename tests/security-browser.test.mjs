import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { randomBytes,createHash } from 'node:crypto'
import { browse } from './vane-helpers.mjs'
import { samlInstallation,otp,login,enroll } from './security-fixtures.mjs'

// A native HTTP bridge retains every Set-Cookie header and ordinary redirect.
// All application behavior still runs in the built Worker; only the IdP/mail edges are fixtures.
test('members enroll and challenge in a real browser; owner requirements and SAML sign-in render at 1440 and 390',async t=>{
 let a,response
 const server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const response=await a.request(req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});res.writeHead(response.status,{...Object.fromEntries(response.headers),'set-cookie':response.headers.getSetCookie()});res.end(Buffer.from(await response.arrayBuffer()))}catch(error){res.destroy(error)}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{const closed=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closed})
 ;({a,response}=await samlInstallation(t,{origin:`http://127.0.0.1:${server.address().port}`}));a.servesHttp=true
 const member=await a.invite('member@example.test','member'),other=await a.invite('other@example.test','member')
 const site=await a.addSite({name:'Fern Studio',paths:[]});for(let i=0;i<12;i++)assert.equal((await a.collect(a.event(site,{path:i%3?'/':'/pricing'}))).status,202)
 const {context}=await browse(t,a),page=await context.newPage(),screens=process.env.VANE_SCREEN_DIR
 if(screens)await mkdir(screens,{recursive:true})
 async function use(cookie) {await context.clearCookies();await context.addCookies(cookie.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))}
 async function shot(name,width) {assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(screens)await page.screenshot({path:`${screens}/${name}-${width}.png`,fullPage:true})}
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:960});await use(a.owner)
  await page.goto(a.origin+'/auth/security');await page.getByRole('heading',{name:'Sign-in security',exact:true}).waitFor();await shot('security-settings',width)
  await page.getByRole('button',{name:/Issue SCIM credential|Rotate SCIM credential/}).first().click();await page.getByRole('heading',{name:'Save your SCIM credential'}).waitFor();await shot('security-scim-credential',width)
  await page.getByRole('link',{name:'I saved my credential'}).click();await shot('security-scim-active',width)
  await page.getByRole('button',{name:'Revoke SCIM credential'}).first().click();await shot('security-scim-revoked',width)
  await page.goto(a.origin+'/app?section=team');await page.getByRole('heading',{name:'Team',exact:true}).first().waitFor();await shot('security-team',width)
  await context.clearCookies();await page.goto(a.origin+'/signin');await page.getByRole('button',{name:'Continue with SAML'}).waitFor();await shot('security-signin',width)
 }
 await use(member)
 await page.goto(a.origin+'/auth/security');await page.getByRole('button',{name:'Set up authenticator'}).click()
 const secret=await page.locator('code').innerText();assert.match(secret,/^[A-Z2-7]{32}$/)
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});await shot('security-enrollment',width)}
 await page.getByLabel('Authenticator or recovery code').fill(otp(secret));await page.getByRole('button',{name:'Confirm authenticator'}).click();await page.getByRole('heading',{name:'Save your recovery codes'}).waitFor()
 const recovery=await page.locator('code').first().innerText()
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});await shot('security-recovery',width)}
 await page.getByRole('link',{name:'I saved my codes'}).click();await page.getByRole('heading',{name:'Your sites',exact:true}).waitFor()
 const next=await login(a,'member@example.test');await use(next);await page.goto(a.origin+'/app');await page.getByRole('heading',{name:'Confirm your second step'}).waitFor()
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});await shot('security-challenge',width)}
 await page.getByLabel('Authenticator or recovery code').fill('wrong');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('alert').waitFor()
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});await shot('security-refusal',width)}
 await page.getByLabel('Authenticator or recovery code').fill(recovery);await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'Your sites',exact:true}).waitFor()
 // Require SSO through the owner's proven SAML route, then inspect the held native account.
 const ownerFactor=await enroll(a,a.owner);assert.equal((await a.post('/auth/security/policy',{requireSecond:true},a.owner)).status,303)
 await use(other);await page.goto(a.origin+'/app');await page.getByRole('heading',{name:'Set up your authenticator'}).waitFor()
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});await shot('security-enrollment-required',width)}
 const ownerSaml=await(await response('synthetic-vane-owner')).complete();assert.equal(ownerSaml.status,303)
 assert.equal((await a.post('/auth/security/verify',{code:ownerFactor.codes[0]},a.cookieOf(ownerSaml))).status,303)
 assert.equal((await a.post('/auth/security/policy',{requireSso:true,requireSecond:true},a.cookieOf(ownerSaml))).status,303)
 await use(a.owner);await page.goto(a.origin+'/app');await page.getByRole('heading',{name:'Single sign-on required'}).waitFor()
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});await shot('security-sso-required',width)}
})

test('owner outage recovery requires a deployment-issued owner link, preserves the second step and audits one recovery at 1440 and 390',async t=>{
 const {a,response}=await samlInstallation(t),member=await a.invite('member@example.test','member')
 await a.addSite({name:'Fern Studio',paths:[]})
 const factor=await enroll(a,a.owner),owner=await(await response('synthetic-vane-owner')).complete(),ssoCookie=a.cookieOf(owner)
 assert.equal((await a.post('/auth/security/verify',{code:factor.codes[0]},ssoCookie)).status,303)
 assert.equal((await a.post('/auth/security/policy',{requireSso:true,requireSecond:true},ssoCookie)).status,303)
 for(const cookie of [a.owner,member])for(const method of ['GET','POST'])assert.equal((await a.request('/auth/security/break-glass',{method,headers:{cookie,origin:a.origin,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({confirm:'disable-sso'})}:{})})).status,403)
 // A fake at the deployment D1 edge mints the same one-use owner grant as rer
 // signin; admission and recovery themselves run through the real HTTP doors.
 const grant=randomBytes(32).toString('base64url'),now=Date.now(),person=(await(await a.request('/auth/session',{headers:{cookie:ssoCookie}})).json()).operator
 const hash=createHash('sha256').update('owner-signin\0'+grant).digest('hex')
 await a.inspectDb.prepare('INSERT INTO oa_owner_signins(id,token_hash,operator_id,operator_version,created_at,expires_at) SELECT ?,?,id,version,?,? FROM oa_operators WHERE id=?').bind(crypto.randomUUID(),hash,now,now+900000,person.id).run()
 const admitted=await a.post('/auth/owner-signin',{token:grant});assert.equal(admitted.status,303,await admitted.clone().text());const recoveryCookie=a.cookieOf(admitted)
 assert.equal((await a.post('/auth/owner-signin',{token:grant})).status,400)
 assert.equal((await a.request('/api/vane/sites',{headers:{cookie:recoveryCookie}})).status,403)
 const {context}=await browse(t,a),page=await context.newPage(),screens=process.env.VANE_SCREEN_DIR
 if(screens)await mkdir(screens,{recursive:true})
 await context.addCookies(recoveryCookie.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 async function shots(name) {for(const width of [1440,390]){await page.setViewportSize({width,height:960});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(screens)await page.screenshot({path:`${screens}/${name}-${width}.png`,fullPage:true})}}
 await page.goto(a.origin+'/auth/security/break-glass');await page.getByRole('heading',{name:'Owner outage recovery'}).waitFor();await shots('security-break-glass')
 await page.getByLabel('Authenticator or recovery code').fill('wrong');await page.getByRole('button',{name:'Disable SSO for outage recovery'}).click();await page.getByRole('alert').waitFor();await shots('security-break-glass-refusal')
 assert.equal((await a.request('/api/vane/sites',{headers:{cookie:a.owner}})).status,403)
 await page.getByLabel('Authenticator or recovery code').fill(factor.codes[1]);await page.getByRole('button',{name:'Disable SSO for outage recovery'}).click();await page.getByRole('heading',{name:'Sign-in security',exact:true}).waitFor();await shots('security-break-glass-complete')
 assert.equal(await page.getByLabel('Require single sign-on',{exact:true}).isChecked(),false);assert.equal(await page.getByLabel('Require an authenticator second step',{exact:true}).isChecked(),true)
 assert.equal((await a.request('/api/vane/sites',{headers:{cookie:recoveryCookie}})).status,200)
 assert.equal((await a.request('/api/vane/sites',{headers:{cookie:member}})).status,403)
 assert.equal((await a.post('/auth/security/break-glass',{confirm:'disable-sso'},recoveryCookie)).status,303)
 const dump=await a.dump();assert.equal(dump.vane_audit.filter(item=>item.action==='security.break-glass').length,1)
 await a.inspectDb.prepare("UPDATE oa_step_up_challenges SET created_at=? WHERE session_id=(SELECT id FROM oa_sessions WHERE operator_id=? ORDER BY created_at DESC LIMIT 1) AND action='owner:signin-link'").bind(now-900001,person.id).run()
 assert.equal((await a.request('/auth/security/break-glass',{headers:{cookie:recoveryCookie}})).status,403)
})
