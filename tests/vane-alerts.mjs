import test from 'node:test'
import { assert, readFile, createHash, createHmac, crc32, createRequire, installation, appsScript, fixture, unlinked, withApp, DESKTOP_CHROME, browse, movein } from './vane-helpers.mjs'

test('REPORT-001 two weekly subscribers get the Monday 8:00 New York report once each across a daylight-saving change with the dashboard\'s figures, one-click unsubscribe stops it, temporary failures retry after 15 minutes and 2 hours, four failures show as failed, a rejected message is not retried, and later signed provider bounces and complaints show on the sends and stop further reports to that address',async t=>{
 const key=`whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')}`,a=await installation({vars:{MAIL_WEBHOOK_KEY:key}});t.after(()=>a.close())
 const owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],timeZone:'America/New_York',goals:{signup:'/thanks'}})
 for(const [n,at,path] of [[1,'2026-02-24T15:00:00Z','/'],[2,'2026-02-25T16:00:00Z','/pricing'],[2,'2026-02-25T16:02:00Z','/thanks'],[3,'2026-02-27T18:00:00Z','/'],[4,'2026-03-04T15:00:00Z','/']]){await a.clock(Date.parse(at));assert.equal((await a.post('/api/vane/collect',a.event(id,{path}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'})).status,202)}
 // The mail provider's edge: each address gets the statuses queued for it, then 200.
 const mails=[],plan={'retry@client.example':[500,500],'down@client.example':[500,500,500,500],'gone@client.example':[422]}
 a.fixtureSites['https://api.resend.com']=async request=>{const body=await request.json(),to=body.to[0];if(!/ report, /.test(body.subject)){a.sentMail.push(body);return Response.json({id:crypto.randomUUID()})}const status=plan[to]?.shift()??200,mid=crypto.randomUUID();mails.push({to,subject:body.subject,text:body.text,key:request.headers.get('idempotency-key'),status,mid});return status===200?Response.json({id:mid}):Response.json({message:'refused'},{status})}
 const subscribe=body=>a.form({operation:'report.subscribe',siteId:id,frequency:'weekly',weekday:'1',hour:'8',...body},a.owner),at=async iso=>{await a.clock(Date.parse(iso));await a.scheduled()},to=address=>mails.filter(m=>m.to===address)
 await a.clock(Date.parse('2026-02-27T20:00:00Z'));assert.equal((await subscribe({})).status,303);assert.equal((await subscribe({email:'cfo@client.example'})).status,303)
 assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'all'},a.owner)).status,303)
 // Monday 2 March, 8:00 EST is 13:00 UTC.
 await at('2026-03-02T12:58:00Z');assert.equal(mails.length,0,'not before the local hour')
 await at('2026-03-02T13:01:00Z');assert.deepEqual(mails.map(m=>m.to).sort(),['cfo@client.example','owner@example.test'])
 const week=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-02-23&to=2026-03-02&compare=previous`,owner)).json()
 for(const m of mails){assert.match(m.subject,/weekly report, 2026-02-23 to 2026-03-01/);for(const line of [`Visitors: ${week.visitors}`,`Visits: ${week.visits}`,`Pageviews: ${week.pageviews}`,`Goal conversions: ${week.goals}`,'- /pricing: 1 pageviews','Unsubscribe with one click: '])assert.ok(m.text.includes(line),line)}
 await at('2026-03-02T13:06:00Z');await at('2026-03-03T13:01:00Z');await at('2026-03-07T13:01:00Z');assert.equal(mails.length,2,'once each, and on no other day')
 // After the change to daylight time (8 March), 8:00 EDT is 12:00 UTC.
 await at('2026-03-09T11:58:00Z');assert.equal(mails.length,2);await at('2026-03-09T12:01:00Z');assert.equal(mails.length,4);assert.ok(mails.slice(2).every(m=>/2026-03-02 to 2026-03-08/.test(m.subject)))
 const link=new URL(to('cfo@client.example').at(-1).text.match(/Unsubscribe with one click: (\S+)/)[1]);assert.equal((await a.request(link.pathname)).status,200);assert.equal((await a.request(link.pathname)).status,404)
 await at('2026-03-16T12:01:00Z');assert.deepEqual(mails.slice(4).map(m=>m.to),['owner@example.test'],'unsubscribed recipients get no more')
 // Daily reports at 6:00 (10:00 UTC): temporary failures retry after 15 minutes and 2 hours with the same delivery ID.
 for(const email of ['retry@client.example','down@client.example','gone@client.example'])assert.equal((await subscribe({email,frequency:'daily',hour:'6'})).status,303)
 await at('2026-03-17T10:01:00Z');await at('2026-03-17T10:17:00Z');await at('2026-03-17T12:16:00Z');assert.equal(to('retry@client.example').length,2,'the third attempt waits 2 hours');await at('2026-03-17T12:18:00Z')
 assert.deepEqual(to('retry@client.example').map(m=>m.status),[500,500,200]);assert.equal(new Set(to('retry@client.example').map(m=>m.key)).size,1,'one delivery ID across attempts')
 assert.deepEqual(to('gone@client.example').map(m=>m.status),[422],'a rejected message is not retried')
 await at('2026-03-18T00:17:00Z');assert.equal(to('down@client.example').length,3,'the fourth attempt waits 12 hours');await at('2026-03-18T00:19:00Z');assert.deepEqual(to('down@client.example').map(m=>m.status),[500,500,500,500])
 const sends=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()
 assert.match(sends,/<td>down@client\.example<\/td><td>Mar 16, 2026<\/td><td>failed<\/td><td class="vane-number">4<\/td><td>temporary failure \(uncertain\) on all 4 attempts<\/td>/)
 assert.match(sends,/<td>gone@client\.example<\/td><td>[^<]*<\/td><td>failed<\/td><td class="vane-number">1<\/td><td>rejected by the mail provider[^<]*; not retried<\/td>/)
 assert.match(sends,/<td>retry@client\.example<\/td><td>[^<]*<\/td><td>sent<\/td><td class="vane-number">3<\/td>/)
 // Only the owner adds an external recipient; a viewer subscribes their own address.
 const viewer=await a.accept('viewer@example.test');assert.equal((await a.form({operation:'report.subscribe',siteId:id,frequency:'weekly',weekday:'1',hour:'8',email:'someone@client.example'},viewer)).status,403);assert.equal((await a.form({operation:'report.subscribe',siteId:id,frequency:'monthly',weekday:'1',hour:'8'},viewer)).status,303)
 // Later provider events, signed as Resend signs them (Svix), reach /api/vane/mail-events through the installation's key.
 let now=Date.parse('2026-03-18T00:19:00Z')
 const event=(type,mid,to,{id=crypto.randomUUID(),at=now,secret=key}={})=>{const raw=JSON.stringify({type,created_at:new Date(at).toISOString(),data:{email_id:mid,to:[to]}}),ts=Math.floor(now/1000);return {raw,headers:{'content-type':'application/json','svix-id':id,'svix-timestamp':String(ts),'svix-signature':`v1,${createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${ts}.${raw}`).digest('base64')}`}}}
 const deliver=e=>a.request('/api/vane/mail-events',{method:'POST',headers:e.headers,body:e.raw}),row=async email=>unlinked(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).match(new RegExp(`<tr><td>[^<]*</td><td>${email.replace('.','\\.')}</td>.*?</tr>`,'g'))??[]
 const retried=to('retry@client.example').at(-1).mid
 assert.ok((await row('retry@client.example'))[0].includes('<td>no provider event yet</td>'),'connected, nothing reported yet')
 assert.equal((await deliver(event('email.delivered',retried,'retry@client.example',{secret:`whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')}`}))).status,401,'a wrong signature is refused')
 assert.equal((await deliver(event('email.bounced',retried,'other@client.example'))).status,409,'an event must name the send\'s own address')
 assert.deepEqual(await (await deliver(event('email.bounced',crypto.randomUUID(),'owner@example.test'))).json(),{ok:true,kept:false,reason:'not a report email'})
 assert.equal((await deliver(event('email.delivered',retried,'retry@client.example'))).status,200)
 assert.match((await row('retry@client.example'))[0],/<td>sent<\/td><td class="vane-number">3<\/td><td><\/td><td>delivered to the recipient’s mail server \(provider event, Mar 18, 2026\)<\/td>/)
 // The provider reports a permanent bounce hours later: it shows on the send at once, and an identical retry changes nothing.
 now=Date.parse('2026-03-18T05:00:00Z');await a.clock(now);const bounce=event('email.bounced',retried,'retry@client.example',{id:'msg_bounce_1'})
 assert.equal((await deliver(bounce)).status,200);assert.equal((await deliver(bounce)).status,200)
 assert.equal((await deliver(event('email.complained',retried,'retry@client.example',{id:'msg_bounce_1'}))).status,409,'one provider event identity, one body')
 const settings=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()
 assert.match(settings,/<td>bounced permanently; reports to this address stopped \(provider event, Mar 18, 2026\)<\/td>/);assert.match(settings,/retry@client\.example: Daily at 06:00 <strong data-mail-stop>Reports stopped: the mail provider reported this address bounced permanently on Mar 18, 2026\.<\/strong>/)
 // A spam complaint on the owner's last weekly report stops theirs too; the next due sends fail at once, unsent, with the reason.
 assert.equal((await deliver(event('email.complained',to('owner@example.test').at(-1).mid,'owner@example.test'))).status,200)
 const before={retry:to('retry@client.example').length,owner:to('owner@example.test').length}
 await at('2026-03-18T10:01:00Z');await at('2026-03-23T12:01:00Z')
 assert.deepEqual({retry:to('retry@client.example').length,owner:to('owner@example.test').length},before,'no report email to a stopped address')
 assert.match((await row('retry@client.example'))[0],/<td>failed<\/td><td class="vane-number">0<\/td><td>not sent: the mail provider reported an earlier report email to this address bounced permanently on 2026-03-18; reports to it stopped<\/td>/)
 assert.match((await row('owner@example.test'))[0],/<td>failed<\/td><td class="vane-number">0<\/td><td>not sent: the mail provider reported an earlier report email to this address marked as spam on 2026-03-18; reports to it stopped<\/td>/)
 assert.ok(to('down@client.example').length>4,'other addresses keep their reports')
 assert.ok(!JSON.stringify(await a.dump()).includes(link.pathname.split('/').pop()),'only the unsubscribe token\'s hash is kept')
})
test('ALERT-001 a current-visitors alert above 50 is sent by email within 15 minutes of the crossing with the crossing and send times logged, sends once while the value stays past it, is held by its cool-down when it crosses again, only analysts and up set alerts, goes to the chosen people and signed webhooks, sleeps in quiet hours, and a segment alert counts only the segment\'s visits',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]}),T=Date.parse('2026-04-01T12:00:00Z')
 assert.equal((await a.form({operation:'team.invite',email:'analyst@example.test',role:'analyst',scope:'all'},a.owner)).status,303);assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'all'},a.owner)).status,303)
 const analyst=await a.accept('analyst@example.test'),viewer=await a.accept('viewer@example.test'),add=(cookie,body={})=>a.form({operation:'alert.create',siteId:id,metric:'current',direction:'above',threshold:'50',cooldown:'6',...body},cookie)
 await a.clock(T);assert.equal((await add(viewer)).status,403,'a viewer cannot set alerts');assert.equal((await add(analyst)).status,303)
 assert.equal((await add(analyst,{threshold:'1.5'})).status,400,'whole numbers only')
 const visitors=async(from,n)=>{for(let i=0;i<n;i++)assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/'}),'',{origin:'https://fern.example','cf-connecting-ip':`198.51.${from}.${i}`,'user-agent':DESKTOP_CHROME})).status,202)}
 const alerts=()=>a.sentMail.filter(m=>/Current visitors above 50/.test(m.subject)),at=async ms=>{await a.clock(ms);await a.scheduled()}
 // 50 current visitors is not above 50; the 51st, at 12:01, crosses; the next 5-minute check sends it.
 await a.clock(T+60000);await visitors(1,50);await at(T+120000);assert.equal(alerts().length,0,'50 is not above 50')
 // An automated browser is excluded: the coverage count that changes is named in the message.
 await a.post('/api/vane/collect',a.event(id,{path:'/'}),'',{origin:'https://fern.example','cf-connecting-ip':'198.51.9.9','user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36'})
 await visitors(2,1);await at(T+300000);assert.equal(alerts().length,1);const [mail]=alerts()
 assert.deepEqual(mail.to,['analyst@example.test']);assert.match(mail.text,/Fern Studio: Current visitors above 50\. Now 51\. What moved against the same window a week before: .*Device desktop: 0 → 51 unique visitors/);assert.match(mail.text,/Coverage that day against a week before: [a-z -]+ 0 → 1\./)
 const settings=async()=>unlinked(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text())
 assert.match(await settings(),/<tr><td>Apr 1, 2026, 12:05\sPM<\/td><td>Current visitors above 50<\/td><td class="vane-number">51<\/td><td>Apr 1, 2026, 12:05\sPM<\/td><td>sent: email accepted by the mail provider for one person; push accepted by 0 browsers<\/td><\/tr>/)
 const [log]=(await a.dump()).vane_alert_log;assert.ok(log.sent_at-(T+120000)<=15*60000,'sent within 15 minutes of the crossing')
 // Still above at the next checks: no repeat. The visitors leave (none current after 5 minutes), then 51 return within the cool-down.
 await at(T+600000);assert.equal(alerts().length,1,'once while it stays past the threshold')
 await at(T+1200000);await a.clock(T+1260000);await visitors(3,51);await at(T+1500000);assert.equal(alerts().length,1,'held by the 6-hour cool-down')
 assert.match(await settings(),/<td class="vane-number">51<\/td><td>not sent<\/td><td>held: cool-down of 6 h since the last send<\/td>/)
 // Recipients: the owner sends a pageviews alert to the analyst and the site's signed webhooks; another alert sleeps in quiet hours.
 const hooks=[];a.fixtureSites['https://hooks.fixture.example']=async request=>{hooks.push({headers:Object.fromEntries(request.headers),body:await request.text()});return new Response(null,{status:204})}
 assert.equal((await a.form({operation:'webhook.create',siteId:id,url:'https://hooks.fixture.example/vane','event_traffic.alert':'on'},a.owner)).status,200)
 const analystId=(await a.dump()).oa_operators.find(o=>o.email==='analyst@example.test').id
 assert.equal((await add(analyst,{metric:'pageviews',threshold:'150',webhooks:'on'})).status,403,'only admins and the owner send alerts to webhooks')
 assert.equal((await add(a.owner,{metric:'pageviews',threshold:'150',[`person_${analystId}`]:'on',webhooks:'on'})).status,303)
 assert.equal((await add(a.owner,{metric:'pageviews',threshold:'150',quietFrom:'12:00',quietTo:'13:00'})).status,303)
 await a.clock(T+1560000);await visitors(4,51);await at(T+1620000);await at(T+1920000)
 const pageviewMails=a.sentMail.filter(m=>/Pageviews in the last 60 minutes above 150/.test(m.subject));assert.deepEqual(pageviewMails.map(m=>m.to[0]),['analyst@example.test'],'the chosen person, not the creator; the quiet alert sends nothing')
 assert.equal(hooks.length,1);const hook=JSON.parse(hooks[0].body);assert.deepEqual([hooks[0].headers['vane-event'],hook.event,hook.alert,hook.value,hook.bound],['traffic.alert','traffic.alert','Pageviews in the last 60 minutes above 150',153,'150'])
 assert.match(hooks[0].headers['vane-signature'],/^t=\d+,v1=[0-9a-f]{64}$/);assert.deepEqual(Object.keys(hook).sort(),['alert','bound','condition','direction','event','metric','seen_at','site_id','value'],'no visitor field')
 assert.match(await settings(),/held: quiet hours \(12:00–13:00\)/)
 // A segment alert counts only the segment's visits: 24 site visits cross 20 but 19 blog visits do not; 21 do.
 const saved=await a.form({operation:'segment.save',siteId:id,name:'Blog readers',filters:'page:contains:/blog'},a.owner),segmentId=new URL(saved.headers.get('location'),a.origin).searchParams.get('segment')
 assert.equal((await add(a.owner,{metric:'visits',threshold:'20',segment:segmentId})).status,303);assert.equal((await add(a.owner,{metric:'visits',threshold:'20'})).status,303)
 const blog=async(from,n,path)=>{for(let i=0;i<n;i++)assert.equal((await a.post('/api/vane/collect',a.event(id,{path}),'',{origin:'https://fern.example','cf-connecting-ip':`198.51.${from}.${i}`,'user-agent':DESKTOP_CHROME})).status,202)}
 await a.clock(T+2*3600000);await blog(5,19,'/blog/launch');await blog(7,5,'/pricing');await at(T+2*3600000+60000);assert.equal(a.sentMail.filter(m=>/Visits in the last 60 minutes above 20/.test(m.subject)).length,1,'the whole site crosses 20 visits; the segment does not')
 await blog(6,2,'/blog/launch');await at(T+2*3600000+120000);assert.equal(a.sentMail.filter(m=>/Visits in the last 60 minutes above 20/.test(m.subject)).length,2,'21 blog visits cross the segment alert')
 assert.match(a.sentMail.at(-1).text,/Now 21\. What moved/)
 const alert=(await a.dump()).vane_alerts[0];assert.equal((await a.form({operation:'alert.delete',id:alert.id},viewer)).status,403);assert.equal((await a.form({operation:'alert.delete',id:alert.id},analyst)).status,303)
 assert.ok((await a.dump()).vane_audit.some(e=>e.action==='alert.create')&&(await a.dump()).vane_audit.some(e=>e.action==='alert.delete'),'setting and deleting alerts are audited')
})
test('ALERT-001 against eight weeks of baseline traffic a 4x spike and a 70% drop alert once each against the same weekday and hour, the cool-down holds a repeat, a Thanksgiving dip is held, and a drop inside a recurring Saturday 2:00-3:00 maintenance window or an Uptime window is held while the same drop at 4:00 alerts, a closed day in the business calendar is held and left out of baselines, held drops show on the chart, and each message names its largest movers',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]}),HOUR=3600000
 let ip=0;const pageviews=async(iso,n)=>{await a.clock(Date.parse(iso));for(let i=0;i<n;i++)assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/'}),'',{origin:'https://fern.example','cf-connecting-ip':`198.51.${100+(ip>>8)%50}.${ip++%256}`,'user-agent':DESKTOP_CHROME})).status,202)}
 const usual=[6,7,5,6,8,6,5,7],day=(from,weeks)=>new Date(Date.parse(from)+weeks*7*86400000).toISOString().slice(0,10)
 // Baselines: Thursdays 27 Aug to 19 Nov 2026 at 10:00 and 14:00 UTC, Saturdays 29 Aug to 17 Oct at 2:00 and 4:00.
 for(let w=0;w<13;w++){const d=day('2026-08-27',w);for(const h of ['10','14'])if(!(d==='2026-10-22'&&h==='10'||['2026-11-05','2026-11-12'].includes(d)&&h==='14'))await pageviews(`${d}T${h}:10:00Z`,usual[w%8])}
 for(let w=0;w<8;w++)for(const h of ['02','04'])await pageviews(`${day('2026-08-29',w)}T${h}:10:00Z`,usual[w%8])
 await a.clock(Date.parse('2026-10-20T00:00:00Z'))
 const add=body=>a.form({operation:'alert.create',siteId:id,metric:'pageviews',condition:'anomaly',cooldown:'6',...body},a.owner)
 assert.equal((await add({direction:'above'})).status,303);assert.equal((await add({direction:'below'})).status,303)
 assert.equal((await add({direction:'above',metric:'current'})).status,400,'current visitors take a fixed threshold')
 assert.equal((await a.form({operation:'maintenance.add',siteId:id,kind:'weekly',weekday:'6',from:'02:00',to:'03:00'},a.owner)).status,303)
 const sent=()=>a.sentMail.filter(m=>/usual range/.test(m.subject)).map(m=>m.subject),at=async iso=>{await a.clock(Date.parse(iso));await a.scheduled()}
 // Thursday 22 Oct, 10:00: 24 pageviews by 10:20 against a usual 6 or so: the running hour alerts once.
 await a.clock(Date.parse('2026-10-22T10:00:00Z'));await at('2026-10-22T10:05:00Z');await pageviews('2026-10-22T10:20:00Z',24);await at('2026-10-22T10:25:00Z');await at('2026-10-22T10:30:00Z')
 assert.deepEqual(sent(),['Fern Studio: Pageviews above the usual range for the weekday and hour'],'the spike alerts once')
 assert.match(a.sentMail.at(-1).text,/24 pageviews so far in Thursday 2026-10-22 10:00–11:00 \(UTC\); the usual range for this weekday and hour is \d+(\.\d)? to \d+(\.\d)?\./)
 // Like the report's explanation: the largest movers with their totals, against the same window a week before.
 assert.match(a.sentMail.at(-1).text,/What moved against the same window a week before: .*Page \/: 7 → 24 pageviews \(\+17, \+242\.9%\), of 7 → 24 pageviews in all/);assert.match(a.sentMail.at(-1).text,/Coverage that day against a week before: no coverage count changed\./)
 // A second spike at 12:00 the same day is inside the 6-hour cool-down: held, not sent.
 await pageviews('2026-10-22T12:10:00Z',24);await at('2026-10-22T12:15:00Z');assert.equal(sent().length,1,'the cool-down suppresses a repeat')
 // Saturday 24 Oct: 1 pageview at 2:00 (inside the maintenance window) is held; the same drop at 4:00 alerts.
 await pageviews('2026-10-24T02:10:00Z',1);await at('2026-10-24T03:05:00Z');assert.equal(sent().length,1,'held in maintenance')
 await pageviews('2026-10-24T04:10:00Z',1);await at('2026-10-24T05:05:00Z');assert.deepEqual(sent().slice(1),['Fern Studio: Pageviews below the usual range for the weekday and hour'])
 // Thursday 5 Nov, 14:00: 2 pageviews (a 70% drop) alert when the hour ends; Thanksgiving's empty 14:00 is held.
 await pageviews('2026-11-05T14:10:00Z',2);await at('2026-11-05T15:05:00Z');assert.equal(sent().length,3,'the drop alerts')
 // Uptime sends a maintenance window for Saturday 31 Oct 4:00-5:00 through the annotation door: the empty 4:00 is held.
 const created=await a.form({operation:'annotation-hook.create',siteId:id},a.owner),secret=(await created.text()).match(/data-annotation-secret>(vane_ah_[0-9a-f]{64})</)[1]
 const uptime=body=>a.request('/api/vane/annotations',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:JSON.stringify({siteId:id,id:'uptime-mw-7',kind:'maintenance',title:'Database upgrade',...body})})
 assert.equal((await uptime({at:'2026-10-31T04:00:00Z'})).status,400,'a maintenance window needs its end')
 assert.equal((await uptime({at:'2026-10-31T04:00:00Z',until:'2026-10-31T05:00:00Z'})).status,201);assert.equal((await uptime({at:'2026-10-31T04:00:00Z',until:'2026-10-31T05:00:00Z'})).status,200,'a repeat is idempotent')
 await at('2026-10-31T05:05:00Z');assert.equal(sent().length,3,'held in the Uptime window')
 // Thursday 12 Nov is a closed day in the business calendar: its drop is held, and it leaves the baselines after it.
 assert.equal((await a.form({operation:'calendar.close',siteId:id,day:'2026-11-12',label:'Staff retreat'},a.owner)).status,303)
 await pageviews('2026-11-12T14:10:00Z',1);await at('2026-11-12T15:05:00Z');assert.equal(sent().length,3,'held on a closed day')
 await at('2026-11-26T15:05:00Z');assert.equal(sent().length,3,'the Thanksgiving dip does not alert')
 const log=unlinked(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text())
 for(const outcome of ['held: cool-down of 6 h since the last send','held: scheduled maintenance (Saturdays 02:00–03:00)','held: Thanksgiving Day, a US federal holiday, is not judged against ordinary weeks'])assert.ok(log.includes(outcome),outcome)
 assert.match(log,/<td>Pageviews below the usual range for the weekday and hour<\/td><td class="vane-number">1<\/td><td>Oct 24, 2026, 5:05\sAM<\/td><td>sent: email accepted by the mail provider for one person; push accepted by 0 browsers; usual range [\d.]+ to [\d.]+ for Saturday 2026-10-24 04:00–05:00<\/td>/)
 assert.ok(log.includes('Saturdays 02:00–03:00')&&log.includes('2026-10-31 04:00–05:00'),'both windows are listed');assert.equal((await a.dump()).vane_alert_log.length,8)
 assert.ok(log.includes('held: Staff retreat, a closed day in the business calendar, is not judged against ordinary weeks'))
 // REPORT-003's normal-variation judgment uses the same calendar: the closed day is not judged and leaves the next week's baseline.
 const judged=(await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-11-09&to=2026-11-21`,owner)).json()).explain.variation
 assert.deepEqual([judged.find(d=>d.day==='2026-11-12').closed,judged.find(d=>d.day==='2026-11-19').baselineDays],['Staff retreat',7])
 // Held drops show on the chart with their reason, beside Uptime's maintenance annotation.
 const notes=(await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-10-20&to=2026-11-02`,owner)).json()).explain.annotations
 assert.deepEqual(notes.filter(n=>['alert-held','maintenance'].includes(n.kind)).map(n=>[n.day,n.kind,n.text]),[['2026-10-24','alert-held','Pageviews below the usual range for the weekday and hour held: scheduled maintenance (Saturdays 02:00–03:00).'],['2026-10-31','maintenance','Database upgrade'],['2026-10-31','alert-held','Pageviews below the usual range for the weekday and hour held: scheduled maintenance (2026-10-31 04:00–05:00).']])
})
test('ALERT-002 a goal that stops firing and a conversion rate that collapses each raise their own named alert, and a rate above its threshold stays quiet',async t=>{
 const a=await withApp(t),id=await a.addSite({paths:[],goals:{signup:'/thanks'}}),T=Date.parse('2026-04-07T10:00:00Z'),at=async ms=>{await a.clock(ms);await a.scheduled()}
 let n=0;const visit=async(path,convert)=>{const headers={origin:'https://fern.example','cf-connecting-ip':`198.51.77.${n++}`,'user-agent':DESKTOP_CHROME};assert.equal((await a.post('/api/vane/collect',a.event(id,{path}),'',headers)).status,202);if(convert)assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/thanks'}),'',headers)).status,202)}
 const add=body=>a.form({operation:'alert.create',siteId:id,direction:'below',cooldown:'6',...body},a.owner)
 await a.clock(T);assert.equal((await add({metric:'conversions',goal:'signup',threshold:'1'})).status,303);assert.equal((await add({metric:'conversion-rate',threshold:'20'})).status,303)
 assert.equal((await add({metric:'pageviews',goal:'signup',threshold:'1'})).status,400,'a goal applies to conversions and the rate');assert.equal((await add({metric:'conversions',goal:'nope',threshold:'1'})).status,400)
 // 10:00-10:30: ten visits, three sign up (30%): no alert.
 for(let i=0;i<10;i++){await a.clock(T+i*120000);await visit('/',i<3)}
 await at(T+1800000);const named=()=>a.sentMail.filter(m=>/Goal conversions|Conversion rate/.test(m.subject)).map(m=>m.subject.replace('Fern Studio: ',''))
 assert.deepEqual(named(),[],'30% with 3 sign-ups stays quiet')
 // Two hours later the goal has stopped firing: ten visits, none sign up.
 for(let i=0;i<10;i++){await a.clock(T+2*3600000+i*120000);await visit('/pricing',false)}
 await at(T+2*3600000+1800000)
 assert.deepEqual(named().sort(),['Conversion rate (%) in the last 60 minutes below 20','Goal conversions in the last 60 minutes for goal signup below 1'])
 assert.match(a.sentMail.find(m=>/Conversion rate/.test(m.subject)).text,/Now 0\. What moved against the same window a week before:/)
})
test('FOLLOW-001 a drop alert left unacknowledged reminds once and escalates once, acknowledging and resolving it as a tracking fault stops reminders and records who, when and the outcome, due times count business hours, and the owner can end the policy',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]}),at=async iso=>{await a.clock(Date.parse(iso));await a.scheduled()}
 assert.equal((await a.form({operation:'team.invite',email:'analyst@example.test',role:'analyst',scope:'all'},a.owner)).status,303);const analyst=await a.accept('analyst@example.test')
 const {oa_operators:operators}=await a.dump(),analystId=operators.find(o=>o.email==='analyst@example.test').id,ownerId=operators.find(o=>o.email==='owner@example.test').id
 // Items are read from the site's settings page: each with its state, responsible person, next action and due time (UTC).
 const items=async()=>[...(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).matchAll(/<li data-follow-item="([^"]+)" data-state="([a-z]+)"><strong>[^<]*<\/strong>: ([^\n]*)/g)].map(m=>({id:m[1],state:m[2],text:m[3]}))
 const hooks=[];a.fixtureSites['https://hooks.fixture.example']=async request=>{hooks.push(JSON.parse(await request.text()));return new Response(null,{status:204})}
 await a.clock(Date.parse('2026-04-06T09:00:00Z'))
 assert.equal((await a.form({operation:'webhook.create',siteId:id,url:'https://hooks.fixture.example/vane','event_follow.change':'on'},a.owner)).status,200)
 assert.equal((await a.form({operation:'follow.policy',siteId:id,remind:'1',escalate:'2',second:analystId,start:'9',end:'17'},analyst)).status,403,'the policy is the owner\'s')
 assert.equal((await a.form({operation:'follow.policy',siteId:id,remind:'1',escalate:'2',second:analystId,start:'9',end:'17'},a.owner)).status,303)
 // Current visitors drop below 1 (no one on the site) on Monday 6 April at 10:00 UTC: the alert opens an item.
 assert.equal((await a.form({operation:'alert.create',siteId:id,metric:'current',direction:'below',threshold:'1',cooldown:'1'},a.owner)).status,303)
 await at('2026-04-06T10:01:00Z');const [item]=await items();assert.equal(item.state,'open');assert.match(item.text,/responsible Site owner; next: Acknowledge and check the change, due Apr 6, 2026, 11:01\sAM UTC/)
 const mails=subject=>a.sentMail.filter(m=>m.subject===`Fern Studio: ${subject}`).map(m=>m.to[0])
 await at('2026-04-06T10:59:00Z');assert.deepEqual(mails('Follow-up reminder'),[])
 await at('2026-04-06T11:02:00Z');await at('2026-04-06T11:30:00Z');assert.deepEqual(mails('Follow-up reminder'),['owner@example.test'],'one reminder to the responsible person')
 await at('2026-04-06T12:02:00Z');await at('2026-04-06T12:30:00Z');assert.deepEqual(mails('Follow-up escalation'),['analyst@example.test'],'one escalation to the second recipient')
 assert.equal((await items())[0].state,'open','notifications never close an item')
 assert.equal((await a.form({operation:'follow.assign',id:item.id,to:analystId},a.owner)).status,303);assert.match((await items())[0].text,/responsible analyst;/)
 assert.equal((await a.form({operation:'follow.assign',id:item.id,to:ownerId},a.owner)).status,303)
 // Acknowledge, comment and resolve it as a tracking fault; no reminder follows.
 for(const body of [{operation:'follow.ack'},{operation:'follow.comment',text:'Script tag was dropped by the CMS update.'},{operation:'follow.resolve',outcome:'tracking-fault'}])assert.equal((await a.form({id:item.id,...body},a.owner)).status,303)
 assert.equal((await a.form({operation:'follow.resolve',id:item.id,outcome:'expected'},a.owner)).status,409,'resolved once')
 await at('2026-04-06T15:00:00Z');assert.equal(mails('Follow-up reminder').length+mails('Follow-up escalation').length,2,'reminders stop')
 const page=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()
 assert.match(page,/data-state="resolved"><strong>Current visitors below 1<\/strong>: resolved, Tracking fault fixed by Site owner at Apr 6, 2026, 12:30\sPM UTC/,'who resolved it, when and with what outcome');assert.ok(page.includes('acknowledge, acknowledged')&&page.includes('comment, Script tag was dropped by the CMS update.'))
 assert.deepEqual(hooks.map(h=>h.action),['open','remind','escalate','assign','assign','acknowledge','comment','resolve']);assert.deepEqual(Object.keys(hooks.at(-1)).sort(),['action','alert','at','event','item_id','outcome','site_id','state']);assert.equal(hooks.at(-1).outcome,'tracking-fault')
 // An alert at 16:30 on Friday is due an hour of business time later: 9:30 on Monday. The owner ends the policy: no reminder.
 await a.clock(Date.parse('2026-04-10T16:00:00Z'));assert.equal((await a.collect(a.event(id,{path:'/'}))).status,202);await at('2026-04-10T16:02:00Z');await at('2026-04-10T16:30:00Z')
 const second=(await items()).find(i=>i.id!==item.id);assert.match(second.text,/due Apr 13, 2026, 9:30\sAM UTC/)
 assert.equal((await a.form({operation:'follow.policy',siteId:id,remind:'1',escalate:'2',second:analystId,start:'9',end:'17',ended:'on'},a.owner)).status,303)
 await at('2026-04-13T12:00:00Z');assert.equal(mails('Follow-up reminder').length,1,'an ended policy reminds no one');assert.equal((await items()).find(i=>i.id===second.id).state,'open')
})
