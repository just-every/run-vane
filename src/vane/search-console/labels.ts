import { keptValue, storedPath } from '../paths'
import type { Site } from '../core'
import type { GoogleRow, Grain, SearchRow } from './types'

export const queryLabel=(raw:string)=>keptValue(raw)??'[redacted]'
function pageLabel(value:Site,raw:string):{page:string;path:string} {
 let url:URL;try {url=new URL(raw)}catch {throw new Error('Google returned an invalid page URL.')}
 if(!['http:','https:'].includes(url.protocol))throw new Error('Google returned an unsupported page URL.');
 const path=storedPath(value.config,url.pathname||'/');
 const registered=[value.origin,...(value.config.origins??[])].some(origin=>new URL(origin).origin===url.origin);
 // Queries, fragments and userinfo never become page labels or links. Foreign-property pages have no native link.
 return {page:url.origin+path,path:registered?path:''};
}
export function normalizedRows(value:Site,grain:Grain,source:GoogleRow[]):SearchRow[] {
 const map=new Map<string,SearchRow>();
 for(const row of source) {
  const keys=row.keys??[],query=grain==='query'||grain==='query_page'?queryLabel(keys[0]!):'';
  const page=grain==='page'||grain==='query_page'?pageLabel(value,keys[grain==='page'?0:1]!):{page:'',path:''};
  const key=JSON.stringify([query,page.page]),prior=map.get(key);
  if(!prior)map.set(key,{grain,query,...page,clicks:row.clicks,impressions:row.impressions,ctr:row.ctr,position:row.position});
  else {const impressions=prior.impressions+row.impressions;prior.position=impressions?(prior.position*prior.impressions+row.position*row.impressions)/impressions:0;prior.impressions=impressions;prior.clicks+=row.clicks;prior.ctr=impressions?prior.clicks/impressions:0;}
 }
 return [...map.values()];
}
