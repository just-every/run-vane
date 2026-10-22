import { allow, atomic, digest, inScope, insist, rows, site, statement, VaneError, type Actor, type Env } from '../core'
import { auditStatement } from '../audit'
import { clock } from '../clock'
import { localDate } from '../annotations'
import { localDay } from '../visitors'
import { redactPath } from '../paths'
import { retentionCutoff } from '../retention'
export const EVIDENCE_METRICS=['orders','checkout-errors','uptime-failures'] as const
export type EvidenceMetric=typeof EVIDENCE_METRICS[number]
export interface AggregateEvidence {day:string;metric:EvidenceMetric;numerator:number;denominator:number;revision:number;url:string|null;received_at:number}
export async function evidenceSetting(env:Env,actor:Actor,siteId:string) {
 allow(actor,'owner');inScope(actor,siteId);await site(env,siteId)
 const [key]=await rows<{created_at:number}>(env,'SELECT created_at FROM vane_agent_evidence_keys WHERE site_id=?',siteId)
 return {enabled:Boolean(key),createdAt:key?.created_at??null}
}
export async function configureEvidence(env:Env,actor:Actor,p:any) {
 allow(actor,'owner');inScope(actor,String(p.siteId??''));const value=await site(env,String(p.siteId??''))
 insist(p.enabled==='on'||p.enabled==='off','evidence_setting','Choose on or off.')
 if(p.enabled==='off'){await atomic(env,actor,[statement(env,'DELETE FROM vane_agent_evidence_keys WHERE site_id=?',value.id),auditStatement(env,actor.id,'agent.evidence.disable',value.id,'incoming aggregate credential revoked')]);return {siteId:value.id}}
 insist(p.confirm==='on','evidence_consent','Explicitly approve receiving anonymous daily aggregates from your chosen sender.')
 const token='vane_ae_'+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')
 await atomic(env,actor,[statement(env,'INSERT INTO vane_agent_evidence_keys(site_id,secret_hash,created_by,created_at) VALUES(?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET secret_hash=excluded.secret_hash,created_by=excluded.created_by,created_at=excluded.created_at',value.id,await digest(token),actor.id,clock()),auditStatement(env,actor.id,'agent.evidence.enable',value.id,'owner explicitly approved incoming aggregates; prior credential revoked')])
 return {siteId:value.id,token}
}
// This key authenticates an owner-selected sender, not the provider or accuracy of its figures. No order IDs,
// customers, URLs with query strings, payload bodies or provider credentials are accepted or copied.
export async function evidenceDoor(request:Request,env:Env):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/api/vane/agent-evidence')return null
 const headers={'cache-control':'no-store','x-content-type-options':'nosniff'}
 try {
  insist(request.method==='POST','method','POST required.',405)
  const text=await request.text();insist(text.length<=2048,'body','Send at most 2048 bytes.',413)
  let p:any;try{p=JSON.parse(text)}catch{throw new VaneError('body','Send one daily aggregate as JSON.')}
  insist(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).every(k=>['siteId','day','metric','numerator','denominator','revision','url'].includes(k)),'fields','Only anonymous daily aggregates and an optional evidence URL are accepted.')
  const siteId=String(p.siteId??''),token=request.headers.get('authorization')?.match(/^Bearer (vane_ae_[0-9a-f]{64})$/)?.[1],hash=token?await digest(token):''
  const [key]=await rows<{secret_hash:string}>(env,'SELECT secret_hash FROM vane_agent_evidence_keys WHERE site_id=?',siteId)
  insist(key&&hash===key.secret_hash,'unauthorized','Send this site’s current aggregate-evidence credential.',401)
  const value=await site(env,siteId),day=localDate(p.day)
  const today=localDay(clock(),value.config.timeZone??'UTC'),cutoff=retentionCutoff(value.config,today)
  insist(day<=today,'day','Future dates cannot be reported.')
  insist((cutoff===null||day>=cutoff)&&!(await rows(env,'SELECT 1 FROM vane_deletions WHERE site_id=? AND before_day>? LIMIT 1',siteId,day)).length,'erased_evidence','This date is outside retention or was erased; old aggregates cannot be reintroduced.',409)
  insist((EVIDENCE_METRICS as readonly string[]).includes(p.metric),'metric','Choose orders, checkout-errors or uptime-failures.')
  insist([p.numerator,p.denominator].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1_000_000_000)&&p.numerator<=p.denominator,'counts','Counts must be whole numbers, with numerator no larger than denominator.')
  insist(Number.isSafeInteger(p.revision)&&p.revision>=1&&p.revision<=1_000_000,'revision','Send a positive revision, increasing when correcting this daily aggregate.')
  let url:string|null=null
  if(p.url!==undefined){let u:URL|undefined;try{u=new URL(p.url)}catch{}insist(u&&u.protocol==='https:'&&!u.username&&!u.password&&String(p.url).length<=500,'url','Use an https evidence URL without credentials.');url=u.origin+redactPath(u.pathname)}
  const contentHash=await digest(JSON.stringify([day,p.metric,p.numerator,p.denominator,url]))
  const [prior]=await rows<{revision:number;content_hash:string}>(env,'SELECT revision,content_hash FROM vane_agent_evidence WHERE site_id=? AND day=? AND metric=?',siteId,day,p.metric)
  if(prior&&p.revision<=prior.revision){insist(p.revision!==prior.revision||contentHash===prior.content_hash,'conflict','This revision already has different figures.',409);return Response.json({accepted:true,duplicate:p.revision===prior.revision,stale:p.revision<prior.revision},{headers})}
  const now=clock(),hour=Math.floor(now/3600000)
  const counted=await statement(env,'UPDATE vane_agent_evidence_keys SET requests=CASE WHEN window_start=? THEN requests+1 ELSE 1 END,window_start=? WHERE site_id=? AND secret_hash=? AND (window_start<>? OR requests<60)',hour,hour,siteId,hash,hour).run()
  insist(counted.meta.changes===1,'rate_limited','The sender is revoked or has reached 60 changed aggregates per site/hour.',429)
  const result=await statement(env,'INSERT INTO vane_agent_evidence(site_id,day,metric,numerator,denominator,revision,content_hash,url,received_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM vane_agent_evidence_keys WHERE site_id=? AND secret_hash=?) AND EXISTS(SELECT 1 FROM vane_sites WHERE id=? AND version=?) AND NOT EXISTS(SELECT 1 FROM vane_deletions WHERE site_id=? AND before_day>?) ON CONFLICT(site_id,day,metric) DO UPDATE SET numerator=excluded.numerator,denominator=excluded.denominator,revision=excluded.revision,content_hash=excluded.content_hash,url=excluded.url,received_at=excluded.received_at WHERE vane_agent_evidence.revision<excluded.revision',siteId,day,p.metric,p.numerator,p.denominator,p.revision,contentHash,url,now,siteId,hash,siteId,value.version,siteId,day).run()
  const active=(await rows(env,'SELECT 1 FROM vane_agent_evidence_keys WHERE site_id=? AND secret_hash=?',siteId,hash)).length
  insist(active,'unauthorized','The aggregate-evidence credential was revoked.',401)
  const [stored]=await rows<{revision:number;content_hash:string}>(env,'SELECT revision,content_hash FROM vane_agent_evidence WHERE site_id=? AND day=? AND metric=?',siteId,day,p.metric)
  insist(stored&&stored.revision>=p.revision,'conflict','The daily aggregate changed during receipt. Read it before retrying.',409)
  insist(stored.revision!==p.revision||stored.content_hash===contentHash,'conflict','This revision already has different figures.',409)
  return Response.json({accepted:true,changed:result.meta.changes===1},{status:201,headers})
 } catch(error){const e=error instanceof VaneError?error:new VaneError('evidence','Aggregate evidence could not be accepted.');return Response.json({error:e.code,message:e.message},{status:e.status,headers})}
}
export const sourceEvidence=(env:Env,siteId:string,from:string,to:string)=>rows<AggregateEvidence>(env,'SELECT day,metric,numerator,denominator,revision,url,received_at FROM vane_agent_evidence WHERE site_id=? AND day>=? AND day<? ORDER BY day,metric',siteId,from,to)
