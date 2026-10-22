import { digest, rows, type Env } from '../core'
import { staticAssetResponse } from '../../base/static-assets'
import { shareResponse } from '../share'
import { publicStatsResponse } from '../public'
import { unsubscribeResponse } from '../email-reports'
import type { Brand } from './branding'

const missing=()=>new Response('Not found',{status:404,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}})
async function logoResponse(request:Request,env:Env,brandId?:string):Promise<Response> {
 const id=new URL(request.url).pathname.match(/^\/agency-assets\/([0-9a-f-]{36})$/)?.[1]
 if(!id||!['GET','HEAD'].includes(request.method))return missing()
 const logo=(await rows<{brand_id:string;mime:string;bytes:ArrayBuffer}>(env,'SELECT l.* FROM vane_agency_logos l JOIN vane_agency_brands b ON b.id=l.brand_id WHERE l.id=? AND b.enabled=1',id))[0]
 if(!logo||brandId&&brandId!=='agency'&&logo.brand_id!==brandId&&logo.brand_id!=='agency')return missing()
 return new Response(request.method==='HEAD'?null:logo.bytes,{headers:{'content-type':logo.mime,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'referrer-policy':'no-referrer'}})
}
async function belongs(env:Env,brandId:string,siteId:string|null):Promise<boolean> {
 return Boolean(siteId&&(brandId==='agency'||(await rows(env,'SELECT 1 FROM vane_agency_sites WHERE site_id=? AND client_id=?',siteId,brandId)).length))
}
// This is the only foreign-host entrance added by agency branding. Native sessions,
// sign-in, the app, APIs and collection remain behind the original host dispatcher.
export async function agencyHostResponse(request:Request,env:Env):Promise<Response|null> {
 const url=new URL(request.url)
 if(url.origin===new URL(env.AUTH_ORIGIN).origin)return url.pathname.startsWith('/agency-assets/')?logoResponse(request,env):null
 const brand=(await rows<Brand>(env,'SELECT * FROM vane_agency_brands WHERE custom_origin=? AND enabled=1',url.origin))[0]
 if(!brand)return null
 if(url.pathname.startsWith('/agency-assets/'))return logoResponse(request,env,brand.id)
 if(['GET','HEAD'].includes(request.method)&&/^\/(?:vane\.css|rer-theme\.css|ui\/(?:shell|surfaces|overview|screens)\.css|fonts\/[a-zA-Z0-9_./-]+\.(?:css|woff2))$/.test(url.pathname)&&!url.pathname.includes('..'))return await staticAssetResponse(request,env)??missing()
 const stats=url.pathname.match(/^\/stats\/([\w-]+)$/)
 if(stats&&await belongs(env,brand.id,stats[1]!))return await publicStatsResponse(request,env)??missing()
 const share=url.pathname.match(/^\/share\/(vane_s_[0-9a-f]{64})$/)
 if(share){const link=(await rows<{site_id:string}>(env,'SELECT site_id FROM vane_share_links WHERE token_hash=?',await digest(share[1]!)))[0];if(await belongs(env,brand.id,link?.site_id??null))return await shareResponse(request,env)??missing()}
 const unsubscribe=url.pathname.match(/^\/reports\/unsubscribe\/(vane_u_[0-9a-f]{48})$/)
 if(unsubscribe){const subscription=(await rows<{site_id:string}>(env,'SELECT site_id FROM vane_report_subscriptions WHERE token_hash=?',await digest(unsubscribe[1]!)))[0];if(await belongs(env,brand.id,subscription?.site_id??null))return await unsubscribeResponse(request,env)??missing()}
 return missing()
}

export async function shareOriginAllowed(request:Request,env:Env,siteId:string) {
 const url=new URL(request.url)
 if(request.headers.get('origin')!==url.origin)return false
 if(url.origin===new URL(env.AUTH_ORIGIN).origin)return true
 const brand=(await rows<Brand>(env,'SELECT * FROM vane_agency_brands WHERE custom_origin=? AND enabled=1',url.origin))[0]
 return Boolean(brand&&await belongs(env,brand.id,siteId))
}
