import type { Env } from './core'
// Owner-entered secrets an outbound integration needs in full (DASH-009's GitHub key, API-002's warehouse key) are
// sealed with AES-GCM under a key derived from the installation's session secret and a purpose label, bound to the
// record that holds them, and never shown again.
const utf8=new TextEncoder()
const b64=(bytes:ArrayBuffer|Uint8Array)=>btoa(String.fromCharCode(...new Uint8Array(bytes))),unb64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0))
const sealingKey=async(env:Env,purpose:string)=>crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',utf8.encode(`${purpose}\0${env.SESSION_SECRET}`)),'AES-GCM',false,['encrypt','decrypt'])
export async function seal(env:Env,purpose:string,bound:string,secret:string){const iv=crypto.getRandomValues(new Uint8Array(12));return `${b64(iv)}.${b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode(bound)},await sealingKey(env,purpose),utf8.encode(secret)))}`}
export async function unseal(env:Env,purpose:string,bound:string,sealed:string){const [iv,data]=sealed.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv!),additionalData:utf8.encode(bound)},await sealingKey(env,purpose),unb64(data!)))}
