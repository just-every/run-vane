import { insist, type Config } from './core'
// PRIVACY-003 (ct 13:06Z): where a site requires consent, and from which consent manager the script reads it. A site
// that requires consent may name regions: then consent is required only for visitors whose Cloudflare country (and,
// for a US state or another subdivision, region code) is in one of them, compared in memory and never stored, and a
// visitor whose country is unknown is asked for consent (fails closed). Without regions it is required everywhere.
export const CONSENT_ADAPTERS={onetrust:'OneTrust',cookiebot:'Cookiebot',termly:'Termly',osano:'Osano',iubenda:'Iubenda',cookieyes:'CookieYes'} as const
const EU=['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']
export const REGION_GROUPS:Record<string,string[]>={EU,EEA:[...EU,'IS','LI','NO'],UK:['GB']}
export function cleanConsent(input:any,consent:string) {
 const regions=[...new Set((Array.isArray(input.consentRegions)?input.consentRegions:String(input.consentRegions??'').split(/[\n,]/)).map((r:unknown)=>String(r).trim().toUpperCase()).filter(Boolean))] as string[]
 insist(regions.length<=50&&regions.every(r=>Object.hasOwn(REGION_GROUPS,r)||/^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/.test(r)),'consent_regions','List up to 50 regions that require consent: EU, EEA, UK, a country code such as CH, or a subdivision such as US-CA.')
 const adapter=String(input.consentAdapter??'').trim()
 insist(adapter===''||Object.hasOwn(CONSENT_ADAPTERS,adapter),'consent_adapter','Choose a listed consent manager, or none.')
 insist(consent==='required'||(!regions.length&&!adapter),'consent_regions','Consent regions and a consent manager apply when consent is required.')
 return {...(regions.length?{consentRegions:regions}:{}),...(adapter?{consentAdapter:adapter as keyof typeof CONSENT_ADAPTERS}:{})}
}
export function consentRequired(config:Config,request:Request):boolean {
 if(config.consent!=='required')return false
 const regions=config.consentRegions??[];if(!regions.length)return true
 const cf=(request as any).cf??{},country=String(cf.country??'').toUpperCase(),region=String(cf.regionCode??'').toUpperCase()
 if(!/^[A-Z]{2}$/.test(country)||country==='XX'||country==='T1')return true
 return regions.some(r=>REGION_GROUPS[r]?.includes(country)||r===country||r===`${country}-${region}`)
}
// The consent value a collection request must carry: granted where consent is required, otherwise either.
export const consentAccepted=(config:Config,request:Request,value:unknown)=>consentRequired(config,request)?value==='granted':value==='granted'||value==='not-required'
