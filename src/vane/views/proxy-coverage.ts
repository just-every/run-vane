import { count } from './html'
import { percent } from './tables'

export function proxyCoverage(r:any):string {
 if(!r)return ''
 return `<dt>First-party proxy</dt><dd>${count(r.proxy)} of ${count(r.total)} accepted native page loads (${percent(r.proxyShare)}); direct ${count(r.direct)} (${percent(r.directShare)}); transport unknown for ${count(r.unknown)} older page loads. Imports are excluded. This measures requests that reached Vane; blocked scripts remain unmeasured.</dd>`
}
