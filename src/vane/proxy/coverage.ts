import { rows, type Env } from '../core'

export async function transportCoverage(env:Env,scope:string,from:string,to:string,events:string) {
 const [r]=await rows<{proxy:number;direct:number;unknown:number;total:number}>(env,`SELECT COALESCE(SUM(transport='proxy'),0) AS proxy,COALESCE(SUM(transport='direct'),0) AS direct,COALESCE(SUM(transport IS NULL),0) AS unknown,COUNT(*) AS total FROM ${events} WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? AND kind='pageview'`,scope,from,to)
 const share=(n:number)=>r.total?Math.round(n/r.total*1000)/10:null
 return {...r,proxyShare:share(r.proxy),directShare:share(r.direct),unknownShare:share(r.unknown)}
}
