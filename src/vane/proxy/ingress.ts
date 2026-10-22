import { isIP } from 'node:net'
import { digest, insist, rows, site, VaneError, type Env } from '../core'
import type { ConnectionRow, ProxyResolution } from './types'

// The mark cannot be provided by a browser header or event field. It lives only for
// this request's dispatch and never enters an event, credential or visitor archive.
const proxied=new WeakSet<Request>()
export const isProxied=(request:Request)=>proxied.has(request)
const externalRoot='/api/vane/proxy/'
const opaqueHeaders={'cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin'}
function refusal(status:number):Response {
 return Response.json({error:'proxy_refused',message:'The proxy request could not be accepted.'},{status,headers:opaqueHeaders})
}
interface Door { path:string; method:'GET'|'POST'; empty?:boolean; script?:boolean }
function doorOf(suffix:string,siteId:string):Door|null {
 if(suffix==='script.js')return {path:'/vane.js',method:'GET',script:true}
 if(['collect','collect-batch','engage','custom','event','perf','exposure','heat-click'].includes(suffix))return {path:'/api/vane/'+suffix,method:'POST'}
 const match=suffix.match(/^(config|signal|declined|ignored)\/([\w-]+)$/)
 if(!match||match[2]!==siteId)return null
 return {path:'/api/vane/'+suffix,method:match[1]==='config'?'GET':'POST',empty:match[1]!=='config'}
}
async function boundedBody(request:Request):Promise<string> {
 const chunks:Uint8Array[]=[],reader=request.body?.getReader();let size=0
 if(reader)while(true){
  const part=await reader.read();if(part.done)break
  size+=part.value.byteLength
  if(size>65536){await reader.cancel();throw new VaneError('proxy_size','Proxy request too large.',413)}
  chunks.push(part.value)
 }
 const bytes=new Uint8Array(size);let offset=0
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw new VaneError('proxy_body','Invalid proxy body.')}
}
function place(header:string|null):string|undefined {
 if(header===null)return undefined
 insist(header.length<=1200,'proxy_metadata','Invalid visitor metadata.')
 let decoded:string;try{decoded=decodeURIComponent(header)}catch{throw new VaneError('proxy_metadata','Invalid visitor metadata.')}
 insist(decoded.length>0&&decoded.length<=100&&!/[\u0000-\u001f\u007f]/.test(decoded),'proxy_metadata','Invalid visitor metadata.')
 return decoded
}
function externalMetadata(request:Request):{ip:string;cf:Record<string,string>} {
 const ip=request.headers.get('x-vane-proxy-ip')??''
 insist(isIP(ip)!==0,'proxy_metadata','Invalid visitor metadata.')
 const country=request.headers.get('x-vane-proxy-country'),region=place(request.headers.get('x-vane-proxy-region')),city=place(request.headers.get('x-vane-proxy-city'))
 insist(country===null||/^[A-Z]{2}$/.test(country),'proxy_metadata','Invalid visitor metadata.')
 insist(region===undefined||/^[A-Z0-9]{1,3}$/.test(region),'proxy_metadata','Invalid visitor subdivision code.')
 // No ASN, bot score, server geography or server IP may stand in for the visitor.
 return {ip,cf:{...(country&&country!=='XX'&&country!=='T1'?{country}:{}),...(region?{regionCode:region}:{}),...(city?{city}:{})}}
}
function preflight(request:Request,origin:string,door:Door):Response {
 insist(request.headers.get('access-control-request-method')===door.method,'proxy_method','Invalid proxy method.',405)
 const headers=(request.headers.get('access-control-request-headers')??'').split(',').map(h=>h.trim().toLowerCase()).filter(Boolean)
 insist(headers.every(h=>h==='content-type'),'proxy_headers','Invalid proxy headers.',403)
 return new Response(null,{status:204,headers:{...opaqueHeaders,'access-control-allow-origin':origin,'access-control-allow-methods':door.method,'access-control-allow-headers':'content-type','access-control-max-age':'600'}})
}

/** Run BEFORE assets, auth and every collector. null is only an ordinary request
 * to the installation origin; any foreign-host request is consumed here so an
 * attached domain cannot expose the installation's application or sign-in. */
export async function resolveProxy(request:Request,env:Env):Promise<ProxyResolution|Response|null> {
 const url=new URL(request.url),installation=new URL(env.AUTH_ORIGIN),foreign=url.origin!==installation.origin
 if(!foreign&&!url.pathname.startsWith(externalRoot))return null
 try {
  let connection:ConnectionRow|null=null,suffix:string
  if(foreign){
   // Genuine Cloudflare visitor metadata is available only on this own-Worker mode.
   const candidates=await rows<ConnectionRow>(env,"SELECT * FROM vane_proxy_connections WHERE hostname=? AND mode='worker' AND revoked_at IS NULL",url.hostname.toLowerCase())
   connection=candidates.find(c=>url.pathname.startsWith(c.public_prefix+'/'))??null
   if(!connection)return refusal(404)
   suffix=url.pathname.slice(connection.public_prefix.length+1)
  }else{
   const match=url.pathname.match(/^\/api\/vane\/proxy\/([0-9a-f-]{36})\/(.+)$/)
   if(!match)return refusal(404)
   connection=await env.DB.prepare("SELECT * FROM vane_proxy_connections WHERE id=? AND mode='external' AND revoked_at IS NULL").bind(match[1]).first<ConnectionRow>()
   const token=request.headers.get('authorization')?.match(/^Bearer (vane_proxy_[0-9a-f]{64})$/)?.[1]
   if(!connection||!token||await digest(token)!==connection.credential_hash)return refusal(401)
   suffix=match[2]!
  }
  const door=doorOf(suffix,connection.site_id)
  if(!door||url.search||url.hash)return refusal(404)
  insist(request.method===door.method||door.script&&request.method==='HEAD'||request.method==='OPTIONS','proxy_method','Invalid proxy method.',405)
  const value=await site(env,connection.site_id),registered=[value.origin,...(value.config.origins??[])]
  // Changing the site's registered origins also invalidates an obsolete connection.
  insist(registered.includes(connection.site_origin),'proxy_origin','Invalid proxy origin.',403)
  const origin=request.headers.get('origin'),originlessRead=door.method==='GET'&&origin===null
  // Same-origin browser GETs omit Origin. The registered authenticated connection
  // can serve its public script/config; every event and explicit foreign Origin still fail closed.
  insist(door.script&&!origin||originlessRead||origin===connection.site_origin,'proxy_origin','Invalid proxy origin.',403)
  if(request.method==='OPTIONS')return preflight(request,origin!,door)
  if(door.method==='POST'&&(request.headers.get('dnt')==='1'||request.headers.get('sec-gpc')==='1')&&!door.path.startsWith('/api/vane/signal/'))return refusal(403)
  let body:string|undefined
  if(door.method==='POST'){
   body=await boundedBody(request)
   if(door.empty)insist(body==='','proxy_fields','The counter carries no fields.')
   else {
    let payload:any;try{payload=JSON.parse(body)}catch{throw new VaneError('proxy_body','Invalid proxy body.')}
    insist(payload&&typeof payload==='object'&&!Array.isArray(payload)&&payload.siteId===connection.site_id,'proxy_site','This proxy sends only to its registered site.',403)
    // Original collectors enforce their complete field and property allowlists.
   }
  }
  const headers=new Headers()
  for(const name of ['origin','user-agent','content-type','dnt','sec-gpc']){
   const value=request.headers.get(name);if(value!==null)headers.set(name,value)
  }
  if(originlessRead&&!door.script)headers.set('origin',connection.site_origin)
  let cf:unknown
  if(foreign){
   const ip=request.headers.get('cf-connecting-ip');if(ip)headers.set('cf-connecting-ip',ip)
   cf=(request as Request&{cf?:unknown}).cf
  }else{
   const visitor=externalMetadata(request);headers.set('cf-connecting-ip',visitor.ip);cf=visitor.cf
  }
  const normalized=new Request(new URL(door.path,installation),{method:request.method,headers,...(body===undefined?{}:{body})})
  // Defining cf explicitly preserves native metadata in own-Worker mode, and
  // overwrites (rather than inherits) the external server's metadata.
  if(cf!==undefined)Object.defineProperty(normalized,'cf',{value:cf,enumerable:true})
  proxied.add(normalized)
  return {request:normalized,siteId:connection.site_id,connectionId:connection.id,publicPrefix:connection.public_prefix}
 }catch(error){return refusal(error instanceof VaneError?error.status:500)}
}
