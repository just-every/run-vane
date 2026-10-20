import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

const origin='http://127.0.0.1:9137',offsite='http://127.0.0.1:9138';
const urlset=urls=>`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url=>`<url><loc>${url.replaceAll('&','&amp;')}</loc></url>`).join('')}</urlset>`;
const instrumented=`<!doctype html><title>Fern Studio pricing</title><h1>Plans for growing studios</h1><p>BODY_SENTINEL_DO_NOT_STORE</p><script defer src="https://plausible.io/js/plausible.js"></script><script>plausible.init({customProperties:{author:'jo'},fileDownloads:{fileExtensions:['dwg']},unsupportedOption:true});plausible('Signup', {props:{plan:'pro'}});plausible('Purchase', {revenue:{amount:49.99,currency:'USD'}});fathom.trackEvent('Order', {_value:4999});fathom.trackPageview();plausible(dynamicEvent, runtimeOptions);</script><button class="plausible-event-name=Book+Demo plausible-event-plan=pro">Demo</button><button class="plausible-event-name--Book+Demo">Another demo</button>`;
function edge(a,mode={}) {
 const recorded=[];a.fixtureSites[origin]=request=>{
  const url=new URL(request.url);recorded.push({url:request.url,method:request.method,cookie:request.headers.get('cookie'),authorization:request.headers.get('authorization')});
  if(url.pathname==='/robots.txt')return new Response(mode.robots??`User-agent: *\nDisallow: /private\nDisallow: /secret*\nAllow: /private/public$\nSitemap: ${origin}/maps/index.xml\nSitemap: ${offsite}/forbidden.xml`,{status:mode.robotsStatus??200});
  if(url.pathname==='/maps/index.xml')return new Response(`<sitemapindex><sitemap><loc>${origin}/maps/pages.xml</loc></sitemap><sitemap><loc>${origin}/maps/index.xml</loc></sitemap></sitemapindex>`);
  if(url.pathname==='/maps/pages.xml'||url.pathname==='/sitemap.xml')return new Response(urlset(mode.pages??[origin+'/private',origin+'/secret-key',offsite+'/page','http://user:password@127.0.0.1:9137/credential',origin+'/pricing',origin+'/redirect',origin+'/private/public',origin+'/extra']));
  if(url.pathname==='/redirect')return new Response(null,{status:302,headers:{location:offsite+'/escape'}});
  return new Response(instrumented,{headers:{'content-type':'text/html'}});
 };return recorded;
}
async function browserPage(a) {
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});
 const context=await browser.newContext({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36'});await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}));
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==a.origin)return route.abort();const r=await a.request(url.pathname+url.search,{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()??undefined});const location=r.headers.get('location');if(r.status===303&&location)return route.fulfill({contentType:'text/html',body:`<meta http-equiv="refresh" content="0;url=${location.replaceAll('&','&amp;')}">`});return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())})});
 return {browser,page:await context.newPage()};
}

test('IMPORT-008 / PRIVACY-005 explicit owner/admin scan obeys robots, same-origin sitemap/page boundary, credentials and selected limit; stores only findings and attaches matching definitions',async t=>{
 const a=await installation();t.after(()=>a.close());const siteId=await a.addSite({origin,paths:[],goals:{}}),recorded=edge(a),owner={headers:{cookie:a.owner}};
 const get=path=>a.request(path,owner),start=(pageLimit,cookie=a.owner)=>a.post('/api/vane/cutover-scan',{siteId,pageLimit},cookie);
 await get('/app/sites/'+siteId+'?section=settings');await a.scheduled();assert.equal(recorded.length,0,'reading settings and cron must not start a scan');
 assert.equal((await start(4,'')).status,401);const viewer=await a.invite('scan-viewer@example.test','member');assert.equal((await start(4,viewer)).status,403);
 assert.equal((await start(0)).status,400);assert.equal((await start(501)).status,400);
 const response=await start(3);assert.equal(response.status,200,await response.clone().text());const scan=await response.json();
 assert.equal(scan.state,'complete');assert.equal(scan.fetched,3);assert.equal(scan.page_limit,3);assert.equal(scan.refused,7);assert.equal(scan.pages.length,2);assert.ok(scan.actor_id);assert.ok(scan.at);
 assert.deepEqual(recorded.map(r=>new URL(r.url).pathname),['/robots.txt','/maps/index.xml','/maps/pages.xml','/pricing','/redirect','/private/public']);
 assert.ok(recorded.every(r=>r.method==='GET'&&!r.cookie&&!r.authorization));assert.ok(a.egress.every(url=>new URL(url).origin===origin||new URL(url).hostname==='api.resend.com'));
 const found=scan.pages[0].findings;assert.ok(found.some(f=>f.kind==='script'&&f.rewrite.includes('/vane.js')));assert.ok(found.some(f=>f.kind==='option'&&f.detail.includes('unsupportedOption')));assert.equal(found.filter(f=>f.kind==='class'&&f.name==='Book Demo').length,2);
 assert.ok(found.some(f=>f.name==='Signup'&&f.rewrite==='vane("Signup", {"props":{"plan":"pro"}})'));assert.ok(found.some(f=>f.name==='Order'&&f.rewrite.includes('"amount":49.99')));assert.ok(found.some(f=>f.detail.includes('Dynamic')));
 const fetched=await(await get('/api/vane/cutover-scans?siteId='+siteId)).json();assert.deepEqual(fetched[0],scan);
 const preview=await a.post('/api/vane/import-preview',{siteId,document:{format:'vane-plausible-dashboard/1',day:'2026-10-01',currency:'USD',files:{'conversions.csv':'name,unique_conversions,total_conversions\nSignup,1,1\n','custom_props.csv':'property,value,visitors,events\nplan,pro,1,1\n'}}},a.owner);assert.equal(preview.status,200,await preview.clone().text());
 const p=await preview.json();const applied=await a.post('/api/vane/import-apply',{siteId,document:p.carry,fingerprint:p.fingerprint},a.owner);assert.equal(applied.status,200,await applied.clone().text());
 const definitions=await(await get('/api/vane/import-definitions?siteId='+siteId)).json();assert.ok(definitions.find(d=>d.name==='Signup').callSites.some(c=>c.url===origin+'/pricing'&&c.kind==='call'&&c.at));
 const archive=await a.archive(),stored=JSON.stringify(await a.dump());assert.equal(stored.includes('BODY_SENTINEL_DO_NOT_STORE'),false);assert.equal(stored.includes('<h1>'),false);assert.equal(stored.includes('user:password'),false);assert.ok(archive.payload.tables.vane_cutover_scans.length);assert.ok(archive.payload.tables.vane_audit.some(r=>r.action==='install.scan'));
 const {browser,page}=await browserPage(a);t.after(()=>browser.close());const screens=process.env.SCAN_SCREENSHOTS;if(screens)await mkdir(screens,{recursive:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(a.origin+'/app/sites/'+siteId+'?section=history');await page.getByRole('heading',{name:'Needs completion',exact:true}).scrollIntoViewIfNeeded();assert.ok(await page.getByText('Call-site evidence:',{exact:false}).filter({hasText:origin+'/pricing'}).first().isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(screens)await page.screenshot({path:`${screens}/cutover-definition-evidence-${width}.png`})}
 const admin=await a.invite('scan-admin@example.test','admin');assert.equal((await start(1,admin)).status,200);
 const other=await a.addSite({origin:offsite});assert.equal((await a.form({operation:'team.invite',email:'scoped-scan@example.test',role:'admin',scope:'selected',['site_'+other]:'on'},a.owner)).status,303);const scoped=await a.accept('scoped-scan@example.test');assert.equal((await start(1,scoped)).status,403);
});

test('IMPORT-008 static sitemap fallback, fail-closed robots, native rewrite execution and owner Settings journey at 1440 and 390',async t=>{
 const a=await installation();t.after(()=>a.close());const siteId=await a.addSite({origin,paths:[],goals:{},incumbentCompatibility:true}),mode={robotsStatus:404,pages:[origin+'/pricing']},recorded=edge(a,mode);
 const {browser,page}=await browserPage(a);t.after(()=>browser.close());const screens=process.env.SCAN_SCREENSHOTS;if(screens)await mkdir(screens,{recursive:true});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(a.origin+'/app/sites/'+siteId+'?section=settings');const heading=page.getByRole('heading',{name:'Tracking cut-over scan',exact:true});await heading.scrollIntoViewIfNeeded();assert.ok(await page.getByLabel('Maximum pages to scan').isVisible());if(screens)await page.screenshot({path:`${screens}/cutover-ready-${width}.png`});
  await page.getByLabel('Maximum pages to scan').fill('1');const previous=await page.locator('[data-cutover-scan]').count();await page.getByRole('button',{name:'Scan tracking cut-over',exact:true}).click();await page.waitForFunction(n=>document.querySelectorAll('[data-cutover-scan]').length>n,previous);await page.waitForURL('**/app/sites/*?section=settings');await page.locator('[data-cutover-scan]').first().waitFor();const scan=page.locator('[data-cutover-scan]').first();await scan.locator('summary').click();await scan.scrollIntoViewIfNeeded();assert.ok(await scan.getByText(/Incumbent script still loaded/).isVisible());assert.ok(await scan.getByText(/Unsupported init option/).isVisible());if(screens)await page.screenshot({path:`${screens}/cutover-findings-${width}.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page must fit narrow screen');
 }
 assert.ok(recorded.some(r=>new URL(r.url).pathname==='/sitemap.xml'));
 const scans=await(await a.request('/api/vane/cutover-scans?siteId='+siteId,{headers:{cookie:a.owner}})).json(),drafts=scans[0].pages[0].findings.filter(f=>['Signup','Purchase','Order'].includes(f.name)).map(f=>f.rewrite);
 // Execute the actual derived native rewrites on a page with only Vane's script.
 await page.context().route(origin+'/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Native tracking</title><script>window.plausible=function(){};plausible.init=o=>plausible.o=o;plausible.init({captureOnLocalhost:true});</script><script defer src="${a.origin}/vane.js" data-site="${siteId}"></script>`}));
 const accepted=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await page.goto(origin+'/native');assert.equal((await accepted).status(),202);await page.waitForFunction(()=>window.plausible?.vane===true);await page.evaluate(()=>window.vane('pageview'));await new Promise(r=>setTimeout(r,100));await page.evaluate(calls=>{for(const call of calls)Function(call)()},drafts);
 await assertEventually(async()=>{const report=await(await a.request('/api/vane/summary?siteId='+siteId,{headers:{cookie:a.owner}})).json();assert.ok(report.customEvents.some(e=>e.name==='Signup'));assert.ok(report.customEvents.some(e=>e.name==='Purchase'));assert.ok(report.customEvents.some(e=>e.name==='Order'))});
 mode.robotsStatus=503;const before=recorded.length,r=await a.post('/api/vane/cutover-scan',{siteId,pageLimit:1},a.owner);assert.equal((await r.json()).state,'failed');assert.deepEqual(recorded.slice(before).map(r=>new URL(r.url).pathname),['/robots.txt']);
 mode.robotsStatus=200;mode.robots='User-agent: *\nDisallow: /\n';const blocked=await(await a.post('/api/vane/cutover-scan',{siteId,pageLimit:1},a.owner)).json();assert.equal(blocked.fetched,0);
});
async function assertEventually(check){let error;for(let i=0;i<60;i++){try{return await check()}catch(e){error=e;await new Promise(r=>setTimeout(r,50))}}throw error}
