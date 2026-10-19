import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

test('REPORT-002 Slack OAuth and Teams workflow: weekly filtered report and alerts, sealed custody, once-per-period outcomes, revocation and scoped roles',async t=>{
 const a=await installation({vars:{SLACK_CLIENT_ID:'fixture-client',SLACK_CLIENT_SECRET:'fixture-client-secret'}});t.after(()=>a.close())
 const id=await a.addSite({paths:[],goals:{signup:'/thanks'},timeZone:'America/New_York',retainForever:true}),other=await a.addSite({origin:'https://other.example',paths:[],goals:{}})
 const op=(operation,p={},cookie=a.owner)=>a.form({operation,siteId:id,...p},cookie),owner={headers:{cookie:a.owner}}
 const generated=[];a.fixtureSites['https://hooks.example']=async request=>{assert.ok(request.headers.get('vane-signature'));generated.push(await request.json());return new Response('ok')}
 const endpoint='https://workflow.example/trigger/private-workflow?sig=fixture-private-signature',token='xoxb-fixture-private-bot-token',sent=[],revokes=[];let revoked=false,workflowStatus=202,authCalls=0
 a.fixtureSites['https://slack.com']=async request=>{
  const url=new URL(request.url);assert.equal(request.method,'POST')
  if(url.pathname==='/api/oauth.v2.access'){
   authCalls++;const body=new URLSearchParams(await request.text());assert.equal(body.get('client_id'),'fixture-client');assert.equal(body.get('client_secret'),'fixture-client-secret');assert.equal(body.get('redirect_uri'),a.origin+'/api/vane/chat/slack/callback')
   return Response.json({ok:true,access_token:token,token_type:'bot',scope:'chat:write',authed_user:{id:'U123'}})
  }
  assert.equal(request.headers.get('authorization'),'Bearer '+token)
  if(url.pathname==='/api/auth.revoke'){revokes.push(true);return Response.json({ok:true,revoked:true})}
  assert.equal(url.pathname,'/api/chat.postMessage');const body=await request.json();assert.equal(body.channel,'C0123456789');sent.push({provider:'slack',body});return Response.json(revoked?{ok:false,error:'token_revoked'}:{ok:true,ts:'123.4'})
 }
 a.fixtureSites['https://workflow.example']=async request=>{assert.equal(request.url,endpoint);const body=await request.json();assert.equal(body.type,'message');assert.equal(body.attachments[0].contentType,'application/vnd.microsoft.card.adaptive');sent.push({provider:'teams',body});return new Response('',{status:workflowStatus,headers:workflowStatus===302?{location:'https://redirect.example/secret'}:{}})}
 const authorization=async response=>{assert.equal(response.status,200,await response.clone().text());const html=await response.text(),url=html.match(/data-slack-authorize href="([^"]+)"/)?.[1];assert.ok(url);return new URL(url.replaceAll('&amp;','&'))}
 const now=Date.parse('2026-10-25T12:00:00Z');await a.clock(now)
 const reader=await a.invite('chat-reader@example.test','member')
 for(const operation of ['chat.slack.begin','chat.teams.connect','chat.schedule','chat.test','chat.disconnect','chat.unschedule']){
  assert.equal((await op(operation,{label:'Marketing',channel:'C0123456789',endpoint},reader)).status,403)
  assert.equal((await op(operation,{label:'Marketing',channel:'C0123456789',endpoint},'')).status,401)
 }
 assert.equal((await a.post('/app/action',{operation:'chat.teams.connect',siteId:id,label:'Marketing',endpoint},a.owner,{origin:'https://foreign.example'})).status,403)
 for(const bad of ['http://workflow.example/hook','https://127.0.0.1/hook','https://10.1.1.1/hook','https://example.local/hook','https://user:pass@workflow.example/hook'])assert.equal((await op('chat.teams.connect',{label:'Marketing',endpoint:bad})).status,400)
 const begin=await op('chat.slack.begin',{label:'Marketing Slack',channel:'C0123456789'});
 const consent=await authorization(begin);assert.equal(consent.origin,'https://slack.com');assert.equal(consent.pathname,'/oauth/v2/authorize');assert.equal(consent.searchParams.get('scope'),'chat:write');assert.equal(consent.searchParams.has('user_scope'),false)
 const callback='/api/vane/chat/slack/callback?'+new URLSearchParams({state:consent.searchParams.get('state'),code:'fixture-code'})
 assert.equal((await a.request(callback,{headers:{cookie:reader}})).status,403)
 const connected=await a.request(callback,owner);assert.equal(connected.status,303,await connected.clone().text());assert.equal((await a.request(callback,owner)).status,400);assert.equal(authCalls,1)
 assert.equal((await op('chat.teams.connect',{label:'Marketing Teams',endpoint})).status,303)
 let dump=await a.dump(),slack=dump.vane_chat_connections.find(c=>c.provider==='slack'),teams=dump.vane_chat_connections.find(c=>c.provider==='teams')
 assert.equal(dump.vane_chat_connections.length,2)
 for(const secret of [token,endpoint,'fixture-private-signature'])assert.equal(JSON.stringify(dump).includes(secret),false,'no plaintext connection credential enters storage')
 // A site-bound segment narrows both the report figures and its native deep link.
 assert.equal((await op('segment.save',{name:'Email campaign',filters:'source:is:newsletter'})).status,303)
 dump=await a.dump();const segment=dump.vane_segments[0].id
 await a.clock(Date.parse('2026-10-28T16:00:00Z'))
 for(const [i,source,path] of [[1,'newsletter','/thanks'],[2,'newsletter','/'],[3,'direct','/']])assert.equal((await a.post('/api/vane/collect',a.event(id,{source:'direct',utm:{source},path}),'',{origin:'https://fern.example','cf-connecting-ip':`198.51.100.${i}`,'user-agent':'Mozilla/5.0'})).status,202)
 await a.clock(Date.parse('2026-11-01T12:00:00Z'))
 assert.equal((await op('webhook.create',{url:'https://hooks.example/ingest',['event_report.generated']:'on'})).status,200)
 for(const c of [slack,teams]){const r=await op('chat.schedule',{connectionId:c.id,segment,frequency:'weekly',weekday:1,hour:8});assert.equal(r.status,303,await r.clone().text())}
 await a.clock(Date.parse('2026-11-02T12:59:00Z'));await a.scheduled();assert.equal(sent.length,0,'weekly Monday report waits for 8am New York after the DST change')
 await a.clock(Date.parse('2026-11-02T13:00:00Z'));await a.scheduled();assert.equal(sent.length,2)
 const text=s=>s.provider==='slack'?s.body.text:s.body.attachments[0].content.body[0].text
 const link=s=>s.provider==='slack'?s.body.text.split('Open Vane: ')[1]:s.body.attachments[0].content.actions[0].url
 for(const s of sent){assert.match(text(s),/Visitors: 2 .*visits: 2 .*pageviews: 2 .*goal conversions: 1/s);const url=new URL(link(s));assert.equal(url.origin,a.origin);assert.equal(url.pathname,'/app/sites/'+id);assert.equal(url.searchParams.get('segment'),segment);assert.equal(url.searchParams.get('from'),'2026-10-26');assert.equal(url.searchParams.get('to'),'2026-11-02');assert.equal((await a.request(url.pathname+url.search,owner)).status,200);assert.equal((await a.request(url.pathname+url.search)).status,303)}
 await a.scheduled();assert.equal(generated.length,2);for(const event of generated){assert.equal(event.event,'report.generated');assert.equal(event.site_id,id);assert.equal(Object.hasOwn(event,'visitor'),false)}assert.equal(sent.length,2,'a repeated schedule run never posts the same period twice')
 assert.equal((await op('alert.create',{metric:'pageviews',direction:'above',threshold:0,cooldown:1,['chat_'+slack.id]:'on',['chat_'+teams.id]:'on'})).status,303)
 assert.equal((await a.collect(a.event(id))).status,202);await a.scheduled();assert.equal(sent.length,4)
 for(const s of sent.slice(2)){assert.match(text(s),/Value: 1; bound: 0/);const url=new URL(link(s));assert.equal(url.searchParams.get('from'),'2026-11-02');assert.equal((await a.request(url.pathname+url.search,owner)).status,200)}
 await a.scheduled();assert.equal(sent.length,4,'a crossing is posted once')
 // Analysts may choose only their site's owner-connected destinations; viewers cannot create alerts.
 assert.equal((await a.form({operation:'team.invite',email:'chat-analyst@example.test',role:'analyst',scope:'selected',['site_'+id]:'on'},a.owner)).status,303);const analyst=await a.accept('chat-analyst@example.test')
 assert.equal((await op('alert.create',{metric:'visitors',direction:'above',threshold:99,cooldown:1,['chat_'+slack.id]:'on'},analyst)).status,303)
 assert.equal((await a.form({operation:'alert.create',siteId:other,metric:'visitors',direction:'above',threshold:1,cooldown:1,['chat_'+slack.id]:'on'},a.owner)).status,400)
 assert.equal((await op('alert.create',{metric:'visitors',direction:'above',threshold:99,cooldown:1},reader)).status,403)
 assert.equal((await a.request('/app/sites/'+other+'?section=settings',{headers:{cookie:analyst}})).status,403)
 revoked=true;assert.equal((await op('chat.test',{id:slack.id})).status,303);workflowStatus=401;assert.equal((await op('chat.test',{id:teams.id})).status,303)
 workflowStatus=302;assert.equal((await op('chat.test',{id:teams.id})).status,303);assert.equal(a.egress.some(url=>url.startsWith('https://redirect.example')),false,'workflow redirects are refused, never followed')
 dump=await a.dump();assert.ok(dump.vane_chat_log.some(l=>l.reason.includes('token_revoked')&&l.state==='failed'));assert.ok(dump.vane_chat_log.some(l=>l.reason.includes('HTTP 401')&&l.state==='failed'));assert.ok(dump.vane_chat_log.some(l=>l.reason==='accepted by workflow; channel delivery unconfirmed'))
 const archive=await a.archive();assert.equal(archive.payload.tables.vane_chat_connections,undefined);assert.equal(archive.payload.tables.vane_chat_states,undefined);assert.equal(archive.payload.tables.vane_chat_schedules,undefined)
 const settings='/app/sites/'+id+'?section=settings'
 for(const secret of [token,endpoint,'fixture-private-signature'])for(const value of [JSON.stringify(archive),await(await a.request(settings,owner)).text(),JSON.stringify(dump.vane_chat_log),JSON.stringify(sent)])assert.equal(value.includes(secret),false,'credentials never enter payloads, logs, settings or archives')
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close());const context=await browser.newContext()
 await context.addCookies(a.owner.split('; ').map(pair=>{const[name,...value]=pair.split('=');return{name,value:value.join('='),url:a.origin}}))
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin==='https://slack.com'&&url.pathname==='/oauth/v2/authorize'){assert.equal(url.searchParams.get('scope'),'chat:write');return route.fulfill({contentType:'text/html',body:'<h1>Slack authorization fixture</h1><a href="'+a.origin+'/api/vane/chat/slack/callback?'+new URLSearchParams({state:url.searchParams.get('state'),error:'access_denied'}).toString().replaceAll('&','&amp;')+'">Decline Slack</a>'})}if(url.origin!==a.origin)return route.abort();const r=await a.request(url.pathname+url.search,{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()??undefined});await route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())})})
 const page=await context.newPage(),screens=process.env.VANE_SCREEN_DIR;if(screens)await mkdir(screens,{recursive:true})
 await page.goto(a.origin+settings)
 const connectForm=page.locator('form').filter({has:page.locator('input[name="channel"]')});await connectForm.getByLabel('Slack destination name').fill('Unapproved connection');await connectForm.getByLabel('Slack channel ID').fill('C0123456789');await connectForm.getByRole('button',{name:'Connect Slack',exact:true}).click();for(const width of [1440,390]){await page.setViewportSize({width,height:960});await page.getByRole('heading',{name:'Chat reports',exact:true}).scrollIntoViewIfNeeded();if(screens)await page.screenshot({path:`${screens}/chat-consent-ready-${width}.png`})}await page.getByRole('link',{name:'Continue to Slack',exact:true}).click();await page.getByRole('heading',{name:'Slack authorization fixture'}).waitFor();await page.getByRole('link',{name:'Decline Slack'}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/did not approve/);for(const width of [1440,390]){await page.setViewportSize({width,height:960});if(screens)await page.screenshot({path:`${screens}/chat-consent-refused-${width}.png`})}
 
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});await page.goto(a.origin+settings);await page.getByRole('heading',{name:'Chat reports',exact:true}).scrollIntoViewIfNeeded();await page.locator('#chat-reports').getByRole('button',{name:'Send test',exact:true}).first().click();await page.locator('[data-chat-log]').waitFor();await page.getByRole('heading',{name:'Chat reports',exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(screens)await page.screenshot({path:`${screens}/chat-connections-${width}.png`});await page.getByRole('region',{name:'Chat delivery log',exact:true}).scrollIntoViewIfNeeded();assert.match(await page.locator('[data-chat-log]').innerText(),/token_revoked/);assert.match(await page.locator('[data-chat-log]').innerText(),/accepted by workflow/);if(screens)await page.screenshot({path:`${screens}/chat-outcomes-${width}.png`});await page.getByRole('heading',{name:'Traffic alerts',exact:true}).scrollIntoViewIfNeeded();if(screens)await page.screenshot({path:`${screens}/chat-alerts-${width}.png`})}
 assert.equal((await op('chat.disconnect',{id:slack.id})).status,303);assert.equal(revokes.length,1);assert.equal((await op('chat.disconnect',{id:teams.id})).status,303)
 dump=await a.dump();assert.equal(dump.vane_chat_connections.length,0);assert.equal(dump.vane_chat_schedules.length,0);const count=sent.length;await a.clock(Date.parse('2026-11-09T13:00:00Z'));await a.scheduled();assert.equal(sent.length,count,'disconnect erases credentials and cancels all pending schedules')
 const expire=await op('chat.slack.begin',{label:'Expired',channel:'C0123456789'}),expired=(await authorization(expire)).searchParams.get('state');await a.clock(Date.parse('2026-11-09T13:11:00Z'));assert.equal((await a.request('/api/vane/chat/slack/callback?'+new URLSearchParams({state:expired,code:'fixture-code'}),owner)).status,400);assert.equal(authCalls,1)
})
