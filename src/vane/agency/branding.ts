import { themeFrame, ink } from '../../base/theme-frame'
import { escape } from '../views/html'
import { insist, rows, type Env } from '../core'

export interface Brand { id:string; name:string; accent:string; background:string; logo_id:string|null; custom_origin:string|null; enabled:number }
export async function brandFor(env:Env,siteId:string):Promise<Brand|null> {
 const client=(await rows<{client_id:string}>(env,'SELECT client_id FROM vane_agency_sites WHERE site_id=?',siteId))[0]
 const own=client?(await rows<Brand>(env,'SELECT * FROM vane_agency_brands WHERE id=? AND enabled=1',client.client_id))[0]:null
 const brand=own??(await rows<Brand>(env,"SELECT * FROM vane_agency_brands WHERE id='agency' AND enabled=1"))[0]??null
 // Archives are owner-provided inputs too. Never interpolate unchecked saved values into CSS.
 if(brand)insist(/^#[0-9a-f]{6}$/i.test(brand.accent)&&/^#[0-9a-f]{6}$/i.test(brand.background)&&typeof brand.name==='string'&&brand.name.length<=80&&(!brand.logo_id||/^[0-9a-f-]{36}$/.test(brand.logo_id)),'agency_brand','The saved brand has invalid presentation settings.')
 return brand
}
export async function reportOrigin(env:Env,siteId:string):Promise<string> {
 const client=(await rows<{custom_origin:string|null}>(env,'SELECT b.custom_origin FROM vane_agency_sites s JOIN vane_agency_brands b ON b.id=s.client_id WHERE s.site_id=? AND b.enabled=1',siteId))[0]
 return client?.custom_origin??(await rows<Brand>(env,"SELECT * FROM vane_agency_brands WHERE id='agency' AND enabled=1"))[0]?.custom_origin??env.AUTH_ORIGIN
}
export const logoPath=(brand:Brand)=>brand.logo_id?'/agency-assets/'+encodeURIComponent(brand.logo_id):null
export const brandMark=(brand:Brand,origin='')=>`<div class="vane-agency-mark" data-agency-brand="${escape(brand.id)}">${brand.logo_id?`<img src="${escape(origin+(logoPath(brand)??''))}" alt="${escape(brand.name)} logo" width="160" height="64">`:''}<strong>${escape(brand.name)}</strong></div>`
export async function reportFrame(env:Env,siteId?:string) {
 const frame=await themeFrame({href:'/rer-theme.css',productName:'Vane'}),brand=siteId?await brandFor(env,siteId):null
 if(!brand)return frame
 const css=`.rer-themed{--rer-accent:${brand.accent};--rer-accent-text:${ink(brand.accent)};--rer-focus:${brand.accent};--rer-chart:${brand.accent};--rer-page:${brand.background};--rer-logo:none}.vane-agency-mark{display:flex;flex-wrap:wrap;align-items:center;gap:12px;max-width:100%;margin:0 0 20px}.vane-agency-mark img{display:block;max-width:160px;width:auto;height:64px;object-fit:contain}.vane-agency-mark strong{overflow-wrap:anywhere}.vane-brand .vane-agency-mark{font-size:16px}`
 const hash=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(css)))))
 return {...frame,brand:brandMark(brand),head:frame.head+`<style>${css}</style>`,policy:frame.policy.replace("style-src 'self'",`style-src 'self' 'sha256-${hash}'`)}
}
export function emailBrand(brand:Brand|null,origin:string,content:string):string {
 if(!brand)return content
 const start=`<div style="background:${brand.background};border-top:6px solid ${brand.accent};padding:24px;font:14px/1.5 system-ui,sans-serif;color:${ink(brand.background)}">${brand.logo_id?`<p><img src="${escape(origin+(logoPath(brand)??''))}" alt="${escape(brand.name)} logo" width="160" style="max-width:160px;height:auto"></p>`:''}<p><strong>${escape(brand.name)}</strong></p>`
 return content.replace('<body>','<body>'+start).replace('</body>','</div></body>')
}
