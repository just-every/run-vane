import type { Session } from '../../modules/operator-auth/index.mjs'
import { insist, rows, statement, uid, VaneError, type Env } from '../core'
import { verifyTotp } from './totp'
import { securityPage } from './page'

// Only a fresh deployment-custody `rer signin` grant opens this recovery door.
// A normal owner session, email link or SCIM credential is insufficient.
const proof=`EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id
 JOIN oa_step_up_challenges p ON p.session_id=s.id AND p.operator_id=o.id
 WHERE s.id=? AND o.role='owner' AND o.status='active' AND s.operator_version=o.version
 AND s.revoked_at IS NULL AND s.expires_at>? AND p.operator_version=o.version
 AND p.action='owner:signin-link' AND p.consumed_at IS NOT NULL AND p.created_at>? )`

export async function ownerBreakGlass(request:Request,env:Env,session:Session):Promise<Response> {
 const now=Date.now(),args=[session.id,now,now-15*60*1000]
 insist(session.operator.role==='owner'&&(await rows(env,`SELECT 1 WHERE ${proof}`,...args)).length,'recovery_proof','Use a fresh rer signin owner link from the deployment to recover from an identity-provider outage.',403)
 const enrolled=Boolean((await rows(env,'SELECT 1 FROM vane_totp_credentials WHERE operator_id=?',session.operator.id)).length)
 const secondRequired=Boolean((await rows(env,'SELECT require_second FROM vane_security_policy WHERE singleton=1'))[0]?.require_second)
 insist(!secondRequired||enrolled,'recovery_factor','An enrolled owner authenticator is required.',403)
 const verified=Boolean((await rows(env,'SELECT 1 FROM vane_second_step_sessions WHERE session_id=? AND operator_id=?',session.id,session.operator.id)).length)
 if(request.method==='GET')return securityPage({mode:'break-glass',factor:enrolled&&!verified})
 insist(request.method==='POST','method','Use POST.',405)
 insist(request.headers.get('origin')===env.AUTH_ORIGIN&&request.headers.get('sec-fetch-site')!=='cross-site','origin','Same-origin approval is required.',403)
 const text=await request.text();insist(text.length<=4096,'size','The request is too large.',413)
 const input=(request.headers.get('content-type')??'').startsWith('application/json')?JSON.parse(text):Object.fromEntries(new URLSearchParams(text))
 insist(input.confirm==='disable-sso','confirmation','Confirm the identity-provider outage recovery.')
 if(enrolled&&!verified)try {await verifyTotp(env,session.operator.id,session.id,String(input.code??''))}catch(error) {
  if(error instanceof VaneError)return securityPage({mode:'break-glass',factor:true,error:error.message,status:error.status})
  throw error
 }
 // The audit and policy change share both a transaction and the live owner proof.
 await env.DB.batch([
  statement(env,`INSERT INTO vane_audit(id,at,actor,action,subject,detail) SELECT ?,?,?,'security.break-glass','installation','Owner disabled SSO during identity-provider outage; authenticator policy preserved' WHERE ${proof} AND EXISTS(SELECT 1 FROM vane_security_policy WHERE singleton=1 AND require_sso=1)`,uid(),now,session.operator.id,...args),
  statement(env,`UPDATE vane_security_policy SET require_sso=0 WHERE singleton=1 AND require_sso=1 AND ${proof}`,...args),
 ])
 return new Response(null,{status:303,headers:{location:'/auth/security','cache-control':'no-store'}})
}
