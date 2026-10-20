import { literal } from './literals'
import { cleanProps, eventName } from '../properties'
export interface Finding {kind:'script'|'call'|'class'|'option';provider:'Plausible'|'Fathom';name?:string;properties?:string[];detail:string;rewrite:string}
const supported=new Set(['customProperties','fileDownloads','outboundLinks','formSubmissions','hashBasedRouting','autoCapturePageviews','captureOnLocalhost']);
const safeName=(input:string)=>{try{return eventName(input)}catch{return undefined}};
// This is a static inventory, not JavaScript execution. Dynamic expressions are
// reported for manual completion; no source or arbitrary options enter custody.
export function findings(html:string,script:string,currency:string):Finding[] {
 const result:Finding[]=[],add=(f:Finding)=>result.push(f);
 for(const tag of html.matchAll(/<script\b[^>]*>/gi)) {
  const src=tag[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];if(!src)continue;
  const provider=/plausible(?:\.io|[^/]*\.js)/i.test(src)?'Plausible':/fathom|cdn\.usefathom\.com/i.test(src)?'Fathom':undefined;
  if(provider)add({kind:'script',provider,detail:'Incumbent script still loaded',rewrite:script});
 }
 for(const match of html.matchAll(/\b(plausible\s*\(|fathom\s*\.\s*(trackEvent|trackPageview)\s*\()/g)) {
  const provider=match[2]?'Fathom':'Plausible',rest=html.slice(match.index!+match[0].length),named=rest.match(/^\s*(['"])([^'"\n]*)\1/),name=named?safeName(named[2]!):undefined,pageview=match[2]==='trackPageview'||named?.[2]==='pageview';
  const cents=provider==='Fathom'?rest.match(/^[^)]*?_value\s*:\s*(\d+(?:\.\d+)?)/)?.[1]:undefined;
  let options:Record<string,unknown>={};const parsed=literal(rest);const tail=parsed?rest.slice(parsed.end).trimStart():'';const input=tail.startsWith(',')?literal(tail.slice(1))?.value:undefined;let incomplete=false;
  if(input&&typeof input==='object'){if(input.props)try{options.props=Object.fromEntries(cleanProps(input.props).kept)}catch{incomplete=true}if(input.revenue&&typeof input.revenue.amount==='number'&&/^[A-Z]{3}$/.test(input.revenue.currency))options.revenue={amount:input.revenue.amount,currency:input.revenue.currency};if(provider==='Fathom'&&cents)options.revenue={amount:Number(cents)/100,currency}}else if(tail.startsWith(','))incomplete=true;
  const rewrite=pageview?`vane('pageview', ${JSON.stringify(options)})`:name?`vane(${JSON.stringify(name)}, ${incomplete?'OPTIONS_TO_COMPLETE':JSON.stringify(options)})`:`vane(EVENT_NAME, OPTIONS_TO_COMPLETE)`;
  add({kind:'call',provider,...(name?{name}:{}),...(options.props?{properties:Object.keys(options.props as object)}:{}),detail:pageview?'Pageview call':name?'Event call; carry per-call properties and revenue through the native event fields':'Dynamic call; complete event name, properties and revenue before replacing',rewrite});
 }
 for(const tag of html.matchAll(/\bclass\s*=\s*(['"])(.*?)\1/gi))for(const token of tag[2]!.split(/\s+/)) {
  const m=token.match(/^plausible-event-name(?:=|--)(.+)$/);if(!m)continue;const name=safeName(m[1]!.replace(/\+/g,' '));
  const rawProps=Object.fromEntries(tag[2]!.split(/\s+/).flatMap(t=>{const p=t.match(/^plausible-event-([a-z0-9_-]+)(?:=|--)(.+)$/);return p&&p[1]!=='name'?[[p[1],p[2]!.replace(/\+/g,' ')]]:[]}));let classOptions='OPTIONS_TO_COMPLETE';try{classOptions=JSON.stringify({props:Object.fromEntries(cleanProps(rawProps).kept)})}catch{}
  add({kind:'class',provider:'Plausible',...(name?{name}:{}),properties:Object.keys(rawProps),detail:'Event class; replace with a native click handler and carry property classes into props',rewrite:name?`vane(${JSON.stringify(name)}, ${classOptions})`:`vane(EVENT_NAME, {props: PROPERTIES_TO_COMPLETE})`});
 }
 for(const init of html.matchAll(/plausible\s*\.\s*init\s*\(\s*\{/g)) {
  // Balanced object/string walk identifies top-level option keys without retaining values.
  const source=html.slice(init.index!+init[0].length);let depth=1,quote='',escaped=false;
  for(let i=0;i<source.length&&depth>0;i++) {
   const c=source[i]!;
   if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue}
   if(depth===1){const key=source.slice(i).match(/^\s*(?:['"]([\w]+)['"]|([\w]+))\s*:/);if(key){const name=key[1]??key[2]!;if(!supported.has(name))add({kind:'option',provider:'Plausible',detail:`Unsupported init option: ${name}`,rewrite:'Review this option manually before retiring incumbent compatibility.'});i+=key[0].length-1;continue}}
   if(c==='"'||c==="'"||c==='`')quote=c;else if(c==='{'||c==='['||c==='(')depth++;else if(c==='}'||c===']'||c===')')depth--;
  }
 }
 return result;
}
