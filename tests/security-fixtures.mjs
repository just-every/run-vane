import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, randomBytes, createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { SignedXml } from 'xml-crypto'
import { installation } from './harness.mjs'

export function otp(secret,step=Math.floor(Date.now()/30000)) {
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',bytes=[];let value=0,bits=0
 for(const c of secret){value=(value<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){bits-=8;bytes.push((value>>>bits)&255)}}
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const h=createHmac('sha1',Buffer.from(bytes)).update(counter).digest(),i=h.at(-1)&15
 return String((h.readUInt32BE(i)&0x7fffffff)%1000000).padStart(6,'0')
}
export async function login(a,email) {assert.equal((await a.post('/auth/magic-link',{email})).status,202);return a.accept(email)}
export const session=(a,cookie)=>a.request('/auth/session',{headers:{cookie}})
export async function enroll(a,cookie) {
 const start=await a.post('/auth/security/enroll/start',{},cookie);assert.equal(start.status,200,await start.clone().text())
 const html=await start.text(),secret=html.match(/<code>([A-Z2-7]+)<\/code>/)?.[1];assert.ok(secret)
 const confirmed=await a.post('/auth/security/enroll/confirm',{code:otp(secret)},cookie);assert.equal(confirmed.status,200,await confirmed.clone().text())
 const codes=[...(await confirmed.text()).matchAll(/<code>([A-Z2-7]{4}(?:-[A-Z2-7]{4}){3})<\/code>/g)].map(m=>m[1]);assert.equal(codes.length,8)
 return {secret,codes}
}
export async function oidcInstallation(t) {
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),key={...publicKey.export({format:'jwk'}),kid:'synthetic-vane-1',alg:'RS256',use:'sig'}
 const providers=[{id:'google',preset:'google',clientId:'synthetic-vane-1',tokenAuthMethod:'client_secret_basic',clientSecret:'synthetic-vane-2'}, {id:'microsoft',preset:'microsoft',tenant:'synthetic-vane-1',clientId:'synthetic-vane-3',tokenAuthMethod:'client_secret_basic',clientSecret:'synthetic-vane-4',subjectEmails:{'synthetic-vane-owner':'owner@example.test','synthetic-vane-member':'member@example.test'}}]
 const a=await installation({vars:{VANE_OIDC_PROVIDERS:JSON.stringify(providers),OIDC_TRANSACTION_SECRET:randomBytes(32).toString('hex'),VANE_SCIM_TOKEN:'synthetic-vane-1'}});t.after(()=>a.close())
 const codes=new Map()
 for(const [id,issuer] of [['google','https://accounts.google.com'],['microsoft','https://login.microsoftonline.com/synthetic-vane-1/v2.0']])a.fixtureSites[new URL(issuer).origin]=async request=>{
  const url=new URL(request.url)
  if(url.pathname.endsWith('/.well-known/openid-configuration'))return Response.json({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_basic'],code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true})
  if(url.pathname.endsWith('/jwks'))return Response.json({keys:[key]})
  if(url.pathname.endsWith('/token')) {
   const form=new URLSearchParams(await request.text()),proof=codes.get(form.get('code'));assert.ok(proof);codes.delete(form.get('code'))
   assert.equal(form.get('redirect_uri'),a.origin+`/auth/oidc/${id}/callback`);assert.ok(form.get('code_verifier'))
   const now=Math.floor(Date.now()/1000),claims={iss:issuer,sub:proof.email.startsWith('owner')?'synthetic-vane-owner':'synthetic-vane-member',aud:providers.find(p=>p.id===id).clientId,exp:now+300,iat:now,nonce:proof.nonce,email:proof.email,email_verified:true,hd:'example.test',...proof.overrides}
   const body=[{alg:'RS256',kid:key.kid},claims].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')
   return Response.json({id_token:body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url'),token_type:'Bearer'})
  }
  throw Error('Unexpected provider edge '+url.pathname)
 }
 assert.equal((await a.post('/auth/security/identity',{},a.owner)).status,303)
 async function begin(id,email,overrides={}) {
  const start=await a.post(`/auth/oidc/${id}/start`,{returnTo:'/app'});assert.equal(start.status,303,await start.clone().text());const auth=new URL(start.headers.get('location'))
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256')
  const code=crypto.randomUUID();codes.set(code,{email,nonce:auth.searchParams.get('nonce'),overrides})
  const callback=`/auth/oidc/${id}/callback?`+new URLSearchParams({code,state:auth.searchParams.get('state'),iss:id==='google'?'https://accounts.google.com':'https://login.microsoftonline.com/synthetic-vane-1/v2.0'})
  return {callback,cookie:a.cookieOf(start)}
 }
 async function signin(id,email,overrides={}) {const b=await begin(id,email,overrides),response=await a.request(b.callback,{headers:{cookie:b.cookie}});return {response,...b,binding:b.cookie,nativeCookie:a.cookieOf(response)}}
 return {a,begin,signin}
}
export async function samlInstallation(t,{origin}={}) {
 const dir=await mkdtemp(join(tmpdir(),'synthetic-vane-saml-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=synthetic-vane-1'],{stdio:'ignore'})
 const privateKey=await readFile(join(dir,'key.pem'),'utf8'),cert=await readFile(join(dir,'cert.pem'),'utf8'),issuer='https://synthetic-vane-1.example/saml'
 const a=await installation({...(origin?{origin}:{}),vars:{VANE_SAML_CONFIG:JSON.stringify({issuer,entryPoint:issuer+'/sso',idpCert:cert,subjects:{'synthetic-vane-owner':'owner@example.test','synthetic-vane-member':'member@example.test'}}),VANE_SCIM_TOKEN:'synthetic-vane-1'}});t.after(()=>a.close())
 assert.equal((await a.post('/auth/security/identity',{},a.owner)).status,303)
 const assertionNS='urn:oasis:names:tc:SAML:2.0:assertion',protocolNS='urn:oasis:names:tc:SAML:2.0:protocol'
 function signed(xml,name) {
  const signer=new SignedXml({privateKey,publicCert:cert,signatureAlgorithm:'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',canonicalizationAlgorithm:'http://www.w3.org/2001/10/xml-exc-c14n#'})
  signer.addReference({xpath:`/*[local-name()='${name}']`,transforms:['http://www.w3.org/2000/09/xmldsig#enveloped-signature','http://www.w3.org/2001/10/xml-exc-c14n#'],digestAlgorithm:'http://www.w3.org/2001/04/xmlenc#sha256'})
  signer.computeSignature(xml,{location:{reference:`/*[local-name()='${name}']/*[local-name()='Issuer']`,action:'after'}});return signer.getSignedXml()
 }
 async function response(subject='synthetic-vane-member',overrides={}) {
  const start=await a.request('/auth/saml/start',{method:'POST',headers:{origin:a.origin}});assert.equal(start.status,303,await start.clone().text())
  const url=new URL(start.headers.get('location')),request=inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest'),'base64')).toString(),id=request.match(/ID="([^"]+)"/)[1]
  const callback=a.origin+'/auth/saml/callback',now=new Date().toISOString(),before=new Date(Date.now()-30000).toISOString(),expiry=new Date(Date.now()+120000).toISOString()
  const assertion=signed(`<saml:Assertion xmlns:saml="${assertionNS}" ID="_${crypto.randomUUID()}" Version="2.0" IssueInstant="${now}"><saml:Issuer>${issuer}</saml:Issuer><saml:Subject><saml:NameID>${subject}</saml:NameID><saml:SubjectConfirmation Method="${assertionNS}:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${overrides.requestId??id}" Recipient="${overrides.recipient??callback}" NotOnOrAfter="${overrides.expiry??expiry}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${before}" NotOnOrAfter="${overrides.expiry??expiry}"><saml:AudienceRestriction><saml:Audience>${overrides.audience??a.origin+'/auth/saml/metadata'}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${now}" SessionIndex="synthetic-vane-1"><saml:AuthnContext><saml:AuthnContextClassRef>${assertionNS}:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion>`,'Assertion')
  let xml=signed(`<samlp:Response xmlns:samlp="${protocolNS}" xmlns:saml="${assertionNS}" ID="_${crypto.randomUUID()}" Version="2.0" IssueInstant="${now}" Destination="${overrides.destination??callback}" InResponseTo="${id}"><saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="${protocolNS}:status:Success"/></samlp:Status>${assertion}</samlp:Response>`,'Response')
  if(overrides.tamper)xml=xml.replace(subject,'synthetic-vane-tampered')
  const body=new URLSearchParams({SAMLResponse:Buffer.from(xml).toString('base64'),RelayState:url.searchParams.get('RelayState')}).toString(),cookie=a.cookieOf(start)
  const complete=()=>a.request('/auth/saml/callback',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',cookie,origin:new URL(issuer).origin},body})
  return {complete,cookie,body}
 }
 return {a,response}
}
