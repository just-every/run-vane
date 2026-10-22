import { atomic, inScope, insist, role, rows, site, statement, type Actor, type Env } from '../core'
import { auditStatement } from '../audit'

export interface AskSetting { enabled:boolean; enabledAt:number|null; enabledBy:string|null; provider:boolean }
export const askEnabled=async(env:Env,siteId:string)=>(await rows(env,'SELECT 1 FROM vane_ask_sites WHERE site_id=?',siteId)).length>0
export async function askSetting(env:Env,actor:Actor,siteId:string):Promise<AskSetting> {
 inScope(actor,siteId);await site(env,siteId)
 const [row]=await rows<{enabled_at:number;enabled_by:string}>(env,'SELECT enabled_at,enabled_by FROM vane_ask_sites WHERE site_id=?',siteId)
 return {enabled:Boolean(row),enabledAt:row?.enabled_at??null,enabledBy:row?.enabled_by??null,provider:env.AI_ENABLED==='true'}
}
// Only the owner turns questions on or off, and each change is audited: enabling sends the question text of every
// member who asks to the model provider the deployment configured (AI_ENABLED), and nothing else.
export async function configureAsk(env:Env,actor:Actor,input:Record<string,unknown>) {
 role(actor);const siteId=String(input.siteId??'');inScope(actor,siteId)
 insist(Object.keys(input).every(k=>['siteId','enabled'].includes(k)),'ask_fields','Choose only the site and whether questions are enabled.')
 insist(input.enabled===true||input.enabled===false||input.enabled==='on'||input.enabled==='off','ask_enabled','Choose explicitly whether questions are enabled.')
 await site(env,siteId)
 const enabled=input.enabled===true||input.enabled==='on'
 await atomic(env,actor,[
  enabled?statement(env,'INSERT INTO vane_ask_sites(site_id,enabled_by,enabled_at) VALUES(?,?,?) ON CONFLICT(site_id) DO NOTHING',siteId,actor.id,Date.now()):statement(env,'DELETE FROM vane_ask_sites WHERE site_id=?',siteId),
  auditStatement(env,actor.id,'ask.configure',siteId,enabled?'enabled':'disabled'),
 ])
 return {siteId,enabled}
}
