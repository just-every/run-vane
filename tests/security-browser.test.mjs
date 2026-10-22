import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
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
