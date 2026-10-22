import product from '../../branding.json'
import { pageResponse } from '../../modules/operator-auth/page.mjs'
import { escape, field } from '../views/html'
import type { SecurityPolicy } from './policy'

const branding={productName:product.name,accentColor:product.primaryColor,theme:'/rer-theme.css'}
const submit=(action:string,label:string,body='')=>`<div class="stack"><form method="post" action="${action}">${body}<button type="submit">${label}</button></form></div>`
const code=field('Authenticator or recovery code','code','','required autocomplete="one-time-code" maxlength="64"')
export async function securityPage(input:{mode:'settings'|'enroll'|'challenge'|'recovery'|'sso';owner?:boolean;enrolled?:boolean;policy?:SecurityPolicy;secret?:string;uri?:string;codes?:string[];error?:string;status?:number;providers?:boolean;saml?:boolean}) {
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
  title='Single sign-on required';content='<p>The owner requires an identity provider for this installation. Sign in through your organization to continue.</p><p><a class="action" href="/signin">Choose an identity provider</a></p>'
 } else {
  content=`<p>Your authenticator is ${input.enrolled?'enabled':'not set up'}. Recovery codes are issued when you confirm enrollment.</p>${!input.enrolled?submit('/auth/security/enroll/start','Set up authenticator'):''}`
  if(input.owner)content+=`<h2>Installation requirements</h2><p>These requirements apply to every account, including owners, and existing browser sessions. Prove your own sign-in method before requiring it.</p>${submit('/auth/security/policy','Save requirements',`<label class="check"><input type="checkbox" name="requireSso"${input.policy?.sso?' checked':''}> Require single sign-on</label><label class="check"><input type="checkbox" name="requireSecond"${input.policy?.secondStep?' checked':''}> Require an authenticator second step</label>`)}<h2>Identity providers</h2><p>Configure Google Workspace, Microsoft Entra ID, Auth or Okta in the installation’s private bindings. Provider sign-in is ${input.providers?'enabled':'disabled'}.</p>${submit('/auth/security/identity','Enable configured providers')}<p>SAML is ${input.saml?'configured':'not configured'}. SCIM provisions Viewers with no sites until the owner grants access, and deprovisions non-owner members.</p>`
  content+='<p class="secondary-link"><a href="/app">Back to Vane</a></p>'
 }
 if(input.error)content=`<p class="notice" role="alert">${escape(input.error)}</p>`+content
 content+=submit('/auth/signout','Sign out')
 return pageResponse({branding,title,heading:title,content,status:input.status??200,referrer:'strict-origin'})
}
