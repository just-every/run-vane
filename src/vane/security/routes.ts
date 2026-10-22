import type { OperatorAuth, Session } from '../../modules/operator-auth/index.mjs'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { insist, VaneError, type Env } from '../core'
import { audit } from '../audit'
import { pendingSecurity, saveSecurityPolicy, securityPolicy } from './policy'
import { beginTotp, confirmTotp, totpState, verifyTotp } from './totp'
import { securityPage } from './page'
import { ownerBreakGlass } from './break-glass'
import { configuredScimIssuers, issueScimCredential, listScimCredentials, revokeScimCredential } from './scim-credentials'

const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}})
const redirect=(path:string)=>new Response(null,{status:303,headers:{location:path,'cache-control':'no-store'}})
const destination=(pending:string)=>pending==='sso'?'/auth/security/sso':`/auth/security/${pending}`
// Only the primary sign-in and minimal second-step ceremonies remain open while held.
export async function securityFence(request:Request,env:Env,auth:OperatorAuth):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(!/^\/(app(?:\/|$)|setup(?:\/|$)|api\/vane(?:\/|$)|_serverFn(?:\/|$)|auth(?:\/|$))/.test(path))return null
 if(path.startsWith('/auth/security')||/^\/auth\/oidc\/[^/]+\/(start|callback)$/.test(path)||['/auth/saml/start','/auth/saml/callback','/auth/signout','/auth/magic-link','/auth/confirm','/auth/owner-signin'].includes(path))return null
 try {
  const session=await auth.getSession(request)
  if(!session)return null
  const pending=await pendingSecurity(env,session)
  if(!pending)return null
  return request.method==='GET'&&!path.startsWith('/api/')?redirect(destination(pending)):json({error:pending==='sso'?'sso_required':'second_step_required',enrollment:destination(pending)},403)
 }catch(error){if(error instanceof AuthError)return json({error:error.code},error.status);throw error}
}
export async function securityResponse(request:Request,env:Env,auth:OperatorAuth):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(!path.startsWith('/auth/security'))return null
 let session:Session|null=null
 try {
  session=await auth.getSession(request)
  if(!session)return json({error:'authentication_required'},401)
  if(path==='/auth/security/break-glass')return await ownerBreakGlass(request,env,session)
  const pending=await pendingSecurity(env,session)
  if(pending==='sso')return securityPage({mode:'sso',status:path==='/auth/security/sso'?200:403})
  if(path==='/auth/security/sso')return redirect('/app')
  const enrollment=path.startsWith('/auth/security/enroll'),challenge=path==='/auth/security/challenge'||path==='/auth/security/verify'
  if(pending&&!(pending==='enroll'&&enrollment)&&!(pending==='challenge'&&challenge))return redirect(destination(pending))
  const state=await totpState(env,session.operator.id)
  if(request.method==='GET') {
   if(path==='/auth/security/enroll')return securityPage({mode:'enroll'})
   if(path==='/auth/security/challenge')return securityPage({mode:'challenge'})
   if(path!=='/auth/security')return json({error:'not_found'},404)
   return securityPage({mode:'settings',owner:session.operator.role==='owner',enrolled:state.enrolled,policy:await securityPolicy(env),providers:session.operator.role==='owner'?(await auth.identitySettings(request)).idpSignIn:undefined,saml:Boolean(env.VANE_SAML_CONFIG),issuers:session.operator.role==='owner'?configuredScimIssuers(env):undefined,scim:session.operator.role==='owner'?await listScimCredentials(env):undefined})
  }
  insist(request.method==='POST','method','Use POST.',405)
  insist(request.headers.get('origin')===env.AUTH_ORIGIN&&request.headers.get('sec-fetch-site')!=='cross-site','origin','Same-origin approval is required.',403)
  const text=await request.text();insist(new TextEncoder().encode(text).length<=4096,'size','The request is too large.',413)
  const input:Record<string,unknown>=(request.headers.get('content-type')??'').startsWith('application/json')?JSON.parse(text):Object.fromEntries(new URLSearchParams(text))
  if(path==='/auth/security/scim/issue') {
   const issued=await issueScimCredential(env,session,input)
   return (request.headers.get('content-type')??'').startsWith('application/json')?json(issued):securityPage({mode:'scim-credential',credential:issued.credential})
  }
  if(path==='/auth/security/scim/revoke') {const revoked=await revokeScimCredential(env,session,input);return (request.headers.get('content-type')??'').startsWith('application/json')?json(revoked):redirect('/auth/security')}
  if(path==='/auth/security/enroll/start')return securityPage({mode:'enroll',...await beginTotp(env,session.operator.id,session.id)})
  if(path==='/auth/security/enroll/confirm') {
   const codes=await confirmTotp(env,session.operator.id,session.id,String(input.code??''))
   await audit(env,session.operator.id,'security.enroll',session.operator.id,'TOTP enabled; recovery codes issued')
   return securityPage({mode:'recovery',codes})
  }
  if(path==='/auth/security/verify') {
   await verifyTotp(env,session.operator.id,session.id,String(input.code??''))
   await audit(env,session.operator.id,'security.verify',session.operator.id,'second step accepted')
   return redirect('/app')
  }
  if(path==='/auth/security/policy') {await saveSecurityPolicy(env,session,input);return redirect('/auth/security')}
  if(path==='/auth/security/identity') {insist(session.operator.role==='owner','forbidden','Only the owner enables providers.',403);await auth.setIdentitySettings(request,{idpSignIn:true});return redirect('/auth/security')}
  return json({error:'not_found'},404)
 } catch(error) {
  const known=error instanceof VaneError||error instanceof AuthError,message=error instanceof VaneError?error.message:'The sign-in security operation was refused.'
  if(session&&path==='/auth/security/verify')return securityPage({mode:'challenge',error:message,status:known?error.status:400})
  return json({error:known?error.code:'invalid_operation',message},known?error.status:400)
 }
}
