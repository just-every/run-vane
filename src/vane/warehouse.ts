import { insist, role, rows, site, sites, statement, type Actor, type Env, type Site } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { localDay } from './visitors'
import { createInsightsService } from './reports'
import { seal, unseal } from './sealed'
import { toCsv } from './csv'
// API-002 (ct 12:12Z): the owner schedules a daily export of a site's rollups and anonymous event rows to an S3-compatible
// bucket: Amazon S3 or Cloudflare R2 (BigQuery and Snowflake load from such a bucket through their own S3 stage).
// Only the owner configures it; the secret key is sealed and never shown again; the endpoint is https and never a
// private, loopback or link-local address. Each site-local date is exported once, after it ends, as two CSV objects
// in the published schema; no visitor hash ever leaves. Every run, sent or refused, is audited with its row counts.
const PURPOSE='vane-warehouse-key-v1',DAY=86400000,MAX_DAYS_PER_RUN=7,RETRY_MS=3600000
const next=(d:string)=>new Date(Date.parse(d)+DAY).toISOString().slice(0,10),before=(d:string)=>new Date(Date.parse(d)-DAY).toISOString().slice(0,10)
export interface ExportConfig { site_id:string; endpoint:string; bucket:string; region:string; prefix:string; access_key_id:string; sealed_secret:string; last_day:string; next_attempt_at:number|null; last_result:string|null; created_by:string; created_at:number }
const ROLLUP_COLUMNS=[['date','DATE','Site-local date (the site time zone)'],['site_id','STRING','Vane site ID'],['visitors','INTEGER','Daily-unique visitors (METRIC-001)'],['visits','INTEGER','Visits (METRIC-002)'],['pageviews','INTEGER','Page loads, imported ones included'],['bounce_rate','FLOAT','Bounced visits as a percentage of visits, one decimal; empty without visits'],['views_per_visit','FLOAT','Page loads per visit, two decimals; empty without visits'],['visit_duration','INTEGER','Average visit duration in whole seconds; empty without visits'],['conversion_rate','FLOAT','Visits with a goal as a percentage of visits, one decimal; empty without visits']] as const
const EVENT_COLUMNS=[['id','STRING','Event ID; a goal or custom event carries its page load ID before the colon'],['site_id','STRING','Vane site ID'],['date','DATE','Site-local date'],['at','TIMESTAMP','When it arrived (UTC, ISO 8601); empty for imported rows'],['kind','STRING','pageview, or the goal name'],['hostname','STRING','Allowed hostname (DASH-013)'],['path','STRING','Redacted path (COLLECT-002)'],['query','STRING','Kept query parameters'],['search','STRING','Site-search term (DASH-012)'],['channel','STRING','Channel (DASH-004)'],['source','STRING','Source as stored'],['referrer','STRING','Referrer hostname and redacted path'],['utm_source','STRING',''],['utm_medium','STRING',''],['utm_campaign','STRING',''],['utm_term','STRING',''],['utm_content','STRING',''],['paid_click','INTEGER','1 when a click ID arrived (its value is never kept)'],['device','STRING','Device class'],['browser','STRING',''],['browser_version','STRING',''],['os','STRING',''],['os_version','STRING',''],['screen','STRING','Screen-size class'],['country','STRING','Country name'],['region','STRING','Subdivision name'],['city','STRING','City name'],['metro_code','STRING','US metro-area (Nielsen DMA®) code from Cloudflare'],['metro_name','STRING','The US metro name from the site owner’s approved metro-name table at export time; empty when unnamed'],['consent','STRING','Consent state'],['sample_rate','INTEGER','Sample rate in percent'],['scroll','INTEGER','Deepest scroll depth in percent'],['engaged_at','TIMESTAMP','Last engagement ping (UTC, ISO 8601)'],['lcp','INTEGER','Largest Contentful Paint, ms'],['inp','INTEGER','Interaction to Next Paint, ms'],['cls','FLOAT','Cumulative Layout Shift'],['load_ms','INTEGER','Page load time, ms']] as const
// The published schema (GET /api/v1/export-schema.json): object keys, CSV columns and types, and what is never exported.
export const exportSchema=()=>({version:1,format:'text/csv; charset=utf-8, RFC 4180 with a header row; a text value starting with =, +, - or @ carries a leading apostrophe so a spreadsheet never runs it',objects:{
 daily_rollups:{key:'<prefix>vane/<site_id>/daily_rollups/<date>.csv',rows:'One row: the site’s dashboard totals for that date',columns:ROLLUP_COLUMNS.map(([name,type,description])=>({name,type,description}))},
 events:{key:'<prefix>vane/<site_id>/events/<date>.csv',rows:'Every stored page load and goal event of that date',columns:EVENT_COLUMNS.map(([name,type,description])=>({name,type,description}))}},
 never:['visitor hash','daily salt','IP address','user agent'],schedule:'Each site-local date once, after it ends, checked every 5 minutes; a refused upload is retried after an hour'})
// An endpoint is an https origin (with a path and query for a webhook, API-003) whose host is a public name or address: not localhost or a .localhost, .local,
// .internal or .home.arpa name, a single-label name, or an IPv4/IPv6 literal in a private, loopback, link-local,
// carrier-grade NAT, unspecified or multicast range (IPv4-mapped IPv6 included).
export function publicHttps(value:string,withPath=false):URL {
 let url:URL;try{url=new URL(value)}catch{url=new URL('invalid:')}
 const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,''),v4=host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
 const privateV4=(a:number,b:number)=>a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)
 const refused=['localhost'].includes(host)||/\.(localhost|local|internal|home\.arpa)$/.test(host)||(!host.includes('.')&&!host.includes(':'))||(v4?privateV4(Number(v4[1]),Number(v4[2])):false)||(host.includes(':')&&(host==='::'||host==='::1'||/^f[cd]/.test(host)||/^fe[89ab]/.test(host)||host.startsWith('::ffff:')))
 insist(url.protocol==='https:'&&!url.username&&!url.password&&(withPath||url.pathname==='/'||url.pathname==='')&&!url.hash&&(withPath||!url.search)&&!refused,'endpoint',withPath?'Enter a public https address; private and local addresses are refused.':'Enter the bucket service’s https endpoint, such as https://<account>.r2.cloudflarestorage.com or https://s3.us-east-1.amazonaws.com; private and local addresses are refused.');
 return url
}
export async function saveExport(env:Env,actor:Actor,p:any) {
 role(actor);const value=await site(env,String(p.siteId??'')),endpoint=publicHttps(String(p.endpoint??'').trim()).origin
 const bucket=String(p.bucket??'').trim(),region=String(p.region??'').trim()||'auto',prefix=String(p.prefix??'').trim().replace(/^\/+/,''),accessKeyId=String(p.accessKeyId??'').trim(),secret=String(p.secretAccessKey??'')
 insist(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket),'bucket','Enter the bucket name: 3 to 63 lowercase letters, digits, dots or hyphens.')
 insist(/^[a-z0-9-]{1,32}$/.test(region),'region','Enter the region, such as auto for R2 or us-east-1 for S3.')
 insist(/^[A-Za-z0-9!_.*'()\/-]{0,200}$/.test(prefix)&&!prefix.includes('..'),'prefix','Use letters, digits and / - _ . ! * \' ( ) in the prefix, up to 200 characters.')
 insist(/^[A-Za-z0-9]{8,128}$/.test(accessKeyId),'access_key','Enter the access key ID.')
 insist(secret.length>=8&&secret.length<=256&&!/\s/.test(secret),'secret','Enter the secret access key; it is sealed and never shown again.')
 const today=localDay(clock(),value.config.timeZone??'UTC'),from=String(p.from??'').trim()||before(today)
 insist(/^\d{4}-\d{2}-\d{2}$/.test(from)&&new Date(Date.parse(from)).toISOString().slice(0,10)===from&&from<today,'from','The first exported date is a past date, such as yesterday.')
 const normalized=prefix&&!prefix.endsWith('/')?prefix+'/':prefix
 await env.DB.batch([statement(env,'INSERT INTO vane_exports(site_id,endpoint,bucket,region,prefix,access_key_id,sealed_secret,last_day,next_attempt_at,last_result,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,NULL,NULL,?,?) ON CONFLICT(site_id) DO UPDATE SET endpoint=excluded.endpoint,bucket=excluded.bucket,region=excluded.region,prefix=excluded.prefix,access_key_id=excluded.access_key_id,sealed_secret=excluded.sealed_secret,last_day=excluded.last_day,next_attempt_at=NULL,last_result=NULL,created_by=excluded.created_by,created_at=excluded.created_at',value.id,endpoint,bucket,region,normalized,accessKeyId,await seal(env,PURPOSE,value.id,secret),before(from),actor.id,clock()),
  auditStatement(env,actor.id,'export.configure',value.id,`daily export to ${new URL(endpoint).host}/${bucket}/${normalized} from ${from}, key ${accessKeyId}`)])
 return value.id
}
export async function deleteExport(env:Env,actor:Actor,siteId:string) {
 role(actor);const value=await site(env,siteId)
 await env.DB.batch([statement(env,'DELETE FROM vane_exports WHERE site_id=?',value.id),auditStatement(env,actor.id,'export.delete',value.id,'scheduled export stopped; its sealed key erased')])
 return value.id
}
export const exportOf=async(env:Env,siteId:string)=>(await rows<ExportConfig>(env,'SELECT * FROM vane_exports WHERE site_id=?',siteId))[0]??null
// One date's two objects, from the report service the dashboard uses and the stored rows without the visitor hash.
async function objects(env:Env,value:Site,date:string) {
 const r=await createInsightsService(env,value,clock(),{from:date,to:next(date)}).list() as any
 const rollup=[{date,site_id:value.id,visitors:r.visitors,visits:r.visits,pageviews:r.pageviews,bounce_rate:r.bounceRate,views_per_visit:r.pagesPerVisit,visit_duration:r.averageDuration,conversion_rate:r.conversionRate}]
 const iso=(ms:unknown)=>ms===null||ms===undefined?null:new Date(Number(ms)).toISOString()
 const events=(await rows(env,"SELECT id,site_id,day AS date,at,kind,hostname,path,query,search,channel,source,referrer,utm_source,utm_medium,NULLIF(campaign,'none') AS utm_campaign,utm_term,utm_content,paid_click,device,browser,browser_version,os,os_version,screen,country,region,city,metro_code,(SELECT n.metro_name FROM vane_metro_names n WHERE n.site_id=vane_events.site_id AND n.metro_code=vane_events.metro_code) AS metro_name,consent,sample_rate,scroll,engaged_at,lcp,inp,cls,load_ms FROM vane_events WHERE site_id=? AND day=? ORDER BY at,id",value.id,date)).map(e=>({...e,at:iso(e.at),engaged_at:iso(e.engaged_at)}))
 const csv=(columns:readonly (readonly [string,string,string])[],list:Record<string,unknown>[])=>list.length?toCsv(list.map(row=>Object.fromEntries(columns.map(([name])=>[name,row[name]??null])))):columns.map(([name])=>name).join(',')+'\r\n'
 return {rollup:csv(ROLLUP_COLUMNS,rollup),events:csv(EVENT_COLUMNS,events),counts:{rollups:rollup.length,events:events.length}}
}
const utf8=new TextEncoder(),hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')
const sha256=async(text:string)=>hex(await crypto.subtle.digest('SHA-256',utf8.encode(text)))
const hmac=async(key:ArrayBuffer|Uint8Array<ArrayBuffer>,text:string)=>crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']),utf8.encode(text))
const segment=(part:string)=>encodeURIComponent(part).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())
// An AWS Signature Version 4 PUT (path-style), as S3 and R2 accept.
async function put(config:ExportConfig,secret:string,key:string,body:string) {
 const url=new URL(config.endpoint),path=`/${config.bucket}/${key.split('/').map(segment).join('/')}`,stamp=new Date().toISOString().replace(/[-:]|\.\d{3}/g,''),date=stamp.slice(0,8),hash=await sha256(body)
 const headers:Record<string,string>={'content-type':'text/csv; charset=utf-8',host:url.host,'x-amz-content-sha256':hash,'x-amz-date':stamp},signed=Object.keys(headers).sort().join(';')
 const canonical=['PUT',path,'',...Object.keys(headers).sort().map(name=>`${name}:${headers[name]}`),'',signed,hash].join('\n'),scope=`${date}/${config.region}/s3/aws4_request`
 let signing:ArrayBuffer=await hmac(utf8.encode('AWS4'+secret),date);for(const part of [config.region,'s3','aws4_request'])signing=await hmac(signing,part)
 const signature=hex(await hmac(signing,['AWS4-HMAC-SHA256',stamp,scope,await sha256(canonical)].join('\n')))
 const {host:_,...sent}=headers
 return fetch(url.origin+path,{method:'PUT',redirect:'manual',headers:{...sent,authorization:`AWS4-HMAC-SHA256 Credential=${config.access_key_id}/${scope}, SignedHeaders=${signed}, Signature=${signature}`},body})
}
// Exports each ended site-local date after last_day, at most seven per run; a refused upload stops the run, is audited
// and holds the export back for an hour. Returns the dates sent.
export async function runExport(env:Env,config:ExportConfig,now=clock()):Promise<string[]> {
 const value=await site(env,config.site_id),yesterday=before(localDay(now,value.config.timeZone??'UTC')),sent:string[]=[]
 let secret='';try{secret=await unseal(env,PURPOSE,config.site_id,config.sealed_secret)}catch{}
 for(let date=next(config.last_day);date<=yesterday&&sent.length<MAX_DAYS_PER_RUN;date=next(date)){
  const files=await objects(env,value,date),base=`${config.prefix}vane/${value.id}`
  let failure=secret?'':'the sealed key cannot be opened with this installation’s session secret; enter the key again'
  for(const [key,body] of failure?[]:[[`${base}/daily_rollups/${date}.csv`,files.rollup],[`${base}/events/${date}.csv`,files.events]] as const){
   try{const r=await put(config,secret,key,body);if(!r.ok){failure=`HTTP ${r.status} from ${new URL(config.endpoint).host}`;break}}catch{failure=`no answer from ${new URL(config.endpoint).host}`;break}
  }
  const detail=failure?`${date} refused: ${failure}; 0 rows sent, retried after an hour`:`${date}: ${files.counts.rollups} rollup row and ${files.counts.events} event rows to ${new URL(config.endpoint).host}/${config.bucket}/${base}/`
  await env.DB.batch([statement(env,'UPDATE vane_exports SET last_day=?,next_attempt_at=?,last_result=? WHERE site_id=?',failure?config.last_day:date,failure?now+RETRY_MS:null,detail,config.site_id),auditStatement(env,'scheduled-export',failure?'export.fail':'export.run',config.site_id,detail)])
  if(failure)break
  config={...config,last_day:date};sent.push(date)
 }
 return sent
}
// The cron: every configured export that is not held back after a refusal.
export async function runExports(env:Env,now=clock()) {
 const known=new Set((await sites(env)).map(s=>s.id))
 for(const config of await rows<ExportConfig>(env,'SELECT * FROM vane_exports WHERE next_attempt_at IS NULL OR next_attempt_at<=?',now))if(known.has(config.site_id))await runExport(env,config,now)
}
// The owner's Run now: the same run for one site, held back or not.
export async function runExportNow(env:Env,actor:Actor,siteId:string) {
 role(actor);const config=await exportOf(env,(await site(env,siteId)).id);insist(config,'export','Set up the scheduled export first.',404)
 return runExport(env,config)
}
