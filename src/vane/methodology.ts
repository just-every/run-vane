import { themeFrame } from '../base/theme-frame'
import { fontHead } from '../base/font-head'
import { stance, storage } from './privacy-signals'
import { escape } from './views/html'
// METRIC-004's public methodology page: what the counts mean, what the script sends and the privacy stance.
const sections:[string,string[]][]=[
 ['What Vane counts',['Visits are accepted page loads, not unique people or sessions; a repeat load counts again. Goals are page loads of a configured goal path. Referring hostnames and campaigns are reported only when they are on the site’s approved lists; others are grouped as other.','Every report compares a range with the preceding period of the same length and states its coverage limits: sampling, consent, allowed paths, imports and unknown coverage.']],
 ['What the script sends',['vane.js sends a fresh random page-load ID, the site ID, the path, the referring hostname, the campaign label and the consent state. It sets no cookie, writes no browser storage in the default mode, and sends no visitor or session identifier, user agent, raw URL or query values.']],
 ['Browser storage',storage],
 ['Privacy signals and US state privacy laws',stance],
]
export async function methodologyResponse(request:Request):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/methodology'||!['GET','HEAD'].includes(request.method))return null;
 const frame=await themeFrame({href:'/rer-theme.css',productName:'Vane'});
 const body=sections.map(([title,paragraphs])=>`<h2>${escape(title)}</h2>${paragraphs.map(p=>`<p>${escape(p)}</p>`).join('')}`).join('');
 const html=`<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Methodology · Vane</title>${fontHead}${frame.head}</head><body><main>${frame.brand}<h1>How Vane measures</h1>${body}</main></body></html>`;
 return new Response(request.method==='HEAD'?null:html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':`default-src 'none'; ${frame.policy}; base-uri 'none'; frame-ancestors 'none'`,'x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
}
