import { sites, VaneError, type Env } from './core'
import { keySites, type ApiKey } from './api-keys'
import { BREAKDOWNS, METRICS, statsV1 } from './stats-api'
import { PERIODS } from './periods'
// API-004: a Model Context Protocol endpoint (Streamable HTTP, stateless, JSON answers) at POST /api/v1/mcp. It takes
// the same read-only Stats API key as /api/v1/stats, with the same site scope and rate limits, and its query tool
// answers with exactly the Stats API's answer. Write tools need an agent grant (AGENT-003); until grants exist, every
// write tool is refused and changes nothing.
export const MCP_VERSIONS=['2025-06-18','2025-03-26','2024-11-05']
const READ_TOOLS=[
 {name:'list_sites',title:'List sites',description:'The sites this key may read: ID, name, origin and time zone.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'query_stats',title:'Query statistics',description:'Totals and an optional breakdown for one site and range, as the dashboard and GET /api/v1/stats show them. Dates are the site’s local dates; `to` is exclusive.',inputSchema:{type:'object',required:['site_id'],additionalProperties:false,properties:{
  site_id:{type:'string'},period:{type:'string',enum:Object.keys(PERIODS)},from:{type:'string',format:'date'},to:{type:'string',format:'date'},
  metrics:{type:'array',items:{type:'string',enum:Object.keys(METRICS)}},dimension:{type:'string',enum:Object.keys(BREAKDOWNS)},
  compare:{type:'string',enum:['previous','year','custom']},compare_from:{type:'string',format:'date'},compare_to:{type:'string',format:'date'},
  filters:{type:'array',items:{type:'string',description:'dimension:op:value, as the Stats API filter parameter'}},segment:{type:'string'}}},annotations:{readOnlyHint:true}},
]
const WRITE_TOOLS=[{name:'add_annotation',title:'Add a chart annotation',description:'Adds a note to a site’s charts. Needs an agent grant (AGENT-003); a Stats API key alone is refused.',inputSchema:{type:'object',required:['site_id','day','text'],additionalProperties:false,properties:{site_id:{type:'string'},day:{type:'string',format:'date'},text:{type:'string',maxLength:280}}},annotations:{readOnlyHint:false,destructiveHint:false}}]
const result=(id:unknown,value:unknown)=>({jsonrpc:'2.0',id,result:value})
const failure=(id:unknown,code:number,message:string)=>({jsonrpc:'2.0',id:id??null,error:{code,message}})
const tool=(value:unknown,isError=false)=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError})
async function call(env:Env,key:ApiKey,origin:string,name:string,args:any) {
 if(name==='list_sites'){const covered=JSON.parse(key.site_ids??'[]') as string[];return tool({sites:(await sites(env)).filter(s=>covered.includes(s.id)).map(s=>({id:s.id,name:s.name,origin:s.origin,time_zone:s.config.timeZone??'UTC'}))})}
 if(name==='query_stats'){
  const url=new URL('/api/v1/stats',origin),scalar=['site_id','period','from','to','dimension','compare','compare_from','compare_to','segment']
  for(const field of scalar)if(args[field]!==undefined&&args[field]!==null)url.searchParams.set(field,String(args[field]))
  if(Array.isArray(args.metrics))url.searchParams.set('metrics',args.metrics.map(String).join(','))
  for(const filter of Array.isArray(args.filters)?args.filters:[])url.searchParams.append('filter',String(filter))
  try{keySites(key,String(args.site_id??''));return tool(await statsV1(env,url))}catch(error){if(error instanceof VaneError)return tool({error:error.code,message:error.message},true);throw error}
 }
 if(WRITE_TOOLS.some(t=>t.name===name))return tool({error:'grant_required',message:'Write tools need an agent grant (AGENT-003); this Stats API key is read-only, so nothing was changed.'},true)
 return null
}
// One JSON-RPC message per POST; a notification or a response gets 202 with no body.
export async function mcp(env:Env,key:ApiKey,origin:string,message:any):Promise<{status:number,body?:unknown}> {
 if(!message||typeof message!=='object'||Array.isArray(message)||message.jsonrpc!=='2.0')return {status:400,body:failure(null,-32600,'Send one JSON-RPC 2.0 message.')}
 if(message.id===undefined||message.method===undefined)return {status:202}
 const {id,method,params}=message
 if(method==='initialize'){const asked=String(params?.protocolVersion??'');return {status:200,body:result(id,{protocolVersion:MCP_VERSIONS.includes(asked)?asked:MCP_VERSIONS[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'vane',title:'Vane analytics',version:'1'},instructions:'Read-only website analytics for the sites this key covers. Call list_sites, then query_stats.'})}}
 if(method==='ping')return {status:200,body:result(id,{})}
 if(method==='tools/list')return {status:200,body:result(id,{tools:[...READ_TOOLS,...WRITE_TOOLS]})}
 if(method==='tools/call'){const answer=await call(env,key,origin,String(params?.name??''),params?.arguments??{});return {status:200,body:answer?result(id,answer):failure(id,-32602,`Unknown tool: ${String(params?.name??'')}.`)}}
 return {status:200,body:failure(id,-32601,`Method not found: ${String(method)}.`)}
}
