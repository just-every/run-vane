// CONV-001: a goal path is exact (/thanks) or a wildcard pattern with Plausible's meaning, so imported
// Plausible goals (IMPORT-008) behave identically: * matches within one path segment and ** across /.
// /thanks/* matches /thanks/pro but not /thanks/pro/annual; /thanks** matches /thanks and everything below it.
export function goalMatches(pattern:string,path:string):boolean {
 if(!pattern.includes('*'))return pattern===path;
 const escaped=(part:string)=>part.replace(/[.+?^${}()|[\]\\]/g,'\\$&');
 return new RegExp('^'+pattern.split('**').map(part=>part.split('*').map(escaped).join('[^/]*')).join('.*')+'$').test(path);
}
// DASH-013: a goal may be scoped to one hostname by prefixing it, as in blog.example.com/thanks; it then
// converts only on that hostname. Rows without a hostname (imported history) never meet a scoped goal.
export function goalApplies(goal:string,hostname:string|null|undefined,path:string):boolean {
 if(goal.startsWith('/'))return goalMatches(goal,path);
 const at=goal.indexOf('/');
 return Boolean(hostname)&&goal.slice(0,at)===hostname&&goalMatches(goal.slice(at),path);
}
export const goalPath=(goal:string)=>goal.startsWith('/')?goal:goal.slice(goal.indexOf('/'))
