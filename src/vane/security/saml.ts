import { SAML, ValidateInResponseTo, generateServiceProviderMetadata, type CacheProvider, type Profile } from '@node-saml/node-saml'
import { DOMParser, type Element } from '@xmldom/xmldom'
import type { OperatorAuth } from '../../modules/operator-auth/index.mjs'
import { digest, statement, type Env } from '../core'

/** Server-owned identity associations; no assertion attribute can supply an email. */
export interface SamlConfig { issuer:string; entryPoint:string; idpCert:string; subjects:Record<string,string> }
const TTL=10*60*1000, LIMIT=64*1024
const PROTOCOL='urn:oasis:names:tc:SAML:2.0:protocol', ASSERTION='urn:oasis:names:tc:SAML:2.0:assertion'
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}
type Transaction={request_id:string; request_value:string; expires_at:number}
function fail():never{throw new Error('saml_rejected')}
const token=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')
function browserCookie(request:Request,name:string) {
 const values=(request.headers.get('cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='))
 const value=values.length===1?values[0]!.slice(name.length+1):''
 return /^[a-f0-9]{64}$/.test(value)?value:null
}
async function body(request:Request) {
 if(Number(request.headers.get('content-length')??0)>LIMIT)fail()
 const reader=request.body?.getReader();if(!reader)return ''
 let size=0;const parts:Uint8Array[]=[]
 try {for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>LIMIT)fail();parts.push(next.value)}}
 finally {await reader.cancel()}
 const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes)
}

// node-saml 5.1 verifies the signed response/assertion and their temporal,
// audience and request-ID constraints. It does not enforce Destination or
// Recipient. Read its verified profile XML through a maintained namespace-aware
// parser to require these remaining binding constraints as well.
function xml(value:string|undefined,namespace:string,name:string) {
 if(!value||/<!DOCTYPE|<!ENTITY/i.test(value))fail()
 const doc=new DOMParser({onError:()=>fail()}).parseFromString(value,'application/xml')
 const root=doc.documentElement
 if(!root||root.namespaceURI!==namespace||root.localName!==name)fail()
 return root
}
function children(parent:Element,namespace:string,name:string) {
 return Array.from(parent.childNodes).filter((node):node is Element=>node.nodeType===1&&'namespaceURI' in node&&node.namespaceURI===namespace&&node.localName===name)
}
function one(parent:Element,namespace:string,name:string) {
 const found=children(parent,namespace,name);if(found.length!==1)fail();return found[0]!
}
function text(node:Element) {if(Array.from(node.childNodes).some(n=>n.nodeType===1))fail();return node.textContent??''}
function instant(value:string|null) {
 if(!value||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value))fail()
 const parsed=Date.parse(value);if(!Number.isFinite(parsed))fail();return parsed
}
function checkedProfile(profile:Profile,config:SamlConfig,callback:string,requestId:string) {
 const response=xml(profile.getSamlResponseXml?.(),PROTOCOL,'Response')
 const assertion=xml(profile.getAssertionXml?.(),ASSERTION,'Assertion'),now=Date.now()
 if(response.getAttribute('Destination')!==callback||response.getAttribute('InResponseTo')!==requestId||response.getAttribute('Version')!=='2.0')fail()
 const responseAt=instant(response.getAttribute('IssueInstant')),assertionAt=instant(assertion.getAttribute('IssueInstant'))
 if(responseAt>now+60000||responseAt<now-TTL||assertionAt>now+60000||assertionAt<now-TTL)fail()
 if(text(one(response,ASSERTION,'Issuer'))!==config.issuer||text(one(assertion,ASSERTION,'Issuer'))!==config.issuer||profile.issuer!==config.issuer)fail()
 if(one(one(response,PROTOCOL,'Status'),PROTOCOL,'StatusCode').getAttribute('Value')!=='urn:oasis:names:tc:SAML:2.0:status:Success')fail()
 const conditions=one(assertion,ASSERTION,'Conditions')
 if(instant(conditions.getAttribute('NotOnOrAfter'))<=now)fail()
 const subject=one(assertion,ASSERTION,'Subject'),nameID=text(one(subject,ASSERTION,'NameID'))
 if(!nameID||nameID.length>255||profile.nameID!==nameID||profile.inResponseTo!==requestId)fail()
 const confirmations=children(subject,ASSERTION,'SubjectConfirmation')
 if(!confirmations.some(confirmation=>{
  if(confirmation.getAttribute('Method')!=='urn:oasis:names:tc:SAML:2.0:cm:bearer')return false
  const data=children(confirmation,ASSERTION,'SubjectConfirmationData');if(data.length!==1)return false
  const item=data[0]!,expiry=instant(item.getAttribute('NotOnOrAfter')),notBefore=item.getAttribute('NotBefore')
  return expiry>now&&(!notBefore||instant(notBefore)<=now)&&item.getAttribute('Recipient')===callback&&item.getAttribute('InResponseTo')===requestId
 }))fail()
 if(!Object.hasOwn(config.subjects,nameID)||typeof config.subjects[nameID]!=='string')fail()
 return {nameID,associatedEmail:config.subjects[nameID]!}
}

/** A callback consumes its browser-bound attempt even when verification fails. */
export async function samlResponse(request:Request,env:Env,auth:Pick<OperatorAuth,'admission'>,config:SamlConfig):Promise<Response|null> {
 const url=new URL(request.url)
 if(!['/auth/saml/start','/auth/saml/callback','/auth/saml/metadata'].includes(url.pathname))return null
 try {
  const origin=new URL(env.AUTH_ORIGIN).origin,local=env.AUTH_LOCAL==='true'
  if(url.origin!==origin||url.search||request.headers.get('host')&&request.headers.get('host')!.toLowerCase()!==url.host.toLowerCase())fail()
  if(url.pathname==='/auth/saml/metadata') {
   if(request.method!=='GET')fail()
   return new Response(generateServiceProviderMetadata({issuer:origin+'/auth/saml/metadata',callbackUrl:origin+'/auth/saml/callback',wantAssertionsSigned:true}),{headers:{...headers,'Content-Type':'application/samlmetadata+xml'}})
  }
  if(request.method!=='POST')fail()
  const entry=new URL(config.entryPoint)
  if(entry.protocol!=='https:'&&!(local&&entry.protocol==='http:')||entry.username||entry.password||entry.hash)fail()
  const callback=origin+'/auth/saml/callback',now=Date.now()
  const cookieName=local?'vane_saml_'+(new URL(origin).port||'80'):'__Host-vane_saml'
  const cookie=(value:string,age:number)=>`${cookieName}=${value}; Path=/; HttpOnly; Max-Age=${age}; SameSite=${local?'Lax':'None'}${local?'':'; Secure'}`
  const configHash=await digest(JSON.stringify([origin,config.issuer,config.entryPoint,config.idpCert,Object.entries(config.subjects).sort(([a],[b])=>a.localeCompare(b))]))
  await statement(env,'DELETE FROM vane_saml_requests WHERE expires_at<=?',now).run()
  const starting=url.pathname==='/auth/saml/start'
  const browser=browserCookie(request,cookieName)??(starting?token():fail()),browserHash=await digest('vane:saml:browser:v1:'+browser)
  let relay:string,relayHash:string,claim:string|null=null,transaction:Transaction|null=null
  if(starting) {
   if(request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')==='cross-site')fail()
   if((await body(request)).length)fail()
   relay=token();relayHash=await digest('vane:saml:relay:v1:'+relay)
  } else {
   if(!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get('content-type')??''))fail()
   const form=new URLSearchParams(await body(request))
   if([...form.keys()].some(key=>key!=='RelayState'&&key!=='SAMLResponse')||form.getAll('RelayState').length!==1||form.getAll('SAMLResponse').length!==1)fail()
   relay=form.get('RelayState')!;if(!/^[a-f0-9]{64}$/.test(relay))fail()
   relayHash=await digest('vane:saml:relay:v1:'+relay);claim=token()
   transaction=await statement(env,`UPDATE vane_saml_requests SET claim=? WHERE relay_hash=? AND browser_hash=? AND config_hash=? AND expires_at>? AND claim IS NULL RETURNING request_id,request_value,expires_at`,claim,relayHash,browserHash,configHash,now).first<Transaction>()
   if(!transaction)fail()
   // Keep the bounded form in this request's closure; never parse attacker XML to locate the transaction.
   return await complete(form.get('SAMLResponse')!)
  }
  const saml=client()
  const location=await saml.getAuthorizeUrlAsync(relay,undefined,{})
  return new Response(null,{status:303,headers:{...headers,Location:location,'Set-Cookie':cookie(browser,TTL/1000)}})

  function client() {
   const cache:CacheProvider={
    async saveAsync(key,value) {
     if(!starting)fail()
     const saved=await statement(env,`INSERT INTO vane_saml_requests(relay_hash,browser_hash,config_hash,request_id,request_value,created_at,expires_at)
      SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM vane_saml_requests)<256 AND (SELECT count(*) FROM vane_saml_requests WHERE browser_hash=?)<8 RETURNING request_id`,relayHash,browserHash,configHash,key,value,now,now+TTL,browserHash).first()
     if(!saved)fail();return {value,createdAt:now}
    },
    async getAsync(key) {
     if(!transaction||key!==transaction.request_id)return null
     const found=await statement(env,'SELECT request_value FROM vane_saml_requests WHERE relay_hash=? AND request_id=? AND claim=? AND browser_hash=? AND expires_at>? AND cache_removed=0',relayHash,key,claim,browserHash,Date.now()).first<{request_value:string}>()
     return found?.request_value??null
    },
    async removeAsync(key) {
     if(!transaction||key!==transaction.request_id)return null
     const removed=await statement(env,'UPDATE vane_saml_requests SET cache_removed=1 WHERE relay_hash=? AND request_id=? AND claim=? AND browser_hash=? AND cache_removed=0 RETURNING request_value',relayHash,key,claim,browserHash).first<{request_value:string}>()
     return removed?.request_value??null
    },
   }
   return new SAML({issuer:origin+'/auth/saml/metadata',idpIssuer:config.issuer,entryPoint:config.entryPoint,idpCert:config.idpCert,callbackUrl:callback,
    audience:origin+'/auth/saml/metadata',wantAssertionsSigned:true,wantAuthnResponseSigned:true,validateInResponseTo:ValidateInResponseTo.always,
    requestIdExpirationPeriodMs:TTL,maxAssertionAgeMs:TTL,acceptedClockSkewMs:0,disableRequestedAuthnContext:true,identifierFormat:null,allowCreate:false,cacheProvider:cache})
  }
  async function complete(encoded:string) {
   if(!encoded||!transaction||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fail()
   const verified=await client().validatePostResponseAsync({SAMLResponse:encoded})
   if(verified.loggedOut||!verified.profile)fail()
   const principal=checkedProfile(verified.profile,config,callback,transaction.request_id)
   // Admission's request origin/host checks receive a trusted same-origin
   // server request only after the cross-origin protocol proof has passed.
   const admissionRequest=new Request(origin+'/auth/saml/callback',{method:'POST',headers:{Host:new URL(origin).host,Origin:origin}})
   const completed=await auth.admission.admit(admissionRequest,{issuer:config.issuer,subject:principal.nameID,associatedEmail:principal.associatedEmail,provider:'saml'},{returnTo:'/app'})
   const responseHeaders=new Headers({...headers,Location:completed.returnTo})
   responseHeaders.append('Set-Cookie',completed.cookie);responseHeaders.append('Set-Cookie',cookie('',0))
   return new Response(null,{status:303,headers:responseHeaders})
  }
 } catch {return new Response('SAML sign-in could not be completed.',{status:400,headers})}
}
