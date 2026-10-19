import { day, insist } from '../core'
import { localDay } from '../visitors'
import { clock } from '../clock'
import type { Range } from './types'

export const DAY=86400000
export const shift=(date:string,n:number)=>day(Date.parse(date)+n*DAY)
export const sourceToday=(now=clock())=>localDay(now,'America/Los_Angeles')
// Google dates are Pacific dates. Native ranges use an exclusive end; Google's API uses an inclusive end.
export function oldestDate(now=clock()):string {
 const today=sourceToday(now),[year,month,date]=today.split('-').map(Number);
 const first=new Date(Date.UTC(year!,month!-1-16,1));
 return day(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(date!,new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate())));
}
export function storedRange(from:string,to:string):Range {
 const valid=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&day(Date.parse(v))===v;
 insist(valid(from)&&valid(to)&&from<to,'search_range','Choose a valid source date range with an exclusive end.');
 insist((Date.parse(to)-Date.parse(from))/DAY<=3660,'search_range','Stored Search Console reports cover at most 3,660 days.');
 return {from,to};
}
export function rangeOf(from:string,to:string,now=clock()):Range {
 storedRange(from,to);
 insist(from>=oldestDate(now)&&to<=shift(sourceToday(now),1)&&(Date.parse(to)-Date.parse(from))/DAY<=500,'search_range','Search Console retains up to 16 months; choose at most 500 days through today.');
 return {from,to};
}
export function dates({from,to}:Range):string[] {const out:string[]=[];for(let d=from;d<to;d=shift(d,1))out.push(d);return out}
