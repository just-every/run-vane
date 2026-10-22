import { transportSummary } from './proxy/summary'
import { allow, digest, inScope, insist, rows, site, statement, uid, VaneError, type Actor, type Env, type Site } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { localDay } from './visitors'
import { createInsightsService } from './reports'
import { moverText } from './explain'
import { operatorMail } from '../mail.server.mjs'
import { escape } from './views/html'
import { mailStop, STOPS } from './mail-events'
import { brandFor, emailBrand, reportOrigin } from './agency/branding'
import { teamActor } from './team'
// REPORT-001: daily, weekly and monthly email reports. Anyone who may open a site subscribes their own address; the
// owner also adds external recipients. A report is due at the chosen hour in the site's time zone (daylight saving
// included): daily ones every day for the day before, weekly ones on the chosen weekday (Monday by default) for the
// seven days before, monthly ones on the 1st for the month before. The cron checks every 5 minutes. A send keeps one
// delivery ID on every attempt, so the provider never delivers it twice; a temporary failure (no answer, rate limit or
// provider error) is retried after 15 minutes, 2 hours and 12 hours, then shows as failed, and a rejected message is a
// permanent failure, not retried. Every email has a one-click unsubscribe link. An address the mail provider later
// reports as bounced permanently, marked as spam or suppressed (mail-events.ts) gets no further report email: each
// send to it fails at once with that reason.
const DAY=86400000,RETRIES=[900000,7200000,43200000]
export const FREQUENCIES={daily:'Daily',weekly:'Weekly',monthly:'Monthly'} as const
export const WEEKDAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
type Frequency=keyof typeof FREQUENCIES
export interface Subscription { id:string; site_id:string; segment_id:string|null; email:string; operator_id:string|null; frequency:Frequency; weekday:number; hour:number; next_at:number; created_by:string; created_at:number }
const offset=(at:number,timeZone:string)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(at).map(x=>[x.type,x.value]));return Date.UTC(+p.year!,+p.month!-1,+p.day!,+p.hour!,+p.minute!,+p.second!)-Math.floor(at/1000)*1000}
// The instant of a local wall-clock hour, found from the zone's offset at that moment (twice, across a change).
export const instant=(day:string,hour:number,timeZone:string)=>{const wall=Date.parse(day)+hour*3600000;const first=wall-offset(wall,timeZone);return wall-offset(first,timeZone)}
const shift=(day:string,days:number)=>new Date(Date.parse(day)+days*DAY).toISOString().slice(0,10)
export function nextDue(s:Pick<Subscription,'frequency'|'weekday'|'hour'>,timeZone:string,after:number):number {
 const today=localDay(after,timeZone)
 for(let i=0;i<70;i++){const day=shift(today,i),d=new Date(Date.parse(day)),weekday=(d.getUTCDay()+6)%7+1
  if(s.frequency==='weekly'&&weekday!==s.weekday||s.frequency==='monthly'&&d.getUTCDate()!==1)continue
  const at=instant(day,s.hour,timeZone);if(at>after)return at}
 throw new VaneError('schedule','No send date found.')
}
const period=(frequency:Frequency,day:string)=>frequency==='daily'?[shift(day,-1),day]:frequency==='weekly'?[shift(day,-7),day]:[new Date(Date.UTC(+day.slice(0,4),+day.slice(5,7)-2,1)).toISOString().slice(0,10),day]
export async function subscribe(env:Env,actor:Actor,p:any) {
 allow(actor,'viewer');const value=await site(env,String(p.siteId??''));inScope(actor,value.id)
 const own=(await rows<{email:string}>(env,'SELECT email FROM oa_operators WHERE id=?',actor.id))[0]!.email,email=String(p.email??'').trim().toLowerCase()||own
 insist(/^[^\s@<>()",;]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)&&email.length<=254,'email','Enter a valid email address.')
 if(email!==own.toLowerCase())allow(actor,'owner')
 const frequency=String(p.frequency??'weekly') as Frequency,weekday=Number(p.weekday??1),hour=Number(p.hour??8),segment=String(p.segment??'')||null
 insist(Object.hasOwn(FREQUENCIES,frequency),'frequency','Choose daily, weekly or monthly.');insist(Number.isInteger(weekday)&&weekday>=1&&weekday<=7,'weekday','Choose a weekday.');insist(Number.isInteger(hour)&&hour>=0&&hour<=23,'hour','Choose an hour from 0 to 23.')
 if(segment)insist((await rows(env,'SELECT 1 FROM vane_segments WHERE id=? AND site_id=?',segment,value.id)).length,'segment','Choose one of this site’s segments.')
 insist(Number((await rows(env,'SELECT COUNT(*) AS n FROM vane_report_subscriptions WHERE site_id=?',value.id))[0].n)<50,'subscriptions','A site has at most 50 report subscriptions.')
 insist(!(await rows(env,'SELECT 1 FROM vane_report_subscriptions WHERE site_id=? AND email=? AND frequency=?',value.id,email,frequency)).length,'duplicate','This address already gets this report.',409)
 const token='vane_u_'+Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('')
 await env.DB.batch([statement(env,'INSERT INTO vane_report_subscriptions(id,site_id,segment_id,email,operator_id,frequency,weekday,hour,token_hash,next_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',uid(),value.id,segment,email,email===own.toLowerCase()?actor.id:null,frequency,weekday,hour,await digest(token),nextDue({frequency,weekday,hour},value.config.timeZone??'UTC',clock()),actor.id,clock()),auditStatement(env,actor.id,'report.subscribe',value.id,`${frequency} report for ${email===own.toLowerCase()?'their own address':'an external recipient'}`)])
 return {siteId:value.id,token}
}
export async function unsubscribe(env:Env,actor:Actor,id:string) {
 const found=(await rows<Subscription>(env,'SELECT * FROM vane_report_subscriptions WHERE id=?',id))[0];insist(found,'subscription','This subscription no longer exists.',404);inScope(actor,found.site_id)
 if(found.operator_id!==actor.id)allow(actor,'admin')
 await env.DB.batch([statement(env,'DELETE FROM vane_report_subscriptions WHERE id=?',id),auditStatement(env,actor.id,'report.unsubscribe',found.site_id,`${found.frequency} report`)])
 return found.site_id
}
// The public one-click door: GET (the link) or POST (List-Unsubscribe-Post) with the token ends the subscription.
export async function unsubscribeResponse(request:Request,env:Env):Promise<Response|null> {
 const match=new URL(request.url).pathname.match(/^\/reports\/unsubscribe\/(vane_u_[0-9a-f]{48})$/);if(!match)return null
 const page=(status:number,text:string)=>new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Vane reports</title><p>${escape(text)}</p></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'"}})
 if(!['GET','POST'].includes(request.method))return page(405,'Open the link from the email.')
 const found=(await rows<Subscription>(env,'SELECT * FROM vane_report_subscriptions WHERE token_hash=?',await digest(match[1]!)))[0]
 if(!found)return page(404,'This address is already unsubscribed from this report.')
 await env.DB.batch([statement(env,'DELETE FROM vane_report_subscriptions WHERE id=?',found.id),auditStatement(env,'unsubscribe-link','report.unsubscribe',found.site_id,`${found.frequency} report, by its one-click link`)])
 return page(200,`Unsubscribed: ${found.email} no longer gets this ${found.frequency} report.`)
}
function render(value:Site,s:Subscription,r:any,from:string,to:string,link:string) {
 const change=(now:number,then:number)=>then?` (${now>=then?'+':''}${((now-then)/then*100).toFixed(1)}% from ${then.toLocaleString('en-US')})`:` (${then.toLocaleString('en-US')} the period before)`
 const lines=[`${value.name}: ${FREQUENCIES[s.frequency].toLowerCase()} report, ${from} to ${shift(to,-1)} (${r.timeZone})${r.segment?`, segment ${r.segment.name}`:''}`,'',
  `Visitors: ${r.visitors}${change(r.visitors,r.previousVisitors)}`,`Visits: ${r.visits}${change(r.visits,r.previousVisits)}`,`Pageviews: ${r.pageviews}${change(r.pageviews,r.previousPageviews)}`,`Bounce rate: ${r.bounceRate??'none'}${r.bounceRate===null?'':'%'} (${r.previousBounceRate??'none'}${r.previousBounceRate===null?'':'%'} the period before)`,
  `Goal conversions: ${r.goals}${change(r.goals,r.previousGoals)}`,...(r.revenue?.total?[`Revenue: ${r.revenue.total} ${r.revenue.currency}`]:[]),'',
  'Top pages:',...(r.topPages??[]).slice(0,5).map((p:any)=>`- ${p.path}: ${p.pageviews} pageviews`),'','Top sources:',...(r.sourceVisits??[]).slice(0,5).map((p:any)=>`- ${p.label}: ${p.visits} visits`),'',
  'Goals:',...(Object.keys({...value.config.goals,...value.config.customGoals}).length?(r.goalBreakdown??[]).map((g:any)=>`- ${g.label}: ${g.count}`):['- none set']),'',
  `Coverage: ${r.complete===false?'partial; ':''}${(r.explain?.coverage??[]).filter((c:any)=>c.now||c.then).map((c:any)=>`${c.label} ${c.then} → ${c.now}`).join('; ')||'no coverage count changed'}.`,
  transportSummary(r.transport),
  `What moved: ${(r.explain?.movers??[]).map(moverText).join('; ')||'no channel, page, campaign or device changed'}.`,'',`Unsubscribe with one click: ${link}`]
 const text=lines.join('\n')
 return {subject:`${value.name}: ${FREQUENCIES[s.frequency].toLowerCase()} report, ${from} to ${shift(to,-1)}`,text,html:`<!doctype html><html><body><pre style="font:14px/1.5 system-ui,sans-serif;white-space:pre-wrap">${escape(text.replace(`Unsubscribe with one click: ${link}`,''))}</pre><p><a href="${escape(link)}">Unsubscribe with one click</a></p></body></html>`}
}
async function subscriptionAllowed(env:Env,s:Subscription) {
 const operator=(await rows<{id:string;role:string;status:string}>(env,'SELECT id,role,status FROM oa_operators WHERE '+(s.operator_id?'id=?':'email=?'),s.operator_id??s.email))[0]
 if(s.operator_id&&!operator||operator&&operator.status!=='active')return false
 if(!operator)return true
 // Even an external subscription to a known client address must respect its current client boundary.
 const actor=await teamActor(env,operator)
 return !actor.sites||actor.sites.includes(s.site_id)
}
async function deliver(env:Env,send:{id:string,subscription_id:string,site_id:string,email:string,period_from:string,period_to:string,attempts:number},now:number) {
 const s=(await rows<Subscription>(env,'SELECT * FROM vane_report_subscriptions WHERE id=?',send.subscription_id))[0]
 if(!s)return statement(env,"UPDATE vane_report_sends SET state='failed',reason=? WHERE id=?",'unsubscribed before it was sent',send.id).run()
 const stop=await mailStop(env,send.email)
 if(stop)return statement(env,"UPDATE vane_report_sends SET state='failed',next_at=?,reason=? WHERE id=?",now,`not sent: the mail provider reported an earlier report email to this address ${STOPS[stop.status]} on ${new Date(stop.occurred_at).toISOString().slice(0,10)}; reports to it stopped`,send.id).run()
 const value=await site(env,send.site_id),r=await createInsightsService(env,value,now,{from:send.period_from,to:send.period_to,compare:'previous',segment:s.segment_id}).list() as any
 // A fresh token per send keeps the link working while only its SHA-256 is stored.
 if(!await subscriptionAllowed(env,s))return statement(env,"UPDATE vane_report_sends SET state='failed',reason=? WHERE id=?",'recipient no longer has access to this site; not sent',send.id).run()
 const origin=await reportOrigin(env,send.site_id),brand=await brandFor(env,send.site_id)
 const token='vane_u_'+Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join(''),link=`${origin.replace(/\/$/,'')}/reports/unsubscribe/${token}`
 await statement(env,'UPDATE vane_report_subscriptions SET token_hash=? WHERE id=?',await digest(token),s.id).run()
 const message=render(value,s,r,send.period_from,send.period_to,link),mail=operatorMail(env)
 message.html=emailBrand(brand,origin,message.html)
 let status='',code='',messageId:string|null=null
 try{if(!mail)throw new Error('mail');const result=await mail.send({deliveryId:send.id,from:env.MAIL_FROM!,to:[send.email],...message,headers:{},...(link.startsWith('https://')?{unsubscribe:{url:link,oneClick:true}}:{})} as any);status=result.status;code=result.code??'';messageId=result.providerMessageId??null}catch{status='invalid'}
 const attempt=send.attempts+1,sent=status==='accepted'||status==='development',temporary=status==='uncertain'||status==='rate_limited'
 const reason=sent?null:temporary?(attempt>RETRIES.length?`temporary failure (${status}) on all ${attempt} attempts`:`temporary failure (${status}); retry in ${RETRIES[attempt-1]!/60000} min`):status==='invalid'?'mail is not configured or the message was refused before sending':`rejected by the mail provider${code?` (${code})`:''}; not retried`
 const state=sent?'sent':temporary&&attempt<=RETRIES.length?'pending':'failed'
 await statement(env,'UPDATE vane_report_sends SET state=?,attempts=?,next_at=?,reason=?,sent_at=?,provider_message_id=? WHERE id=?',state,attempt,state==='pending'?now+RETRIES[attempt-1]!:now,reason,sent?now:null,messageId,send.id).run()
}
export async function runReports(env:Env,now=clock()) {
 // Due subscriptions become sends (a removed member's own subscription ends instead).
 for(const s of await rows<Subscription&{status:string|null}>(env,'SELECT s.*,o.status FROM vane_report_subscriptions s LEFT JOIN oa_operators o ON o.id=s.operator_id WHERE s.next_at<=?',now)){
  if(s.operator_id&&s.status!=='active'||!await subscriptionAllowed(env,s)){await statement(env,'DELETE FROM vane_report_subscriptions WHERE id=?',s.id).run();continue}
  const value=await site(env,s.site_id),zone=value.config.timeZone??'UTC',[from,to]=period(s.frequency,localDay(s.next_at,zone))
  await env.DB.batch([statement(env,"INSERT INTO vane_report_sends(id,subscription_id,site_id,email,period_from,period_to,state,attempts,next_at,created_at) VALUES(?,?,?,?,?,?,'pending',0,?,?)",uid(),s.id,s.site_id,s.email,from,to,now,now),statement(env,'UPDATE vane_report_subscriptions SET next_at=? WHERE id=?',nextDue(s,zone,now),s.id)])
 }
 for(const send of await rows<any>(env,"SELECT * FROM vane_report_sends WHERE state='pending' AND next_at<=? ORDER BY created_at LIMIT 50",now))await deliver(env,send,now)
}
export const reportSubscriptions=(env:Env,siteId:string)=>rows<Subscription>(env,'SELECT * FROM vane_report_subscriptions WHERE site_id=? ORDER BY created_at',siteId)
export const reportSends=(env:Env,siteId:string)=>rows<{id:string,email:string,period_from:string,period_to:string,state:string,attempts:number,reason:string|null,created_at:number,sent_at:number|null,provider_status:string|null,provider_at:number|null}>(env,'SELECT id,email,period_from,period_to,state,attempts,reason,created_at,sent_at,provider_status,provider_at FROM vane_report_sends WHERE site_id=? ORDER BY created_at DESC LIMIT 20',siteId)
