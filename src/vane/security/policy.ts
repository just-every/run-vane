import { insist, rows, statement, type Env } from '../core'
import { auditStatement } from '../audit'
import type { Session } from '../../modules/operator-auth/index.mjs'

export interface SecurityPolicy { sso:boolean; secondStep:boolean }
export async function securityPolicy(env:Env):Promise<SecurityPolicy> {
 const value=(await rows(env,'SELECT * FROM vane_security_policy WHERE singleton=1'))[0]
 return {sso:Boolean(value?.require_sso),secondStep:Boolean(value?.require_second)}
}
// Every native session is fenced on each request, including sessions created before enforcement.
export async function pendingSecurity(env:Env,session:Session):Promise<'sso'|'enroll'|'challenge'|null> {
 const policy=await securityPolicy(env)
 if(policy.sso&&session.kind!=='oidc')return 'sso'
 const enrolled=Boolean((await rows(env,'SELECT 1 FROM vane_totp_credentials WHERE operator_id=?',session.operator.id)).length)
 if(!enrolled)return policy.secondStep?'enroll':null
 return (await rows(env,'SELECT 1 FROM vane_second_step_sessions WHERE session_id=? AND operator_id=?',session.id,session.operator.id)).length?null:'challenge'
}
export async function saveSecurityPolicy(env:Env,session:Session,input:Record<string,unknown>) {
 insist(session.operator.role==='owner','forbidden','Only the owner changes sign-in requirements.',403)
 const sso=input.requireSso===true||input.requireSso==='on',second=input.requireSecond===true||input.requireSecond==='on'
 // Requirements take effect for owners too. Verify the owner's working route before enabling either.
 insist(!sso||session.kind==='oidc','sso_proof','Sign in through the identity provider before requiring SSO.',409)
 insist(!second||(await rows(env,'SELECT 1 FROM vane_totp_credentials t JOIN vane_second_step_sessions p ON p.operator_id=t.operator_id WHERE t.operator_id=? AND p.session_id=?',session.operator.id,session.id)).length,'second_step_proof','Enroll and confirm your second step before requiring it for everyone.',409)
 const now=Date.now()
 const result=await env.DB.batch([
  statement(env,`INSERT INTO vane_security_policy(singleton,require_sso,require_second) SELECT 1,?,? WHERE EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND o.role='owner' AND o.status='active' AND s.operator_version=o.version AND s.revoked_at IS NULL AND s.expires_at>?) ON CONFLICT(singleton) DO UPDATE SET require_sso=excluded.require_sso,require_second=excluded.require_second RETURNING singleton`,Number(sso),Number(second),session.id,now),
  auditStatement(env,session.operator.id,'security.policy','installation',`SSO ${sso?'required':'optional'}; second step ${second?'required':'optional'}`),
 ])
 insist(result[0]!.results.length,'authority_changed','Sign in again before changing the policy.',409)
 return {sso,secondStep:second}
}
