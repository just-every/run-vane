// Dismissals change what the owner sees without rewriting historical evidence.
export function visibleBrief<T extends {opportunities: {type:string}[]; shortfall:string|null}>(brief:T,dismissed:ReadonlySet<string>):T {
 const opportunities=brief.opportunities.filter(o=>!dismissed.has(o.type))
 return {...brief,opportunities,shortfall:opportunities.length<3?'Fewer than three supported opportunities; dismissed types stay hidden and missing evidence is not invented.':null}
}
