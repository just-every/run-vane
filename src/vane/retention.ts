import { day, insist, type Config } from './core'
// RETENTION-002: each site keeps raw events for 30, 90 or 365 days, 13 or 25 months, or as long as the installation
// exists. Applying retention erases only events dated before the window's first day: N days before today, or the
// same date N months earlier (the month's last day when it is shorter); a keep-forever site erases nothing.
export const RETENTION_CHOICES={'30':'30 days','90':'90 days','365':'365 days','13m':'13 months','25m':'25 months',forever:'As long as this installation exists'} as const
export type RetentionChoice=keyof typeof RETENTION_CHOICES
export const retentionChoice=(c:Partial<Config>):RetentionChoice=>(c.retainForever?'forever':c.retentionMonths?`${c.retentionMonths}m`:String(c.retentionDays??90)) as RetentionChoice
export const retentionPhrase=(c:Partial<Config>)=>c.retainForever?'as long as this installation exists':RETENTION_CHOICES[retentionChoice(c)]
export function retentionConfig(input:any):Pick<Config,'retentionDays'|'retentionMonths'|'retainForever'> {
 const choice=String(input.retention??(input.retainForever===true?'forever':input.retentionMonths?`${input.retentionMonths}m`:input.retentionDays??90))
 insist(Object.hasOwn(RETENTION_CHOICES,choice),'retention','Choose 30, 90 or 365 days, 13 or 25 months, or as long as the installation exists.')
 return choice==='forever'?{retainForever:true}:choice.endsWith('m')?{retentionMonths:Number(choice.slice(0,-1))}:{retentionDays:Number(choice)}
}
export function retentionCutoff(c:Config,today:string):string|null {
 if(c.retainForever)return null
 if(c.retentionMonths){const [y,m,d]=today.split('-').map(Number),last=new Date(Date.UTC(y!,m!-1-c.retentionMonths+1,0)).getUTCDate();return day(Date.UTC(y!,m!-1-c.retentionMonths,Math.min(d!,last)))}
 return day(Date.parse(today)-c.retentionDays!*86400000)
}
