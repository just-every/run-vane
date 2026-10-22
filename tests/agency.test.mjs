import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { deflateSync, crc32 } from 'node:zlib'
import { installation } from './harness.mjs'
import { browse } from './vane-helpers.mjs'

// A synthetic raster logo created inside the test; no image service or network read.
function logo(red=29,green=88,blue=240) {
 const chunk=(name,data)=>{const type=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([size,type,data,sum])}
 const header=Buffer.alloc(13);header.writeUInt32BE(160);header.writeUInt32BE(64,4);header[8]=8;header[9]=2
 const pixels=Buffer.alloc(64*(1+160*3));for(let y=0;y<64;y++)for(let x=0;x<160;x++){const at=y*(1+160*3)+1+x*3,on=(x>12&&x<40&&y>12&&y<52)||(x>54&&x<145&&y>18&&y<28)||(x>54&&x<115&&y>36&&y<46);pixels[at]=on?red:255;pixels[at+1]=on?green:255;pixels[at+2]=on?blue:255}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])
}
async function fixture(t) {
 const a=await installation();t.after(()=>a.close())
 const op=(operation,p={},cookie=a.owner)=>a.form({operation,...p},cookie),data=async()=>{const r=await a.request('/api/vane/agency',{headers:{cookie:a.owner}});assert.equal(r.status,200);return r.json()}
 await a.clock(Date.parse('2026-10-18T12:00:00Z'))
 const A=await a.addSite({name:'Fern Studio',origin:'https://fern.example',paths:[],publicReports:['totals','pages'],timeZone:'UTC'}),B=await a.addSite({name:'Oak Books',origin:'https://oak.example',paths:[],publicReports:['totals','pages'],timeZone:'UTC'})
 for(const name of ['Fern Studio','Oak Books'])assert.equal((await op('agency.client.create',{name})).status,303)
 const clients=(await data()).clients,fern=clients.find(c=>c.name==='Fern Studio'),oak=clients.find(c=>c.name==='Oak Books')
 for(const [siteId,clientId] of [[A,fern.id],[B,oak.id]])assert.equal((await op('agency.site.assign',{siteId,clientId})).status,303)
 for(const [email,clientId] of [['fern@client.example',fern.id],['oak@client.example',oak.id]])assert.equal((await op('agency.invite',{email,clientId})).status,303)
 const fernUser=await a.accept('fern@client.example'),oakUser=await a.accept('oak@client.example')
 const brand=async(brandId,name,customOrigin='',extra={})=>{const r=await op('agency.brand.save',{brandId,name,accent:'#215544',background:'#f5f9fd',enabled:'on',customOrigin,domainAttestation:'on',...extra});assert.equal(r.status,303,await r.clone().text())}
 const upload=async(brandId,image=logo(),cookie=a.owner)=>{const form=new FormData();form.set('brandId',brandId);form.set('logo',new Blob([image],{type:'image/png'}),'synthetic-vane-logo.png');const wire=new Response(form);return a.request('/app/agency/logo',{method:'POST',headers:{origin:a.origin,cookie,'content-type':wire.headers.get('content-type')},body:await wire.arrayBuffer()})}
 const domain=(origin,path,options={})=>a.request(path,{...options,headers:{...options.headers,'x-original-url':origin+path}})
 for(const [siteId,origin,n] of [[A,'https://fern.example',12],[B,'https://oak.example',7]]){await a.clock(Date.parse('2026-10-16T12:00:00Z'));for(let i=0;i<n;i++)assert.equal((await a.post('/api/vane/collect',a.event(siteId,{path:i%3?'/':'/pricing'}),'',{origin,'cf-connecting-ip':`203.0.113.${i+1}`,'user-agent':'Synthetic browser'})).status,202)}
 await a.clock(Date.parse('2026-10-18T12:00:00Z'))
 return {a,A,B,fern,oak,fernUser,oakUser,op,data,brand,upload,domain}
}

test('AGENCY-001 two clients isolate every site door; agency and client brands reach reports, shared links and weekly mail; custom hosts expose only public reports and unsubscribe',async t=>{
 const {a,A,B,fern,oak,fernUser,oakUser,op,data,brand,upload,domain}=await fixture(t),agencyOrigin='https://reports.northstar.example',clientOrigin='https://reports.fern.example'
 for(const [cookie,own,other] of [[fernUser,A,B],[oakUser,B,A]]) {
  assert.deepEqual((await(await a.request('/api/vane/sites',{headers:{cookie}})).json()).map(s=>s.id),[own])
  const home=await(await a.request('/app',{headers:{cookie}})).text();assert.ok(home.includes(own));assert.ok(!home.includes(`data-site="${other}"`))
  for(const path of [`/app/sites/${other}`,`/app/sites/${other}?section=settings`,`/api/vane/summary?siteId=${other}`,`/api/vane/realtime?siteId=${other}`,`/api/vane/inventory?siteId=${other}`,`/api/vane/csv?siteId=${other}&table=topPages`,`/api/vane/site-zip?siteId=${other}`,'/app?section=agency','/api/vane/agency'])assert.equal((await a.request(path,{headers:{cookie}})).status,403,path)
  assert.equal((await op('report.subscribe',{siteId:other},cookie)).status,403)
  assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:other,goals:{}}},cookie)).status,403)
  assert.equal((await op('agency.site.assign',{siteId:own,clientId:oak.id},cookie)).status,403)
 }
 assert.equal((await a.request('/api/vane/agency')).status,401)
 const before=await data();assert.equal((await a.post('/api/vane/agency',{operation:'agency.client.create',name:'Refused'},a.owner,{origin:'https://foreign.example'})).status,403);assert.deepEqual(await data(),before)
 await brand('agency','Northstar Analytics',agencyOrigin);const uploaded=await upload('agency');assert.equal(uploaded.status,303,(await uploaded.text()).match(/class="vane-error"[^>]*>([^<]*)/)?.[1])
 assert.equal((await upload('agency',Buffer.from('<svg onload="alert(1)"></svg>'))).status,400)
 assert.equal((await upload('agency',logo(),fernUser)).status,403)
 const agency=(await data()).brands.find(b=>b.id==='agency'),logoURL='/agency-assets/'+agency.logo_id
 assert.deepEqual(Buffer.from(await(await a.request(logoURL)).arrayBuffer()),logo())
 const privateReport=await(await a.request(`/app/sites/${A}`,{headers:{cookie:fernUser}})).text();assert.match(privateReport,/Northstar Analytics logo/);assert.ok(privateReport.includes('#215544'))
 for(const siteId of [A,B]){const r=await a.request('/stats/'+siteId);assert.equal(r.status,200);assert.match(await r.text(),/Northstar Analytics logo/)}
 for(const [cookie,siteId] of [[fernUser,A],[oakUser,B]])assert.equal((await op('report.subscribe',{siteId,frequency:'weekly',weekday:'1',hour:'8'},cookie)).status,303)
 await a.clock(Date.parse('2026-10-19T08:01:00Z'));await a.scheduled()
 const reports=a.sentMail.filter(m=>/weekly report,/.test(m.subject));assert.equal(reports.length,2)
 for(const mail of reports){assert.match(mail.html,/Northstar Analytics logo/);assert.ok(mail.html.includes(agencyOrigin+logoURL));assert.match(mail.text,/Visitors: (12|7)/);assert.ok(mail.text.includes(agencyOrigin+'/reports/unsubscribe/'))}
 // Oak's own unsubscribe stops its B subscription before the later site move.
 const oakMail=reports.find(m=>m.to.includes('oak@client.example')),unsubscribe=new URL(oakMail.text.match(/Unsubscribe with one click: (\S+)/)[1]);assert.equal((await domain(agencyOrigin,unsubscribe.pathname)).status,200)
 await brand(fern.id,'Fern Creative',clientOrigin,{accent:'#693f91',background:'#fcf9ff'});assert.equal((await upload(fern.id,logo(105,63,145))).status,303)
 assert.match(await(await domain(clientOrigin,'/stats/'+A)).text(),/Fern Creative logo/);assert.equal((await domain(clientOrigin,'/stats/'+B)).status,404)
 const created=await op('share.create',{siteId:A,label:'Fern board',share_totals:'on',password:'synthetic-vane-password'}),html=await created.text(),shared=html.match(/\/share\/vane_s_[0-9a-f]{64}/)[0]
 assert.ok(html.includes(clientOrigin+shared))
 assert.equal((await domain(clientOrigin,shared)).status,401)
 const password=await domain(clientOrigin,shared,{method:'POST',headers:{origin:clientOrigin,'content-type':'application/x-www-form-urlencoded'},body:'password=synthetic-vane-password'});assert.equal(password.status,303)
 assert.match(await(await domain(clientOrigin,shared,{headers:{cookie:a.cookieOf(password)}})).text(),/Fern Creative logo/)
 assert.equal((await domain(clientOrigin,shared,{method:'POST',headers:{origin:'https://foreign.example','content-type':'application/x-www-form-urlencoded'},body:'password=synthetic-vane-password'})).status,404)
 for(const path of ['/app','/signin','/auth/operators','/api/vane/sites','/api/v1/stats?site_id='+A,'/vane.js','/site/','/health'])assert.equal((await domain(clientOrigin,path,{headers:{cookie:a.owner}})).status,404,path)
 assert.equal((await domain(clientOrigin,'/vane.css')).status,200);assert.equal((await domain(clientOrigin,'/ui/shell.css')).status,200)
 assert.equal((await domain('https://unknown.example','/stats/'+A)).status,404)
 // Moving a site revokes the old client's live reads and due mail; an empty client never means all sites.
 assert.equal((await op('agency.site.assign',{siteId:A,clientId:oak.id})).status,303)
 assert.deepEqual(await(await a.request('/api/vane/sites',{headers:{cookie:fernUser}})).json(),[])
 assert.equal((await a.request(`/app/sites/${A}`,{headers:{cookie:fernUser}})).status,403)
 assert.equal((await domain(clientOrigin,'/stats/'+A)).status,404)
 await a.clock(Date.parse('2026-10-26T08:01:00Z'));await a.scheduled();assert.equal(a.sentMail.filter(m=>/weekly report,/.test(m.subject)).length,2)
 const log=await(await a.request('/api/vane/audit',{headers:{cookie:a.owner}})).json();for(const action of ['agency.client.create','agency.site.assign','agency.user.assign','agency.brand.save','agency.logo.upload'])assert.ok(log.some(e=>e.action===action),action)
 await brand('agency','Northstar Analytics',agencyOrigin,{enabled:''});assert.equal((await a.request(logoURL)).status,404);assert.equal((await domain(agencyOrigin,logoURL)).status,404)
 const overview=await(await a.request('/app?section=agency',{headers:{cookie:a.owner}})).text();assert.match(overview,/Fern Studio/);assert.match(overview,/Oak Books/)
 assert.equal(a.egress.some(url=>!url.startsWith('https://api.resend.com/')),false,'branding performs no remote logo or domain reads')
})

test('AGENCY-001 owner manages two realistic client workspaces at 1440 and 390; client report uses the uploaded logo without overflow',async t=>{
 const {a,A,fern,op,brand,upload}=await fixture(t)
 await brand('agency','Northstar Analytics');const uploaded=await upload('agency');assert.equal(uploaded.status,303,(await uploaded.text()).match(/class="vane-error"[^>]*>([^<]*)/)?.[1])
 await brand(fern.id,'Fern Creative','',{accent:'#693f91',background:'#fcf9ff'});assert.equal((await upload(fern.id,logo(105,63,145))).status,303)
 const sharedHtml=await(await op('share.create',{siteId:A,label:'Fern weekly board',share_totals:'on',share_pages:'on'})).text(),shared=sharedHtml.match(/\/share\/vane_s_[0-9a-f]{64}/)[0]
 const {context}=await browse(t,a);await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 const page=await context.newPage(),screens=process.env.VANE_SCREEN_DIR;if(screens)await mkdir(screens,{recursive:true})
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:960});await page.goto(a.origin+'/app?section=agency')
  await page.getByRole('heading',{name:'Agency clients',exact:true}).waitFor();assert.equal(await page.locator('[data-client]').count(),2)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  if(screens)await page.screenshot({path:`${screens}/agency-overview-${width}.png`,fullPage:true})
  await page.getByText('Agency branding',{exact:true}).click()
  await page.getByRole('button',{name:'Upload logo',exact:true}).waitFor()
  if(screens)await page.screenshot({path:`${screens}/agency-brand-settings-${width}.png`,fullPage:true})
  await page.locator(`[data-client="${fern.id}"]`).getByText('Fern Studio branding',{exact:true}).click()
  if(screens)await page.screenshot({path:`${screens}/agency-client-brand-settings-${width}.png`,fullPage:true})
  await page.goto(a.origin+`/app/sites/${A}`);await page.getByAltText('Fern Creative logo').waitFor()
  assert.equal(await page.getByAltText('Fern Creative logo').evaluate(img=>img.complete&&img.naturalWidth>0),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  if(screens)await page.screenshot({path:`${screens}/agency-client-report-${width}.png`})
  await page.goto(a.origin+shared);await page.getByAltText('Fern Creative logo').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  if(screens)await page.screenshot({path:`${screens}/agency-shared-report-${width}.png`})
 }
})
