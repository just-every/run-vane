import { digest, type Env, type Site } from './core'
import { clock } from './clock'
// METRIC-001: a cookie-free visitor hash, SHA-256(daily salt + site ID + IP address + user agent).
// The salt is random per site and local day, rotates at midnight in the site's time zone and is
// deleted after 24 hours. The IP address and user agent are used here only and never stored.
export const SALT_LIFETIME_MS=86400000
export const localDay=(time:number,timeZone:string)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(time)
export const expireSalts=(env:Env,now=clock())=>env.DB.prepare('DELETE FROM vane_salts WHERE created_at<?').bind(now-SALT_LIFETIME_MS).run()

export async function visitorHash(env:Env,site:Site,request:Request,today:string,now=clock()) {
 await env.DB.batch([
  env.DB.prepare('DELETE FROM vane_salts WHERE created_at<? OR (site_id=? AND day<>?)').bind(now-SALT_LIFETIME_MS,site.id,today),
  env.DB.prepare('INSERT OR IGNORE INTO vane_salts(site_id,day,salt,created_at) VALUES(?,?,?,?)').bind(site.id,today,Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),now),
 ]);
 const row=await env.DB.prepare('SELECT salt FROM vane_salts WHERE site_id=? AND day=?').bind(site.id,today).first<{salt:string}>();
 return digest(row!.salt+site.id+(request.headers.get('cf-connecting-ip')??'')+(request.headers.get('user-agent')??''));
}
