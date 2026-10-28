// IMPORT-011: select the most specific matching user-agent groups, then the
// longest matching rule; Allow wins a tie. Empty Disallow allows everything.
export function robots(text:string) {
 const groups:{agents:string[],rules:{allow:boolean,path:string}[]}[]=[],sitemaps:string[]=[];
 let group:typeof groups[number]|undefined,hasRules=false;
 for(const raw of text.split(/\r?\n/)) {
  const line=raw.replace(/#.*$/,'').trim(),colon=line.indexOf(':');if(colon<0)continue;
  const key=line.slice(0,colon).toLowerCase(),value=line.slice(colon+1).trim();
  if(key==='sitemap'){sitemaps.push(value);continue}
  if(key==='user-agent'){if(!group||hasRules){group={agents:[],rules:[]};groups.push(group);hasRules=false}group.agents.push(value.toLowerCase());continue}
  if(group&&(key==='allow'||key==='disallow')){hasRules=true;if(value)group.rules.push({allow:key==='allow',path:value})}
 }
 const score=(agent:string)=>agent==='*'?0:'vane'.includes(agent)?agent.length:-1;
 const best=Math.max(-1,...groups.flatMap(g=>g.agents.map(score)));
 const rules=best<0?[]:groups.filter(g=>g.agents.some(a=>score(a)===best)).flatMap(g=>g.rules);
 const normalized=(s:string)=>s.replace(/%[0-9a-f]{2}/gi,part=>{const c=String.fromCharCode(parseInt(part.slice(1),16));return /[a-z0-9._~-]/i.test(c)?c:part.toUpperCase()});
 return {sitemaps,allows:(url:URL)=>{
  const path=normalized(url.pathname+url.search),matched=rules.filter(rule=>{const p=normalized(rule.path),end=p.endsWith('$'),source=(end?p.slice(0,-1):p).split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');return new RegExp('^'+source+(end?'$':'')).test(path)}).sort((a,b)=>b.path.replace(/[*$]/g,'').length-a.path.replace(/[*$]/g,'').length||Number(b.allow)-Number(a.allow));
  return matched[0]?.allow??true;
 }}
}
