import { insist, rows, site, statement, uid, type Actor, type Env } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { seal, unseal } from './sealed'
import { publicHttps } from './warehouse'
// MOBILE-001 (ct 13:06Z): web-push alerts to the installed app. The installation makes its VAPID key pair on first use
// and keeps the private key sealed, never shown. A signed-in person turns alerts on per browser; the browser's push
// subscription (endpoint and keys) is kept for that person and deleted when they turn it off, when they are removed
// from the team (TEAM-001), or when the push service answers 404 or 410. Each alert is encrypted for that browser
// (RFC 8291, aes128gcm) and carries only the alert title, the site name and a link into the app, never visitor data.
// Subscribing and unsubscribing are audited. Alerts (ALERT-001) and the alerts built on them send through sendPush.
export interface PushAlert { title:string; site:string; link:string }
export interface PushSubscription { id:string; host:string; createdAt:number }
const utf8=new TextEncoder()
const b64url=(bytes:ArrayBuffer|Uint8Array)=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
const unb64url=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0))
const concat=(...parts:Uint8Array[]):Uint8Array<ArrayBuffer>=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length}return out}
const hmac=async(key:Uint8Array<ArrayBuffer>,data:Uint8Array<ArrayBuffer>)=>new Uint8Array(await crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']),data))
const PURPOSE='vane-vapid'

// The installation's VAPID key: the public key (65-byte uncompressed P-256 point, base64url) that browsers subscribe with.
export async function vapidKey(env:Env):Promise<string> {
 const found=(await rows<{public_key:string}>(env,"SELECT public_key FROM vane_push_keys WHERE id='vapid'"))[0];if(found)return found.public_key
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']) as CryptoKeyPair
 const publicKey=b64url(await crypto.subtle.exportKey('raw',pair.publicKey)),jwk=await crypto.subtle.exportKey('jwk',pair.privateKey)
 // Two first uses at once keep whichever key was written first.
 await env.DB.prepare("INSERT OR IGNORE INTO vane_push_keys(id,public_key,sealed_private,created_at) VALUES('vapid',?,?,?)").bind(publicKey,await seal(env,PURPOSE,publicKey,JSON.stringify(jwk)),clock()).run()
 return (await rows<{public_key:string}>(env,"SELECT public_key FROM vane_push_keys WHERE id='vapid'"))[0]!.public_key
}
export async function pushSubscriptions(env:Env,actor:Actor):Promise<PushSubscription[]> {
 return (await rows<{id:string,endpoint:string,created_at:number}>(env,'SELECT id,endpoint,created_at FROM vane_push_subscriptions WHERE operator_id=? ORDER BY created_at',actor.id)).map(r=>({id:r.id,host:new URL(r.endpoint).host,createdAt:r.created_at}))
}
// A browser's PushSubscription.toJSON(): a public https endpoint and its p256dh (65-byte point) and auth (16-byte) keys.
export async function subscribePush(env:Env,actor:Actor,p:any) {
 const endpoint=publicHttps(String(p.endpoint??''),true).href,p256dh=String(p.keys?.p256dh??''),auth=String(p.keys?.auth??'')
 insist(endpoint.length<=1000,'endpoint','The push endpoint is too long.')
 let valid=false;try{valid=unb64url(p256dh).length===65&&unb64url(p256dh)[0]===4&&unb64url(auth).length===16}catch{valid=false}
 insist(valid,'subscription','Send the browser’s push subscription with its p256dh and auth keys.')
 const id=uid()
 // An endpoint belongs to one browser: subscribing it again replaces its keys and owner.
 await env.DB.batch([statement(env,'INSERT INTO vane_push_subscriptions(id,operator_id,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET operator_id=excluded.operator_id,p256dh=excluded.p256dh,auth=excluded.auth,created_at=excluded.created_at',id,actor.id,endpoint,p256dh,auth,clock()),auditStatement(env,actor.id,'push.subscribe',actor.id,`browser alerts on through ${new URL(endpoint).host}`)])
 return {subscribed:true}
}
// Turning alerts off names the browser by its endpoint (from the browser) or its row (from the alerts page).
export async function unsubscribePush(env:Env,actor:Actor,p:any) {
 const found=(await rows<{id:string,endpoint:string}>(env,'SELECT id,endpoint FROM vane_push_subscriptions WHERE operator_id=? AND (id=? OR endpoint=?)',actor.id,String(p.id??''),String(p.endpoint??'')))[0]
 insist(found,'subscription','This browser does not receive alerts.',404)
 await env.DB.batch([statement(env,'DELETE FROM vane_push_subscriptions WHERE id=?',found.id),auditStatement(env,actor.id,'push.unsubscribe',actor.id,`browser alerts off through ${new URL(found.endpoint).host}`)])
 return {unsubscribed:true}
}
// RFC 8291 message encryption with RFC 8188's aes128gcm content coding: one record, the payload then the 0x02 delimiter.
async function encrypt(payload:Uint8Array,p256dh:string,authSecret:string) {
 const ua=unb64url(p256dh),auth=unb64url(authSecret),salt=crypto.getRandomValues(new Uint8Array(16))
 const local=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']) as CryptoKeyPair,as=new Uint8Array(await crypto.subtle.exportKey('raw',local.publicKey))
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[])},local.privateKey,256))
 const ikm=await hmac(await hmac(auth,shared),concat(utf8.encode('WebPush: info\0'),ua,as,new Uint8Array([1])))
 const prk=await hmac(salt,ikm),cek=(await hmac(prk,concat(utf8.encode('Content-Encoding: aes128gcm\0'),new Uint8Array([1])))).slice(0,16),nonce=(await hmac(prk,concat(utf8.encode('Content-Encoding: nonce\0'),new Uint8Array([1])))).slice(0,12)
 const sealed=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']),concat(payload,new Uint8Array([2]))))
 return concat(salt,new Uint8Array([0,0,16,0]),new Uint8Array([as.length]),as,sealed)
}
// RFC 8292 VAPID: an ES256 JWT for the push service's origin, valid 12 hours, naming this installation.
async function vapidHeader(env:Env,endpoint:string) {
 const key=(await rows<{public_key:string,sealed_private:string}>(env,"SELECT public_key,sealed_private FROM vane_push_keys WHERE id='vapid'"))[0]!
 const signing=await crypto.subtle.importKey('jwk',JSON.parse(await unseal(env,PURPOSE,key.public_key,key.sealed_private)),{name:'ECDSA',namedCurve:'P-256'},false,['sign'])
 const body=`${b64url(utf8.encode(JSON.stringify({typ:'JWT',alg:'ES256'})))}.${b64url(utf8.encode(JSON.stringify({aud:new URL(endpoint).origin,exp:Math.floor(clock()/1000)+43200,sub:env.AUTH_ORIGIN})))}`
 return `vapid t=${body}.${b64url(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signing,utf8.encode(body)))}, k=${key.public_key}`
}
// Sends one alert to every browser where these people turned alerts on; returns how many push services accepted it.
export async function sendPush(env:Env,operatorIds:string[],alert:PushAlert):Promise<number> {
 await vapidKey(env)
 const targets=await rows<{id:string,endpoint:string,p256dh:string,auth:string}>(env,"SELECT s.id,s.endpoint,s.p256dh,s.auth FROM vane_push_subscriptions s JOIN oa_operators o ON o.id=s.operator_id AND o.status='active' WHERE s.operator_id IN (SELECT value FROM json_each(?))",JSON.stringify(operatorIds))
 const payload=utf8.encode(JSON.stringify({title:alert.title,site:alert.site,link:alert.link}))
 let accepted=0
 for(const target of targets){
  let status=0;try{status=(await fetch(target.endpoint,{method:'POST',headers:{authorization:await vapidHeader(env,target.endpoint),'content-encoding':'aes128gcm','content-type':'application/octet-stream',ttl:'86400',urgency:'high'},body:await encrypt(payload,target.p256dh,target.auth),redirect:'manual'})).status}catch{status=0}
  if(status>=200&&status<300)accepted++
  // The push service says the subscription is gone: forget it.
  if(status===404||status===410)await env.DB.prepare('DELETE FROM vane_push_subscriptions WHERE id=?').bind(target.id).run()
 }
 return accepted
}
// A test alert for a site the person may open, to their own browsers only.
export async function testPush(env:Env,actor:Actor,siteId:string) {
 const value=await site(env,siteId)
 return sendPush(env,[actor.id],{title:'Test alert',site:value.name,link:`${env.AUTH_ORIGIN}/app/sites/${encodeURIComponent(value.id)}`})
}
