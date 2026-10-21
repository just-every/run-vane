import { digest, insist, type Config, type Env, type Site } from './core'
import { timedFrom } from './visits'

// Fixed calendar-month expiry from issuance, never refreshed by a later visit.
export function consentExpiry(createdAt:number,months:number):number {
 const created=new Date(createdAt),last=new Date(Date.UTC(created.getUTCFullYear(),created.getUTCMonth()+months+1,0)).getUTCDate()
 const expires=new Date(createdAt);expires.setUTCDate(1);expires.setUTCMonth(expires.getUTCMonth()+months);expires.setUTCDate(Math.min(created.getUTCDate(),last));return expires.getTime()
}
export function cleanConsented(input:any):Pick<Config,'consentedVisitors'|'consentLifetimeMonths'> {
 const enabled=input.consentedVisitors===true||input.consentedVisitors==='on',months=Number(input.consentLifetimeMonths??13)
 insist(Number.isInteger(months)&&months>=1&&months<=13,'consent_lifetime','Choose a consented identifier lifetime of 1 to 13 whole months.')
 return enabled?{consentedVisitors:true,consentLifetimeMonths:months}:{}
}
// Raw random IDs are used only in memory here; no statements, responses, logs or archives contain one.
export async function consentedIdentity(value:Site,request:Request,payload:any,now:number) {
 if(payload.consented===undefined)return null
 insist(value.config.consentedVisitors===true&&payload.consent==='granted'&&request.headers.get('dnt')!=='1'&&request.headers.get('sec-gpc')!=='1','consented','This site must enable consented visitors and the visitor must explicitly grant consent.',403)
 const token=payload.consented
 insist(token&&typeof token==='object'&&!Array.isArray(token)&&Object.keys(token).length===2&&Object.keys(token).every(k=>['id','createdAt'].includes(k))&&typeof token.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token.id)&&Number.isSafeInteger(token.createdAt)&&token.createdAt>0&&token.createdAt<=now,'consented','Use a random consented identifier with its issue time.')
 const expiresAt=consentExpiry(token.createdAt,value.config.consentLifetimeMonths??13)
 insist(now<expiresAt,'consented_expired','The consented identifier has expired.')
 return {hash:await digest('vane-consented-v1\0'+value.id+'\0'+token.id),createdAt:token.createdAt,expiresAt}
}
// Linked page-derived events must still have permission and an unexpired approved lifetime.
export function consentedPage(config:Config,request:Request,page:{consented_visitor?:string|null;consented_created_at?:number|null;consented_expires_at?:number|null},now:number,consent?:unknown) {
 if(!page.consented_visitor)return
 insist(config.consentedVisitors===true&&request.headers.get('dnt')!=='1'&&request.headers.get('sec-gpc')!=='1'&&(consent===undefined||consent==='granted'),'consented','A linked event needs current explicit consent and enabled consented mode.',403)
 insist(typeof page.consented_created_at==='number'&&typeof page.consented_expires_at==='number'&&now<Math.min(page.consented_expires_at,consentExpiry(page.consented_created_at,config.consentLifetimeMonths??13)),'consented_expired','The consented page identifier has expired.',403)
}
interface Cohort {week:string;visitors:number;weeks:{week:number;returning:number;retention:number|null;complete?:boolean}[]}
export async function consentedReport(env:Env,scope:string,from:string,to:string,events:string,goal:string|null) {
 const [totals,cohorts,attribution]=await env.DB.batch<any>([
  env.DB.prepare(`${timedFrom(events)}, firsts AS (SELECT site_id,consented_visitor,MIN(at) AS first_at,MIN(day) AS first_day FROM vane_events WHERE kind='pageview' AND consented_visitor IS NOT NULL AND site_id IN (SELECT value FROM json_each(?1)) GROUP BY site_id,consented_visitor), seen AS (SELECT e.*,f.first_day,f.first_at,COALESCE(q.starts,0) AS starts FROM ${events} e LEFT JOIN firsts f USING(site_id,consented_visitor) LEFT JOIN q ON q.id=e.id WHERE e.site_id IN (SELECT value FROM json_each(?1)) AND e.day>=?2 AND e.day<?3 AND e.kind='pageview') SELECT COUNT(*) AS pageviews,SUM(consented_visitor IS NOT NULL) AS consentedPageviews,COUNT(DISTINCT CASE WHEN consented_visitor IS NOT NULL THEN site_id||consented_visitor END) AS visitors,COUNT(DISTINCT CASE WHEN first_day>=?2 THEN site_id||consented_visitor END) AS newVisitors,COUNT(DISTINCT CASE WHEN starts=1 AND at>first_at THEN site_id||consented_visitor END) AS returningVisitors FROM seen`).bind(scope,from,to,null),
  env.DB.prepare(`WITH firsts AS (SELECT site_id,consented_visitor,MIN(day) AS first_day FROM vane_events WHERE kind='pageview' AND consented_visitor IS NOT NULL AND site_id IN (SELECT value FROM json_each(?1)) GROUP BY site_id,consented_visitor), members AS (SELECT *,date(first_day,'weekday 0','-6 days') AS cohort FROM firsts f WHERE first_day>=?2 AND first_day<?3 AND EXISTS(SELECT 1 FROM ${events} e WHERE e.site_id=f.site_id AND e.consented_visitor=f.consented_visitor AND e.kind='pageview' AND e.day>=?2 AND e.day<?3)), activity AS (SELECT DISTINCT e.site_id,e.consented_visitor,date(e.day,'weekday 0','-6 days') AS week FROM ${events} e WHERE e.site_id IN (SELECT value FROM json_each(?1)) AND e.day>=?2 AND e.day<?3 AND e.kind='pageview' AND e.consented_visitor IS NOT NULL) SELECT m.cohort,CAST((julianday(a.week)-julianday(m.cohort))/7 AS INTEGER) AS week,COUNT(*) AS visitors,(SELECT COUNT(*) FROM members n WHERE n.cohort=m.cohort) AS size FROM members m JOIN activity a USING(site_id,consented_visitor) GROUP BY m.cohort,a.week ORDER BY m.cohort,week`).bind(scope,from,to),
  // Both models count converting visits. Acquisition can precede the report range, within retained history.
  env.DB.prepare(`${timedFrom(events)}, conversions AS (SELECT q.* FROM q JOIN v USING(day,visitor,visit) WHERE q.starts=1 AND v.visit_converted=1 AND q.consented_visitor IS NOT NULL), touches AS (SELECT c.site_id,c.consented_visitor,c.id,(SELECT h.source FROM vane_events h WHERE h.site_id=c.site_id AND h.consented_visitor=c.consented_visitor AND h.kind='pageview' AND h.at<=c.at ORDER BY h.at,h.id LIMIT 1) AS first_source,(SELECT h.source FROM vane_events h WHERE h.site_id=c.site_id AND h.consented_visitor=c.consented_visitor AND h.kind='pageview' AND h.source<>'direct' AND h.at<=c.at ORDER BY h.at DESC,h.id DESC LIMIT 1) AS last_source FROM conversions c), models AS (SELECT 'First touch' AS model,first_source AS source,* FROM touches UNION ALL SELECT 'Last non-direct touch',COALESCE(last_source,'direct'),* FROM touches) SELECT model,source,COUNT(*) AS conversions,COUNT(DISTINCT site_id||consented_visitor) AS visitors FROM models GROUP BY model,source ORDER BY model,conversions DESC,source`).bind(scope,from,to,goal),
 ])
 const r=totals.results[0],pageviews=Number(r.pageviews),consentedPageviews=Number(r.consentedPageviews??0)
 const grouped=new Map<string,Cohort>()
 for(const r of cohorts.results){const cohort:Cohort=grouped.get(r.cohort)??{week:r.cohort,visitors:Number(r.size),weeks:[]};grouped.set(r.cohort,cohort);cohort.weeks.push({week:Number(r.week),returning:Number(r.visitors),retention:r.size?Math.round(Number(r.visitors)/Number(r.size)*1000)/10:null})}
 for(const cohort of grouped.values()){
  const observed=new Map(cohort.weeks.map(w=>[w.week,w]));cohort.weeks=[]
  for(let week=0;Date.parse(cohort.week)+week*604800000<Date.parse(to);week++){
   const active=observed.get(week);cohort.weeks.push({week,returning:active?.returning??0,retention:active?.retention??0,complete:Date.parse(cohort.week)+(week+1)*604800000<=Date.parse(to)})
  }
 }
 return {pageviews,consentedPageviews,share:pageviews?Math.round(consentedPageviews/pageviews*1000)/10:null,visitors:Number(r.visitors),newVisitors:Number(r.newVisitors),returningVisitors:Number(r.returningVisitors),cohorts:[...grouped.values()],attribution:attribution.results.map(r=>({model:r.model,source:r.source,conversions:Number(r.conversions),visitors:Number(r.visitors)}))}
}
