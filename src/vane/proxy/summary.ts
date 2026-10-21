export interface TransportCounts {proxy:number;direct:number;unknown:number;total:number;proxyShare:number|null;directShare:number|null}

/** Counts describe accepted native traffic only; proxy transport never proves complete coverage. */
export function transportSummary(r:TransportCounts):string {
 const share=(n:number|null)=>n===null?'not measured':n+'%';
 return `First-party proxy: ${r.proxy} of ${r.total} accepted native page loads (${share(r.proxyShare)}); direct ${r.direct} (${share(r.directShare)}); unknown historical transport ${r.unknown}. Imports excluded; observed traffic is partial.`;
}
