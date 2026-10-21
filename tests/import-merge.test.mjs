import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { installation } from './harness.mjs'

const api=JSON.parse(await readFile(new URL('./fixtures/plausible/history-api.json',import.meta.url),'utf8')),umami=JSON.parse(await readFile(new URL('./fixtures/umami-events.json',import.meta.url),'utf8'))
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()}
const dated=day=>JSON.parse(JSON.stringify(api).replaceAll('2026-10-01',day))
const ga4=(from,to,days)=>({format:'vane-ga4-history/1',property:'properties/1234',from,to,reports:[{dimensionHeaders:[{name:'date'}],metricHeaders:['sessions','totalUsers','screenPageViews'].map(name=>({name,type:'TYPE_INTEGER'})),rows:days.map(day=>({dimensionValues:[{value:day.replaceAll('-','')}],metricValues:[{value:'41'},{value:'30'},{value:'76'}]})),rowCount:days.length,metadata:{currencyCode:'EUR',timeZone:'Europe/Berlin',subjectToThresholding:true}}]})
async function apply(a,siteId,p){for(let n=0;n<100;n++){const r=await json(await a.post('/api/vane/import-apply',{siteId,document:p.carry,fingerprint:p.fingerprint},a.owner));if(r.complete)return r}assert.fail('import did not complete')}
const preview=(a,siteId,document)=>a.post('/api/vane/import-preview',{siteId,document},a.owner)
const csvTotal=(text,column)=>{const [head,...lines]=text.trim().split('\r\n'),at=head.split(',').indexOf(column);assert.ok(at>=0,column);return lines.reduce((sum,line)=>sum+Number(line.split(',')[at]),0)}

test('IMPORT-007 a later source skips the days an earlier import holds, names them in its preview and journal, and leaves those days with the first source alone',async t=>{
 const a=await installation();t.after(()=>a.close())
 const siteId=await a.addSite({paths:[],goals:{},retainForever:true})
 const held=await json(await preview(a,siteId,dated('2024-06-04')));assert.ok(held.aggregates.length);assert.deepEqual(held.skipped,[]);await apply(a,siteId,held)
 const days=['2024-06-01','2024-06-02','2024-06-03','2024-06-04'],document=ga4('2024-06-01','2024-06-04',days)
 const p=await json(await preview(a,siteId,document))
 assert.deepEqual(p.skipped,[{day:'2024-06-04',provider:'plausible'}])
 assert.deepEqual([...new Set(p.aggregates.map(r=>r.day))].sort(),days.slice(0,3));assert.ok(p.aggregates.every(r=>r.provider==='ga4'))
 // The owner's review page names each skipped day and its holder before anything is applied.
 const page=await a.form({operation:'import.preview',siteId,document:JSON.stringify(document)},a.owner);assert.equal(page.status,200);const html=await page.text()
 assert.match(html,/data-overlap-days[^>]*>[\s\S]*2024-06-04: held by Plausible/)
 const done=await apply(a,siteId,p)
 const journal=await json(await a.request(`/api/vane/import-journal?siteId=${siteId}&jobId=${done.job.id}`,{headers:{cookie:a.owner}}))
 assert.deepEqual(journal.skipped,[{day:'2024-06-04',provider:'plausible'}]);assert.equal(journal.provenance.length,p.aggregates.length)
 const totals=async(from,to)=>(await json(await a.request(`/api/vane/summary?siteId=${siteId}&from=${from}&to=${to}`,{headers:{cookie:a.owner}}))).importedReports
 const overlap=await totals('2024-06-04','2024-06-05');assert.ok(overlap.length);assert.ok(overlap.every(r=>r.provider==='plausible'),'the held day shows only the first source')
 assert.ok((await totals('2024-06-01','2024-06-04')).every(r=>r.provider==='ga4'))
 // Nothing new to import is refused, and the first source stays as it was.
 assert.equal((await preview(a,siteId,ga4('2024-06-04','2024-06-04',['2024-06-04']))).status,409)
 assert.equal((await totals('2024-06-04','2024-06-05')).length,overlap.length)
})

test('IMPORT-007 any viewer switches imported data off and on for the dashboard, its comparison, CSV tables, shared link and both Stats API doors',async t=>{
 const a=await installation();t.after(()=>a.close())
 const id=await a.addSite(),range='from=2026-10-01&to=2026-10-06'
 await a.clock(Date.parse('2026-10-05T12:00:00Z'));assert.equal((await a.collect(a.event(id))).status,202)
 const imported=await json(await preview(a,id,umami));await apply(a,id,imported)
 await apply(a,id,await json(await preview(a,id,ga4('2026-10-01','2026-10-02',['2026-10-01','2026-10-02']))))
 const summary=async (extra='')=>json(await a.request(`/api/vane/summary?siteId=${id}&${range}${extra}`,{headers:{cookie:a.owner}}))
 const on=await summary(),off=await summary('&imported=off')
 assert.equal(on.pageviews,3);assert.ok(on.imported>0&&on.unknownCoverage>0&&on.importedReports.length>0)
 assert.equal(off.pageviews,1);assert.equal(off.imported,0);assert.deepEqual(off.importedReports,[]);assert.equal(off.importedOff,true)
 assert.equal(off.previousPageviews,0,'the comparison leaves imported history out too')
 assert.deepEqual((await summary('&imported=on')).pages,on.pages,'switching back restores every figure')
 // CSV tables follow the choice.
 const csv=extra=>a.request(`/api/vane/csv?siteId=${id}&${range}&table=pages${extra}`,{headers:{cookie:a.owner}}).then(r=>r.text())
 assert.equal(csvTotal(await csv(''),'count'),3);assert.equal(csvTotal(await csv('&imported=off'),'count'),1)
 assert.equal((await a.request(`/api/vane/csv?siteId=${id}&${range}&table=importedSourceRows`,{headers:{cookie:a.owner}})).status,200)
 assert.equal((await a.request(`/api/vane/csv?siteId=${id}&${range}&table=importedSourceRows&imported=off`,{headers:{cookie:a.owner}})).status,404)
 // The dashboard shows the choice and its CSV links keep it.
 const dash=await (await a.request(`/app/sites/${id}?section=report&${range}&imported=off`,{headers:{cookie:a.owner}})).text()
 assert.match(dash,/name="imported" value="off" checked/);assert.match(dash,/data-csv="pages"/);assert.match(dash,/api\/vane\/csv\?[^"]*imported=off/)
 // Both Stats API doors take the same choice.
 const key=(await (await a.form({operation:'apikey.create',kind:'stats',label:'Reporting',[`site_${id}`]:'on'},a.owner)).text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1],auth={authorization:'Bearer '+key}
 const v1=async extra=>json(await a.request(`/api/v1/stats?site_id=${id}&${range}&metrics=pageviews${extra}`,{headers:auth}))
 assert.equal((await v1('')).results.pageviews,3);assert.equal((await v1('&imported=off')).results.pageviews,1);assert.equal((await v1('&imported=off')).imported,false)
 assert.equal((await a.request(`/api/v1/stats?site_id=${id}&${range}&imported=maybe`,{headers:auth})).status,400)
 const v2=async include=>json(await a.request('/api/v2/query',{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({site_id:id,metrics:['pageviews'],date_range:['2026-10-01','2026-10-05'],...(include?{include}:{})})}))
 assert.equal((await v2()).results[0].metrics[0],3);assert.equal((await v2({imports:false})).results[0].metrics[0],1);assert.equal((await v2({imports:false})).meta.imports_included,false)
 // A shared-link reader switches the same choice without signing in.
 const shared=await a.form({operation:'share.create',siteId:id,label:'Partners',share_totals:'on'},a.owner),url=(await shared.text()).match(/data-share-url>[^<]*(\/share\/vane_s_[0-9a-f]{64})</)[1]
 const tile=html=>Number(html.match(/Pageviews<\/h2><p class="vane-metric">([\d,]+)</)?.[1].replaceAll(',',''))
 const first=await (await a.request(`${url}?${range}`)).text();assert.equal(tile(first),3);assert.match(first,/data-imported-state="on"/)
 const link=first.match(/data-imported-switch/)&&first.match(/href="(\?[^"]*)" data-imported-switch/)[1].replaceAll('&amp;','&');assert.match(link,/imported=off/)
 const hidden=await (await a.request(url+link)).text();assert.equal(tile(hidden),1);assert.match(hidden,/data-imported-state="off"/)
 const back=hidden.match(/href="(\?[^"]*)" data-imported-switch/)[1].replaceAll('&amp;','&');assert.doesNotMatch(back,/imported=/);assert.equal(tile(await (await a.request(url+back)).text()),3)
})
