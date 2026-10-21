import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installation } from './harness.mjs'

const cli=new URL('../scripts/import-export.mjs',import.meta.url)
function command(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli.pathname,...args],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data});child.stderr.on('data',data=>{stderr+=data});child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}))})}
async function files(root){const names=await readdir(root,{recursive:true});const out=[];for(const name of names){const path=join(root,name);if((await stat(path)).isFile())out.push(await readFile(path,'utf8'))}return out.join('\n')}

async function browserProof(a,origin,site,label){
 if(process.env.VANE_SCREEN_DIR){
  const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try{
   const context=await browser.newContext();await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:origin}}))
   const page=await context.newPage();await mkdir(process.env.VANE_SCREEN_DIR,{recursive:true})
   for(const section of ['report','history'])for(const width of [1440,390]){
    await page.setViewportSize({width,height:960});await page.goto(`${origin}/app/sites/${site}?section=${section}&from=2024-03-13&to=2024-03-14`)
    await page.getByRole('heading',{name:section==='history'?'Import journal':'Overview',exact:true}).first().waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await page.screenshot({path:join(process.env.VANE_SCREEN_DIR,`${label}-${section}-${width}.png`),fullPage:true})
   }
  }finally{await browser.close()}
 }
}

test('IMPORT-006 whole Umami and Simple Analytics CSV files preview in bounded pages, resume interrupted preview and publication, preserve totals without identifiers, and refuse changed sources or unreviewed apply',async t=>{
 const privateDir=await mkdtemp(join(tmpdir(),'vane-import-'));t.after(()=>rm(privateDir,{recursive:true,force:true}))
 let a,interruptPreview=false,interruptApply=false,previewCalls=0,applyCalls=0,interruptApplyAt=2,maxRows=0
 const server=createServer(async(req,res)=>{try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks)
  const path=req.url,headers={...req.headers};delete headers.host
  if(path==='/api/vane/import-preview'){
   previewCalls++;const payload=JSON.parse(body);maxRows=Math.max(maxRows,payload.document.split('\n').length-1)
   if(interruptPreview&&previewCalls===2){res.writeHead(503);res.end();return}
  }
  const response=await a.request(path,{method:req.method,headers,...(body.length?{body}:{})})
  if(path==='/api/vane/import-apply'&&interruptApply&&++applyCalls===interruptApplyAt){req.socket.destroy();return}
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
 }catch{res.writeHead(500);res.end()}})
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)))
 const origin=`http://127.0.0.1:${server.address().port}`
 a=await installation({origin});t.after(()=>a.close())
 const site=await a.addSite({paths:[],goals:{},retainForever:true}),cookie=join(privateDir,'session')
 await writeFile(cookie,a.owner,{mode:0o600})
 const umami=join(privateDir,'umami.csv'),review=join(privateDir,'umami-review')
 // More than two pages; quoted multiline fields cross parser buffers and are discarded.
 const title='private-title-'+('x'.repeat(65500))+'\nsecond line, "quoted"'
 const row=i=>`raw-event-${i},2024-03-13 09:00:00,/pricing,1,private-session,private-site,"${(i===0?title:'private-title').replaceAll('"','""')}"\r\n`
 const source='event_id,created_at,url_path,event_type,session_id,website_id,page_title\r\n'+Array.from({length:1003},(_,i)=>row(i)).join('')
 await writeFile(umami,source)
 const preview=['preview','--origin',origin,'--site',site,'--format','umami','--input',umami,'--cookie-file',cookie,'--review-dir',review]
 interruptPreview=true
 const failed=await command(preview);assert.notEqual(failed.code,0)
 assert.equal((await a.dump()).vane_import_events.length,0,'preview publishes nothing')
 const incompleteApply=await command(['apply','--review-dir',review,'--cookie-file',cookie,'--yes']);assert.notEqual(incompleteApply.code,0)
 interruptPreview=false
 const prepared=await command(preview);assert.equal(prepared.code,0,prepared.stderr)
 const saved=await files(review)
 for(const secret of ['private-session','private-site','private-title','raw-event-'])assert.ok(!saved.includes(secret),secret+' must not enter the review files')
 assert.ok(previewCalls>=3);assert.ok(maxRows<510,'each request remains a bounded page even for multiline CSV')
 const apply=['apply','--review-dir',review,'--cookie-file',cookie,'--yes']
 const unconfirmed=await command(apply.slice(0,-1));assert.notEqual(unconfirmed.code,0)
 interruptApply=true
 const lost=await command(apply);assert.notEqual(lost.code,0)
 const during=(await a.dump()).vane_import_events.length;assert.ok(during>0&&during<1003,'interruption follows a committed batch')
 interruptApply=false
 const resumed=await command(apply);assert.equal(resumed.code,0,resumed.stderr)
 assert.equal((await a.dump()).vane_import_events.length,1003)
 assert.equal((await command(apply)).code,0,'completed application is resumable')
 assert.equal((await a.dump()).vane_import_events.length,1003,'a lost response never duplicates a committed record')
 const response=await a.request(`/api/vane/summary?siteId=${site}&from=2024-03-13&to=2024-03-14`,{headers:{cookie:a.owner}})
 const report=await response.json();assert.equal(report.pageviews,1003);assert.equal(report.unknownCoverage,1003)
 await browserProof(a,origin,site,'csv')
 const stored=JSON.stringify(await a.dump());for(const secret of ['private-session','private-site','private-title','raw-event-'])assert.ok(!stored.includes(secret),secret+' must not enter custody')
 await writeFile(umami,source.replace('/pricing','/other'))
 assert.notEqual((await command(preview)).code,0,'a changed source cannot resume an existing review')
 // A complete Simple Analytics file uses the same public workflow and checkpoints.
 const simple=join(privateDir,'simple.csv'),simpleReview=join(privateDir,'simple-review')
 await writeFile(simple,'added_iso,path,uuid,session_id,utm_source\n'+Array.from({length:1003},(_,i)=>`2024-03-14T10:00:00Z,/,simple-raw-${i},private-simple-session,newsletter\n`).join(''))
 const simplePreviewArgs=['preview','--origin',origin,'--site',site,'--format','simple','--input',simple,'--cookie-file',cookie,'--review-dir',simpleReview]
 previewCalls=0;interruptPreview=true
 const simpleInterrupted=await command(simplePreviewArgs);assert.notEqual(simpleInterrupted.code,0);assert.match(simpleInterrupted.stderr,/HTTP_503/)
 const simpleCheckpoint=JSON.parse(await readFile(join(simpleReview,'manifest.json'),'utf8'))
 assert.equal(simpleCheckpoint.complete,false);assert.equal(simpleCheckpoint.rows,500)
 assert.equal((await a.dump()).vane_import_events.length,1003,'Simple Analytics preview publishes no rows')
 interruptPreview=false
 const simplePreview=await command(simplePreviewArgs);assert.equal(simplePreview.code,0,simplePreview.stderr)
 const simpleApplyArgs=['apply','--review-dir',simpleReview,'--cookie-file',cookie,'--yes']
 applyCalls=0;interruptApplyAt=26;interruptApply=true
 const simpleLost=await command(simpleApplyArgs);assert.notEqual(simpleLost.code,0);assert.match(simpleLost.stderr,/HTTP_REQUEST_FAILED/)
 const simpleDuring=(await a.dump()).vane_import_events.length
 assert.equal(simpleDuring,1003+520,'Simple Analytics loses a committed response just past the middle of its export')
 const simplePublicationCheckpoint=JSON.parse(await readFile(join(simpleReview,'manifest.json'),'utf8'))
 assert.equal(simplePublicationCheckpoint.pages[0].complete,true);assert.equal(simplePublicationCheckpoint.pages[1].complete,false)
 interruptApply=false
 const simpleApply=await command(simpleApplyArgs);assert.equal(simpleApply.code,0,simpleApply.stderr)
 assert.equal((await command(simpleApplyArgs)).code,0,'Simple Analytics completed application resumes without duplicates')
 assert.equal((await a.dump()).vane_import_events.length,2006)
 const simpleSummary=await a.request(`/api/vane/summary?siteId=${site}&from=2024-03-14&to=2024-03-15`,{headers:{cookie:a.owner}})
 const simpleReport=await simpleSummary.json();assert.equal(simpleReport.pageviews,1003);assert.equal(simpleReport.unknownCoverage,1003)
 const simpleFiles=await files(simpleReview);assert.ok(!simpleFiles.includes('simple-raw-'));assert.ok(!simpleFiles.includes('private-simple-session'))
 const simpleStored=JSON.stringify(await a.dump());assert.ok(!simpleStored.includes('simple-raw-'));assert.ok(!simpleStored.includes('private-simple-session'))
 assert.ok(![failed.stdout,failed.stderr,lost.stdout,lost.stderr,prepared.stdout,prepared.stderr].join('').includes(a.owner),'credentials never enter command output')
 const journals=(await a.dump()).vane_import_approvals;assert.equal(journals.length,6,'six reviewed page jobs keep ordinary custody and undo')
 for(const entry of journals){let undone;do{const r=await a.post('/api/vane/import-undo',{siteId:site,jobId:entry.job_id},a.owner);assert.equal(r.status,200,await r.clone().text());undone=await r.json()}while(!undone.complete)}
 assert.equal((await a.dump()).vane_import_events.length,0,'ordinary undo removes every completed page')
})

test('IMPORT-006 whole PostHog JSON Lines preview and apply resume after interruption and a lost response, deduplicate across pages, discard identifiers and undo through the public doors',async t=>{
 const root=await mkdtemp(join(tmpdir(),'vane-posthog-'));t.after(()=>rm(root,{recursive:true,force:true}))
 let a,previewCalls=0,applyCalls=0,interruptPreview=true,interruptApply=false
 const sizes=[]
 const server=createServer(async(req,res)=>{try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks)
  const headers={...req.headers};delete headers.host
  if(req.url==='/api/vane/import-preview'){
   previewCalls++;const payload=JSON.parse(body),document=JSON.parse(payload.document)
   sizes.push({rows:document.results.length,bytes:Buffer.byteLength(payload.document)})
   if(interruptPreview&&previewCalls===2){res.writeHead(503);res.end();return}
  }
  const response=await a.request(req.url,{method:req.method,headers,...(body.length?{body}:{})})
  if(req.url==='/api/vane/import-apply'&&interruptApply&&++applyCalls===2){req.socket.destroy();return}
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
 }catch{res.writeHead(500);res.end()}})
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)))
 const origin=`http://127.0.0.1:${server.address().port}`
 a=await installation({origin});t.after(()=>a.close())
 const site=await a.addSite({paths:[],goals:{},retainForever:true}),cookie=join(root,'session'),input=join(root,'posthog.jsonl'),review=join(root,'review')
 await writeFile(cookie,a.owner,{mode:0o600})
 const event=i=>({uuid:`raw-posthog-${i}`,event:'$pageview',timestamp:i%2?'2024-03-13T23:30:00-02:00':'2024-03-13T10:00:00Z',distinct_id:'private-person',properties:{$current_url:'https://fern.example/pricing?utm_source=newsletter&utm_campaign=launch&private=discard',$session_id:'private-session',$device_id:'private-device',$user_id:'private-user',$ip:'198.51.100.77',$title:'private-title-'+(i<3?'🙂'.repeat(190000):'small')}})
 // Byte-sized pages split before 500 rows; UTF-8 strings cross stream buffers.
 // A repeated ID on a later page must retain one identity after a lost response.
 const source='\uFEFF'+Array.from({length:1003},(_,i)=>JSON.stringify(event(i))).join('\r\n')+'\r\n\r\n'+JSON.stringify(event(0))
 await writeFile(input,source)
 const preview=['preview','--origin',origin,'--site',site,'--format','posthog','--input',input,'--cookie-file',cookie,'--review-dir',review]
 const apply=['apply','--review-dir',review,'--cookie-file',cookie,'--yes']
 const failed=await command(preview);assert.notEqual(failed.code,0);assert.match(failed.stderr,/IMPORT_ERROR HTTP_503/)
 let manifest=JSON.parse(await readFile(join(review,'manifest.json'),'utf8'))
 assert.equal(manifest.complete,false);assert.equal(manifest.pages.length,1)
 assert.equal((await a.dump()).vane_import_events.length,0,'preview never publishes')
 assert.notEqual((await command(apply)).code,0,'an interrupted preview cannot be applied')
 interruptPreview=false
 const prepared=await command(preview);assert.equal(prepared.code,0,prepared.stderr)
 manifest=JSON.parse(await readFile(join(review,'manifest.json'),'utf8'))
 assert.equal(manifest.complete,true);assert.equal(manifest.rows,1004);assert.ok(manifest.pages.length>=3)
 assert.ok(sizes.every(page=>page.rows<=500&&page.bytes<=2_000_000),'requests stay bounded by rows and UTF-8 document bytes')
 assert.equal(sizes[0].rows,2,'the byte limit flushes a page before the row limit')
 const beforeResume=previewCalls
 assert.equal((await command(preview)).code,0);assert.equal(previewCalls,beforeResume,'saved reviewed pages are reused')
 const secrets=['raw-posthog-','private-person','private-session','private-device','private-user','198.51.100.77','private-title','private=discard','https://fern.example/pricing']
 for(const secret of secrets)assert.ok(!(await files(review)).includes(secret),secret+' absent from sanitized review')
 interruptApply=true
 const lost=await command(apply);assert.notEqual(lost.code,0);assert.match(lost.stderr,/IMPORT_ERROR HTTP_REQUEST_FAILED/)
 const during=(await a.dump()).vane_import_events.length;assert.ok(during>0&&during<1003,'lost response follows committed work')
 interruptApply=false
 const resumed=await command(apply);assert.equal(resumed.code,0,resumed.stderr)
 assert.equal((await command(apply)).code,0)
 const dump=await a.dump();assert.equal(dump.vane_import_events.length,1003,'repeated IDs and lost responses never double count')
 for(const secret of secrets)assert.ok(!JSON.stringify(dump).includes(secret),secret+' absent from durable custody')
 const summary=async(from,to)=>{const response=await a.request(`/api/vane/summary?siteId=${site}&from=${from}&to=${to}`,{headers:{cookie:a.owner}});assert.equal(response.status,200);return response.json()}
 const first=await summary('2024-03-13','2024-03-14'),second=await summary('2024-03-14','2024-03-15')
 assert.equal(first.pageviews,502);assert.equal(second.pageviews,501)
 assert.equal(first.unknownCoverage,502);assert.equal(second.unknownCoverage,501)
 assert.ok(dump.vane_import_events.every(row=>row.source==='newsletter'&&row.campaign==='launch'&&row.path==='/pricing'),'declared anonymous fields survive')
 await browserProof(a,origin,site,'posthog')
 for(const output of [failed,prepared,lost,resumed])assert.ok(!(output.stdout+output.stderr).includes(a.owner),'CLI diagnostics never contain credentials')
 for(const entry of dump.vane_import_approvals){
  const journal=await a.request(`/api/vane/import-journal?siteId=${site}&jobId=${entry.job_id}`,{headers:{cookie:a.owner}})
  assert.equal(journal.status,200,await journal.clone().text())
  assert.equal((await journal.json()).job.state,'completed')
  let undone;do{const response=await a.post('/api/vane/import-undo',{siteId:site,jobId:entry.job_id},a.owner);assert.equal(response.status,200);undone=await response.json()}while(!undone.complete)
 }
 assert.equal((await a.dump()).vane_import_events.length,0)
 await writeFile(input,source+'\n'+JSON.stringify(event(1004)))
 assert.notEqual((await command(preview)).code,0,'a changed file cannot resume the old review')
 // Invalid rows fail closed, including a malformed tail after an accepted page.
 for(const [name,content,diagnostic] of [
  ['malformed',Array.from({length:500},(_,i)=>JSON.stringify(event(i+10))).join('\n')+'\n{"uuid":','POSTHOG_INVALID_JSON_LINE'],
  ['array',JSON.stringify([event(10)]),'POSTHOG_EVENT_OBJECT_REQUIRED'],
  ['oversized',JSON.stringify({...event(10),properties:{$title:'🙂'.repeat(510000)}}),'POSTHOG_ROW_TOO_LARGE'],
  ['empty','\r\n  \n','POSTHOG_EMPTY'],
  ['type',JSON.stringify({...event(10),event:'person-updated'}),'HTTP_400'],
 ]){
  const bad=join(root,name+'.jsonl'),badReview=join(root,name+'-review');await writeFile(bad,content)
  const result=await command(['preview','--origin',origin,'--site',site,'--format','posthog','--input',bad,'--cookie-file',cookie,'--review-dir',badReview])
  assert.notEqual(result.code,0,name);assert.ok(result.stderr.includes(diagnostic),result.stderr)
  assert.notEqual((await command(['apply','--review-dir',badReview,'--cookie-file',cookie,'--yes'])).code,0,name+' cannot apply')
  assert.equal((await a.dump()).vane_import_events.length,0,name+' publishes no records')
 }
})
