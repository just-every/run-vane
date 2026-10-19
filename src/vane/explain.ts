import { day } from './core'
import type { Bucket } from './series'
import type { Annotation } from './definitions'
// REPORT-003: what changed between a range and its compared period, never why. The explanation lists the largest
// movers in channels (visits), pages and named campaigns (pageviews) and devices (unique visitors), each with its
// counts in both periods and the totals they are part of; the annotations dated in the range; every coverage count
// that differs between the periods; and, for ranges up to 31 days, whether each day's unique visitors, visits and
// pageviews fall inside the 95% prediction interval of the day-of-week baseline that ALERT-001 alerts against.
const DAY=86400000,shift=(d:string,n:number)=>day(Date.parse(d)+n*DAY)
export const BASELINE_WEEKS=8,MIN_BASELINE_DAYS=4
// Two-sided 95% Student t quantiles by degrees of freedom (baseline days minus one).
const T95:Record<number,number>={3:3.182,4:2.776,5:2.571,6:2.447,7:2.365}

// US federal holidays as observed (a Saturday holiday moves to Friday, a Sunday one to Monday).
const nth=(y:number,m:number,weekday:number,n:number)=>{const first=new Date(Date.UTC(y,m,1)).getUTCDay();return day(Date.UTC(y,m,1+((weekday-first+7)%7)+(n-1)*7))}
const last=(y:number,m:number,weekday:number)=>{const end=new Date(Date.UTC(y,m+1,0));return day(Date.UTC(y,m,end.getUTCDate()-((end.getUTCDay()-weekday+7)%7)))}
const observed=(y:number,m:number,d:number)=>{const w=new Date(Date.UTC(y,m,d)).getUTCDay();return day(Date.UTC(y,m,d+(w===6?-1:w===0?1:0)))}
export function usHolidays(year:number):Record<string,string> {
 return {[observed(year,0,1)]:'New Year’s Day',[nth(year,0,1,3)]:'Martin Luther King Jr. Day',[nth(year,1,1,3)]:'Washington’s Birthday',[last(year,4,1)]:'Memorial Day',...(year>=2021?{[observed(year,5,19)]:'Juneteenth'}:{}),[observed(year,6,4)]:'Independence Day',[nth(year,8,1,1)]:'Labor Day',[nth(year,9,1,2)]:'Columbus Day',[observed(year,10,11)]:'Veterans Day',[nth(year,10,4,4)]:'Thanksgiving Day',[observed(year,11,25)]:'Christmas Day'}
}
const holidayOf=(d:string)=>({...usHolidays(Number(d.slice(0,4))-1),...usHolidays(Number(d.slice(0,4))),...usHolidays(Number(d.slice(0,4))+1)})[d]

export type Judged='visitors'|'visits'|'pageviews'
export interface Interval { value:number; low:number; high:number; within:boolean }
export interface VariationDay { day:string; holiday?:string; baselineDays:number; metrics?:Record<Judged,Interval> }
// The baseline of a day is the same weekday in the 8 weeks before it, leaving out US federal holidays and days
// before the site's first event; with at least 4 such days, the interval is mean ± t·s·√(1 + 1/n).
export function variation(daily:Bucket[],from:string,to:string,firstDay:string|null):VariationDay[] {
 const by=new Map(daily.map(b=>[b.key,b])),days:VariationDay[]=[]
 for(let d=from;d<to;d=shift(d,1)){
  const holiday=holidayOf(d);if(holiday){days.push({day:d,holiday,baselineDays:0});continue}
  const base=Array.from({length:BASELINE_WEEKS},(_,i)=>shift(d,-7*(i+1))).filter(b=>!holidayOf(b)&&firstDay!==null&&b>=firstDay)
  if(base.length<MIN_BASELINE_DAYS){days.push({day:d,baselineDays:base.length});continue}
  const metrics=Object.fromEntries((['visitors','visits','pageviews'] as Judged[]).map(m=>{
   const xs=base.map(b=>Number(by.get(b)?.[m]??0)),n=xs.length,mean=xs.reduce((a,x)=>a+x,0)/n,sd=Math.sqrt(xs.reduce((a,x)=>a+(x-mean)**2,0)/(n-1)),half=T95[n-1]!*sd*Math.sqrt(1+1/n)
   const value=Number(by.get(d)?.[m]??0),low=Math.round((mean-half)*10)/10,high=Math.round((mean+half)*10)/10
   return [m,{value,low,high,within:value>=low&&value<=high}]
  })) as Record<Judged,Interval>
  days.push({day:d,baselineDays:base.length,metrics})
 }
 return days
}

export interface Mover { dimension:string; label:string; unit:string; now:number; then:number; totalNow:number; totalThen:number }
// The two largest absolute changes in each dimension, with the dimension's totals in both periods.
export function movers(dimension:string,unit:string,rows:{label:string,now:number,then:number}[],totalNow:number,totalThen:number):Mover[] {
 return rows.filter(r=>r.now!==r.then).sort((a,b)=>Math.abs(b.now-b.then)-Math.abs(a.now-a.then)||a.label.localeCompare(b.label)).slice(0,2).map(r=>({dimension,label:r.label,unit,now:r.now,then:r.then,totalNow,totalThen}))
}
const signed=(n:number)=>`${n>0?'+':n<0?'−':''}${Math.abs(n).toLocaleString('en-US')}`
export const moverText=(m:Mover)=>`${m.dimension} ${m.label}: ${m.then.toLocaleString('en-US')} → ${m.now.toLocaleString('en-US')} ${m.unit} (${signed(m.now-m.then)}${m.then?`, ${signed(Math.round((m.now-m.then)/m.then*1000)/10)}%`:', new'}), of ${m.totalThen.toLocaleString('en-US')} → ${m.totalNow.toLocaleString('en-US')} ${m.unit} in all`
export interface CoverageChange { label:string; now:number; then:number }
export interface Explanation { movers:Mover[]; annotations:Annotation[]; coverage:CoverageChange[]; variation:VariationDay[]|null }
