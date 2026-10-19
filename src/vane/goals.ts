// CONV-001: a goal path is exact (/thanks) or a wildcard pattern where * and ** each match any
// characters, slashes included: /thanks* matches /thanks and /thanks/pro, /blog/** every post.
export function goalMatches(pattern:string,path:string):boolean {
 if(!pattern.includes('*'))return pattern===path;
 return new RegExp('^'+pattern.split(/\*+/).map(part=>part.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$').test(path);
}
