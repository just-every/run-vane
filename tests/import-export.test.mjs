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

test('IMPORT-006 whole Umami and Simple Analytics CSV files preview in bounded pages, resume interrupted preview and publication, preserve totals without identifiers, and refuse changed sources or unreviewed apply',async t=>{
 const privateDir=await mkdtemp(join(tmpdir(),'vane-import-'));t.after(()=>rm(privateDir,{recursive:true,force:true}))
 let a,interruptPreview=false,interruptApply=false,previewCalls=0,applyCalls=0,maxRows=0
 const server=createServer(async(req,res)=>{try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks)
  const path=req.url,headers={...req.headers};delete headers.host
  if(path==='/api/vane/import-preview'){
   previewCalls++;const payload=JSON.parse(body);maxRows=Math.max(maxRows,payload.document.split('\n').length-1)
   if(interruptPreview&&previewCalls===2){res.writeHead(503);res.end();return}
  }
  const response=await a.request(path,{method:req.method,headers,...(body.length?{body}:{})})
  if(path==='/api/vane/import-apply'&&interruptApply&&++applyCalls===2){req.socket.destroy();return}
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
 if(process.env.VANE_SCREEN_DIR){
  const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try{
   const context=await browser.newContext();await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:origin}}))
   const page=await context.newPage();await mkdir(process.env.VANE_SCREEN_DIR,{recursive:true})
   for(const section of ['report','history'])for(const width of [1440,390]){
    await page.setViewportSize({width,height:960});await page.goto(`${origin}/app/sites/${site}?section=${section}&from=2024-03-13&to=2024-03-14`)
    await page.getByRole('heading',{name:section==='history'?'Import journal':'Overview',exact:true}).first().waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await page.screenshot({path:join(process.env.VANE_SCREEN_DIR,`csv-${section}-${width}.png`),fullPage:true})
   }
  }finally{await browser.close()}
 }
 const stored=JSON.stringify(await a.dump());for(const secret of ['private-session','private-site','private-title','raw-event-'])assert.ok(!stored.includes(secret),secret+' must not enter custody')
 await writeFile(umami,source.replace('/pricing','/other'))
 assert.notEqual((await command(preview)).code,0,'a changed source cannot resume an existing review')
 // A complete Simple Analytics file uses the same public workflow and checkpoints.
 const simple=join(privateDir,'simple.csv'),simpleReview=join(privateDir,'simple-review')
 await writeFile(simple,'added_iso,path,uuid,session_id,utm_source\n'+Array.from({length:503},(_,i)=>`2024-03-14T10:00:00Z,/,simple-raw-${i},private-simple-session,newsletter\n`).join(''))
 const simplePreview=await command(['preview','--origin',origin,'--site',site,'--format','simple','--input',simple,'--cookie-file',cookie,'--review-dir',simpleReview]);assert.equal(simplePreview.code,0,simplePreview.stderr)
 const simpleApply=await command(['apply','--review-dir',simpleReview,'--cookie-file',cookie,'--yes']);assert.equal(simpleApply.code,0,simpleApply.stderr)
 assert.equal((await a.dump()).vane_import_events.length,1506)
 const simpleFiles=await files(simpleReview);assert.ok(!simpleFiles.includes('simple-raw-'));assert.ok(!simpleFiles.includes('private-simple-session'))
 assert.ok(![failed.stdout,failed.stderr,lost.stdout,lost.stderr,prepared.stdout,prepared.stderr].join('').includes(a.owner),'credentials never enter command output')
 const journals=(await a.dump()).vane_import_approvals;assert.equal(journals.length,5,'five reviewed page jobs keep ordinary custody and undo')
 for(const entry of journals){let undone;do{const r=await a.post('/api/vane/import-undo',{siteId:site,jobId:entry.job_id},a.owner);assert.equal(r.status,200,await r.clone().text());undone=await r.json()}while(!undone.complete)}
 assert.equal((await a.dump()).vane_import_events.length,0,'ordinary undo removes every completed page')
})
