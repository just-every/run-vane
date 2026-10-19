// CONV-001: a goal path is exact (/thanks) or a wildcard pattern with Plausible's meaning, so imported
// Plausible goals (IMPORT-008) behave identically: * matches within one path segment and ** across /.
// /thanks/* matches /thanks/pro but not /thanks/pro/annual; /thanks** matches /thanks and everything below it.
export function goalMatches(pattern:string,path:string):boolean {
 if(!pattern.includes('*'))return pattern===path;
 const escaped=(part:string)=>part.replace(/[.+?^${}()|[\]\\]/g,'\\$&');
 return new RegExp('^'+pattern.split('**').map(part=>part.split('*').map(escaped).join('[^/]*')).join('.*')+'$').test(path);
}
