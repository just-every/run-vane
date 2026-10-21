import { themeFrame } from '../base/theme-frame'
import { fontHead } from '../base/font-head'
import { clock } from './clock'
import { createInsightsService } from './reports'
import { escape } from './views/html'
import { publicStats } from './views/public'
import type { Env } from './core'
// SHARE-002: a site's public stats page at the stable /stats/<site ID>. It answers 404, like any unknown
// path, unless the site's approved settings choose at least one public report; it is noindex unless chosen.
export async function publicStatsResponse(request:Request,env:Env):Promise<Response|null> {
 const match=new URL(request.url).pathname.match(/^\/stats\/([\w-]+)$/);
 if(!match||!['GET','HEAD'].includes(request.method))return null;
 const row=await env.DB.prepare('SELECT * FROM vane_sites WHERE id=?').bind(match[1]).first<any>(),site=row?{...row,config:JSON.parse(row.config_json)}:null;
 const keys:string[]=site?.config.publicReports??[];
 if(!site||!keys.length)return new Response('Not found',{status:404,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 const url=new URL(request.url),report=await createInsightsService(env,site,clock(),{from:url.searchParams.get('from'),to:url.searchParams.get('to'),imported:url.searchParams.get('imported')}).list();
 const frame=await themeFrame({href:'/rer-theme.css',productName:'Vane'}),robots=site.config.publicIndexing?'index, follow':'noindex, nofollow';
 const html=`<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${robots}"><title>${escape(site.name)} stats · Vane</title>${fontHead}${frame.head}<link rel="stylesheet" href="/vane.css"></head><body class="vane-app"><main>${frame.brand}${publicStats(site,keys,report)}</main></body></html>`;
 return new Response(request.method==='HEAD'?null:html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':robots,'content-security-policy':`default-src 'none'; ${frame.policy}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,'x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
}
