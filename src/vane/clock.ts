import type { Env } from './core'
import { devGate, devNotFound } from '../modules/operator-auth/index.mjs'
// The product's one time source: collection, visits, salts, reports and retention all read it.
// A local runtime holding RER_DEV_KEY (never a deployed Worker: rer deploy refuses that key)
// lets the key holder set it through POST /__dev/clock, so a test can prove minutes-long gaps
// through the public collection door without waiting for them.
let offset=0
export const clock=()=>Date.now()+offset
export async function clockResponse(request:Request,env:Env):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/__dev/clock')return null
 const gate=devGate({key:env.RER_DEV_KEY,origin:env.AUTH_ORIGIN,local:env.AUTH_LOCAL==='true'})
 if(!gate||request.method!=='POST'||!await gate.admits(request))return devNotFound()
 let at:unknown;try{at=JSON.parse(await request.text())?.at}catch{}
 if(!Number.isSafeInteger(at)||(at as number)<0)return Response.json({error:'clock',message:'Send {"at": epoch milliseconds}.'},{status:400,headers:{'cache-control':'no-store'}})
 offset=(at as number)-Date.now()
 return Response.json({now:clock()},{headers:{'cache-control':'no-store'}})
}
