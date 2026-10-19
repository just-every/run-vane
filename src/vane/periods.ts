import { day, insist } from './core'
import { localDay } from './visitors'
// DASH-002: preset ranges and chart intervals in the site's time zone. A range is local dates, end exclusive.
// The last 7, 30 and 90 days end with today; month and year to date run through today; the last 12 months
// start on the first of the month eleven months before this one; all time starts on the site's earliest event day.
export const PERIODS={today:'Today',yesterday:'Yesterday','7d':'Last 7 days','30d':'Last 30 days','90d':'Last 90 days',month:'Month to date','last-month':'Last month',year:'Year to date','12mo':'Last 12 months',all:'All time'} as const
export type Period=keyof typeof PERIODS
export const INTERVALS={hour:'Hour',day:'Day',week:'Week (from Monday)',month:'Month'} as const
export type Interval=keyof typeof INTERVALS
const DAY=86400000
const shift=(d:string,days:number)=>day(Date.parse(d)+days*DAY)
const monthStart=(d:string,months=0)=>{const [y,m]=d.split('-').map(Number);return day(Date.UTC(y!,m!-1+months,1))}
export function presetRange(period:Period,now:number,timeZone:string,earliest:string|null):{from:string,to:string} {
 const today=localDay(now,timeZone),tomorrow=shift(today,1)
 const from={today,yesterday:shift(today,-1),'7d':shift(today,-6),'30d':shift(today,-29),'90d':shift(today,-89),month:monthStart(today),'last-month':monthStart(today,-1),year:today.slice(0,4)+'-01-01','12mo':monthStart(today,-11),all:earliest&&earliest<today?earliest:today}[period]
 return {from,to:period==='yesterday'?today:period==='last-month'?monthStart(today):tomorrow}
}
// Hourly buckets up to 31 days, daily up to two years; weekly and monthly for any range. The default follows the span.
export function intervalOf(value:string|null|undefined,from:string,to:string):Interval {
 const span=(Date.parse(to)-Date.parse(from))/DAY
 const interval=(value||(span<=2?'hour':span<=92?'day':span<=731?'week':'month')) as Interval
 insist(Object.hasOwn(INTERVALS,interval),'interval','Choose hour, day, week or month.')
 insist(interval!=='hour'||span<=31,'interval','Hourly charts cover at most 31 days.')
 insist(interval!=='day'||span<=731,'interval','Daily charts cover at most two years.')
 return interval
}
// The UTC instant of local midnight starting a date; the offset is read twice so a DST change that day resolves.
const offsetAt=(t:number,timeZone:string)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(t).map(x=>[x.type,x.value]));return Date.UTC(+p.year!,+p.month!-1,+p.day!,+p.hour!,+p.minute!,+p.second!)-Math.floor(t/1000)*1000}
export const localMidnight=(d:string,timeZone:string)=>{const guess=Date.parse(d);return guess-offsetAt(guess-offsetAt(guess,timeZone),timeZone)}
// Bucket keys and labels: an hour is a real hour from local midnight, labelled with its local time and zone
// abbreviation, so a fall-back day has 25 (01:00 CDT, then 01:00 CST) and a spring-forward day 23.
export function bucketsOf(interval:Interval,from:string,to:string,timeZone:string):{key:string,label:string}[] {
 if(interval==='hour'){
  const start=localMidnight(from,timeZone),end=localMidnight(to,timeZone),format=new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',timeZoneName:'short'})
  return Array.from({length:Math.round((end-start)/3600000)},(_,i)=>{const p=Object.fromEntries(format.formatToParts(start+i*3600000).map(x=>[x.type,x.value]));return {key:String(i),label:`${p.year}-${p.month}-${p.day} ${p.hour}:00 ${p.timeZoneName}`}})
 }
 const keys:string[]=[]
 let key=interval==='day'?from:interval==='week'?shift(from,-((new Date(from).getUTCDay()+6)%7)):monthStart(from)
 while(key<to){keys.push(key);key=interval==='day'?shift(key,1):interval==='week'?shift(key,7):monthStart(key,1)}
 return keys.map(k=>({key:k,label:interval==='week'?`Week of ${k}`:interval==='month'?k.slice(0,7):k}))
}
// The key of the bucket holding a local date, matching bucketSql (an hour bucket: that day's local midnight).
export const bucketKey=(interval:Interval,d:string,from:string,timeZone:string)=>interval==='hour'?String(Math.round((localMidnight(d,timeZone)-localMidnight(from,timeZone))/3600000)):interval==='day'?d:interval==='week'?shift(d,-((new Date(d).getUTCDay()+6)%7)):monthStart(d)
// The SQL that maps a row to its bucket key; `start` is the parameter holding the range's first local midnight.
export const bucketSql=(interval:Interval,start:string,atColumn='at')=>({hour:`CAST(CAST((${atColumn}-${start})/3600000 AS INTEGER) AS TEXT)`,day:'day',week:`date(day,'-6 days','weekday 1')`,month:`substr(day,1,7)||'-01'`})[interval]
// DASH-008: the period a range is compared with. The previous period is the same length just before it; last
// year is the same calendar dates a year earlier (29 February becomes 1 March); a custom period is any dates.
// Matching weekdays moves the previous period back by whole weeks (the length rounded up to 7-day multiples),
// last year back by 364 days, and a custom period back by 0 to 6 days, so each compared day is the same weekday.
export const COMPARISONS={previous:'The previous period',year:'The same period last year',custom:'A custom period'} as const
export type Comparison=keyof typeof COMPARISONS
export function comparisonRange(mode:Comparison,from:string,to:string,weekdays:boolean,custom:{from:string|null,to:string|null}):{from:string,to:string} {
 const length=(Date.parse(to)-Date.parse(from))/DAY,weekday=(d:string)=>new Date(d).getUTCDay()
 if(mode==='previous'){const back=weekdays?Math.ceil(length/7)*7:length;return {from:shift(from,-back),to:shift(from,length-back)}}
 if(mode==='year'){if(weekdays)return {from:shift(from,-364),to:shift(to,-364)};const year=(d:string)=>{const [y,m,n]=d.split('-').map(Number);return day(Date.UTC(y!-1,m!-1,n!))};return {from:year(from),to:year(to)}}
 const back=weekdays?(weekday(custom.from!)-weekday(from)+7)%7:0
 return {from:shift(custom.from!,-back),to:shift(custom.to!,-back)}
}
// DASH-008, like with like: while a range ends with the day still running (every preset that runs through today, and a
// custom range whose last day is today), whose figures are what has arrived so far, the compared period stops at the same
// moment of its matching day, so a morning's part of a day is never set against a whole day. Other ranges compare whole.
export interface RunningCut { day:string; at:number; thenDay:string; thenAt:number }
export function runningCut(now:number,timeZone:string,from:string,to:string,previousFrom:string):RunningCut|null {
 const today=localDay(now,timeZone);if(shift(today,1)!==to||today<from)return null
 const thenDay=shift(previousFrom,Math.round((Date.parse(today)-Date.parse(from))/DAY))
 return {day:today,at:now,thenDay,thenAt:localMidnight(thenDay,timeZone)+(now-localMidnight(today,timeZone))}
}
// An event source up to a moment: the days before it whole, its own day up to that instant (imported rows carry no time).
export const upTo=(events:string,through:string,at:number)=>`(SELECT * FROM ${events} WHERE day<'${through}' OR (day='${through}' AND (at IS NULL OR at<=${Math.floor(at)})))`
