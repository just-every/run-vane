import product from '../../branding.json'
import { pageResponse } from '../../modules/operator-auth/page.mjs'
import { escape, field } from '../views/html'
import type { SecurityPolicy } from './policy'

const branding={productName:product.name,accentColor:product.primaryColor,theme:'/rer-theme.css'}
const submit=(action:string,label:string,body='')=>`<div class="stack"><form method="post" action="${action}">${body}<button type="submit">${label}</button></form></div>`
const code=field('Authenticator or recovery code','code','','required autocomplete="one-time-code" maxlength="64"')
export async function securityPage(input:{mode:'settings'|'enroll'|'challenge'|'recovery'|'sso'|'break-glass'|'scim-credential';owner?:boolean;enrolled?:boolean;policy?:SecurityPolicy;secret?:string;uri?:string;codes?:string[];error?:string;status?:number;providers?:boolean;saml?:boolean;factor?:boolean;credential?:string;issuers?:string[];scim?:{issuer:string;active:boolean;createdAt:number|null}[]}) {
 let title='Sign-in security',content=''
 if(input.mode==='enroll') {
  title='Set up your authenticator'
  content='<p>Add Vane to your authenticator app. Confirm a code to finish setup.</p>'
  content+=input.secret?`<p>Enter this setup key in your authenticator:</p><p><code>${escape(input.secret)}</code></p><p><a href="${escape(input.uri)}">Open your authenticator</a></p>${submit('/auth/security/enroll/confirm','Confirm authenticator',code)}`:submit('/auth/security/enroll/start','Create setup key')
 } else if(input.mode==='challenge') {
  title='Confirm your second step';content='<p>Enter a current code from your authenticator, or one of your saved recovery codes.</p>'+submit('/auth/security/verify','Continue',code)
 } else if(input.mode==='recovery') {
  title='Save your recovery codes';content='<p>Each code works once in place of your authenticator. Save them somewhere private. They will not be shown again.</p><ul>'+input.codes!.map(c=>`<li><code>${escape(c)}</code></li>`).join('')+'</ul><p><a class="action" href="/app">I saved my codes</a></p>'
 } else if(input.mode==='sso') {
  title='Single sign-on required';content='<p>The owner requires an identity provider for this installation. Sign in through your organization to continue.</p><p><a class="action" href="/signin">Choose an identity provider</a></p><p>If the provider is unavailable, the owner can use a fresh deployment-issued <code>rer signin</code> link, then open <a href="/auth/security/break-glass">owner outage recovery</a>.</p>'
 } else if(input.mode==='break-glass') {
  title='Owner outage recovery';content='<p>Your deployment-issued owner sign-in permits recovery for fifteen minutes. Disabling SSO is audited. The authenticator requirement stays in effect.</p>'+submit('/auth/security/break-glass','Disable SSO for outage recovery','<input type="hidden" name="confirm" value="disable-sso">'+(input.factor?code:''))
 } else if(input.mode==='scim-credential') {
  title='Save your SCIM credential';content='<p>Copy this credential into your provisioning service. It is shown once and works only at <code>/scim/v2</code>. Issuing another credential for this issuer immediately invalidates this one.</p><p><code data-scim-credential>'+escape(input.credential)+'</code></p><p><a href="/auth/security">I saved my credential</a></p>'
 } else {
  content=`<p>Your authenticator is ${input.enrolled?'enabled':'not set up'}. Recovery codes are issued when you confirm enrollment.</p>${!input.enrolled?submit('/auth/security/enroll/start','Set up authenticator'):''}`
  if(input.owner)content+=`<h2>Installation requirements</h2><p>These requirements apply to every account, including owners, and existing browser sessions. Prove your own sign-in method before requiring it.</p>${submit('/auth/security/policy','Save requirements',`<label class="check"><input type="checkbox" name="requireSso"${input.policy?.sso?' checked':''}> Require single sign-on</label><label class="check"><input type="checkbox" name="requireSecond"${input.policy?.secondStep?' checked':''}> Require an authenticator second step</label>`)}<h2>Identity providers</h2><p>Configure Google Workspace, Microsoft Entra ID, Auth or Okta in the installation’s private bindings. Provider sign-in is ${input.providers?'enabled':'disabled'}.</p>${submit('/auth/security/identity','Enable configured providers')}<p>SAML is ${input.saml?'configured':'not configured'}. SCIM provisions Viewers with no sites until the owner grants access, and deprovisions non-owner members.</p>`
  if(input.owner) {
   content+='<h2>SCIM provisioning</h2><p>Issue a credential for a configured issuer. A new credential replaces its previous credential. Only its hash is stored. Provisioned Viewers start with no sites; only an owner can grant access.</p>'
   for(const issuer of input.issuers??[]) {
    const active=input.scim?.some(item=>item.issuer===issuer&&item.active)
    content+=`<h3>${escape(issuer)}</h3><p>${active?'Credential active':'No active credential'}</p>`+submit('/auth/security/scim/issue',active?'Rotate SCIM credential':'Issue SCIM credential',`<input type="hidden" name="issuer" value="${escape(issuer)}">`)
    if(active)content+=submit('/auth/security/scim/revoke','Revoke SCIM credential',`<input type="hidden" name="issuer" value="${escape(issuer)}">`)
   }
   if(!input.issuers?.length)content+='<p>Configure an identity provider before issuing a SCIM credential.</p>'
   content+='<h2>Identity-provider outage</h2><p>Use <code>rer signin</code> with the deployment credentials, then open <a href="/auth/security/break-glass">owner outage recovery</a>. Ordinary sign-in and SCIM cannot open this recovery door.</p>'
  }
  content+='<p class="secondary-link"><a href="/app">Back to Vane</a></p>'
 }
 if(input.error)content=`<p class="notice" role="alert">${escape(input.error)}</p>`+content
 content+=submit('/auth/signout','Sign out')
 return pageResponse({branding,title,heading:title,content,status:input.status??200,referrer:'strict-origin'})
}
