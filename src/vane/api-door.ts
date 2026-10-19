import { runtimeBindings, type Bindings } from '../auth.server'
import { site, VaneError } from './core'
import { ApiRefusal, keyOf, keySites } from './api-keys'
import { openApi, plausibleQuery, statsV1 } from './stats-api'
import { exportSchema } from './warehouse'
import { mcp } from './mcp'
import { provisionGoal, provisionSharedLink, provisionSite } from './provisioning'
// API-001: the key-authenticated doors. They take no session cookie and set none; every answer is JSON and uncached.
const headers={'cache-control':'no-store','x-content-type-options':'nosniff'}
const json=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{...headers,...extra}})
async function body(request:Request) { try { return await request.json() } catch { throw new VaneError('json','Send a JSON body.') } }
export async function apiDoor(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/api/v1/')&&path!=='/api/v2/query')return null;
 const env=runtimeBindings(original);
 try {
  if(path==='/api/v1/openapi.json'&&request.method==='GET')return json(openApi(env.AUTH_ORIGIN));
  // API-002: the warehouse export's published schema.
  if(path==='/api/v1/export-schema.json'&&request.method==='GET')return json(exportSchema());
  if(path==='/api/v1/stats'&&request.method==='GET'){const key=await keyOf(env,request,'stats');keySites(key,url.searchParams.get('site_id')??'');return json(await statsV1(env,url))}
  // API-004: the MCP endpoint, with the same key, scope and limits; it opens no event stream.
  if(path==='/api/v1/mcp'){if(request.method!=='POST')return json({error:'method_not_allowed',message:'POST one JSON-RPC message.'},405,{allow:'POST'});const key=await keyOf(env,request,'stats'),answer=await mcp(env,key,env.AUTH_ORIGIN,await body(request));return answer.body===undefined?new Response(null,{status:answer.status,headers}):json(answer.body,answer.status)}
  if(path==='/api/v2/query'&&request.method==='POST'){const key=await keyOf(env,request,'stats');return json(await plausibleQuery(env,await body(request),id=>keySites(key,id)))}
  if(path==='/api/v1/sites'&&request.method==='POST'){const key=await keyOf(env,request,'provisioning');return json(await provisionSite(env,key,await body(request)),201)}
  const nested=path.match(/^\/api\/v1\/sites\/([\w-]+)\/(goals|shared-links)$/);
  if(nested&&request.method==='POST'){const key=await keyOf(env,request,'provisioning'),id=(await site(env,nested[1]!)).id,input=await body(request);return json(nested[2]==='goals'?await provisionGoal(env,key,id,input):await provisionSharedLink(env,key,id,input,env.AUTH_ORIGIN),201)}
  return json({error:'not_found'},404);
 } catch(error) {
  if(error instanceof ApiRefusal&&error.status===401)return json({error:error.code,message:error.message},401,{'www-authenticate':'Bearer'});
  if(error instanceof ApiRefusal&&error.retryAfter)return json({error:error.code,message:error.message},error.status,{'retry-after':String(error.retryAfter)});
  if(error instanceof VaneError)return json({error:error.code,message:error.message},error.status,error.status===401?{'www-authenticate':'Bearer'}:{});
  return json({error:'invalid_request',message:'The request could not complete.'},400);
 }
}
