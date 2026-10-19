import { VaneError } from '../core'
import type { SourceRow } from './types'

type Method='GetUserSites'|'GetQueryStats'|'GetPageStats'|'GetRankAndTrafficStats'|'GetPageQueryStats'
// Microsoft documents API keys in the query string. Never log the URL, response body,
// statusText or underlying exception: any of them could echo the credential.
export class BingError extends VaneError {
 constructor(message:string,status=502){super('bing_provider',message,status)}
}
export async function request<T>(key:string,method:Method,params:Record<string,string>={}):Promise<T[]> {
 const url=new URL(`https://ssl.bing.com/webmaster/api.svc/json/${method}`)
 url.search=new URLSearchParams({...params,apikey:key}).toString()
 let response:Response
 try {response=await fetch(url.toString(),{method:'GET',redirect:'manual',headers:{accept:'application/json'},signal:AbortSignal.timeout(30000)})}
 catch {throw new BingError(`Bing ${method} could not be reached. Check the connection and run again.`)}
 if(!response.ok)throw new BingError(`Bing ${method} returned HTTP ${response.status}. Check the API key and verified property.`)
 let body:unknown
 try {body=await response.json()}catch{throw new BingError(`Bing ${method} returned invalid JSON.`)}
 if(!body||typeof body!=='object'||!Array.isArray((body as {d?:unknown}).d))throw new BingError(`Bing ${method} did not return its documented data array.`)
 return (body as {d:T[]}).d
}
export const sourceStats=(key:string,method:Exclude<Method,'GetUserSites'>,property:string,page?:string)=>request<SourceRow>(key,method,{siteUrl:property,...(page===undefined?{}:{page:JSON.stringify(page)})})
export async function validateProperty(key:string,property:string):Promise<void> {
 const sites=await request<{Url?:unknown;IsVerified?:unknown}>(key,'GetUserSites')
 if(!sites.some(value=>value.Url===property&&value.IsVerified===true))throw new BingError('Bing did not return this exact property as a verified site for this API key.',400)
}
export const safeFailure=(error:unknown)=>error instanceof BingError?error.message:'Bing could not complete this sync. Reconnect if the installation session secret changed.'
