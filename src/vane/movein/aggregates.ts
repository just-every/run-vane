import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import type { SourceBundle, Json } from '../../modules/import-kit/src/types.ts'
import type { ImportSite, SitePolicy } from './types'
import { MoveinError } from './types'
import { normalizeMatomo } from './matomo'
import { namespace } from './policy'
import type { AggregateRecord } from './aggregate-types'

export function aggregateSource(document:unknown,site:ImportSite,policy:SitePolicy) {
 let input:any=document
 if(typeof input==='string'){try{input=JSON.parse(input)}catch{return null}}
 const carry=input?.format==='vane-aggregate-preview/1'
 const parsed=carry?input.records:normalizeMatomo(input,site,policy)
 if(parsed===null||parsed===undefined)return null
 if(!Array.isArray(parsed)||!parsed.length||parsed.length>500)throw new MoveinError('IMPORT_REQUIRES_1_TO_500_REPORT_ROWS')
 const records:AggregateRecord[]=parsed.map((r:any)=>{
  if(!r||r.provider!=='matomo'||!/^\d{4}-\d{2}-\d{2}$/.test(r.day)||!Number.isFinite(Date.parse(r.day))||new Date(r.day).toISOString().slice(0,10)!==r.day||!/^\w+\.\w+$/.test(r.report))throw new MoveinError('INVALID_AGGREGATE')
  // Re-run provider normalization on carries: the hidden form is untrusted too.
  if(!r.dimensions||!r.metrics||!Array.isArray(r.definitions))throw new MoveinError('INVALID_AGGREGATE')
  if(Object.values(r.dimensions).some(v=>typeof v!=='string'||v.length>200||/[<>@\u0000-\u001f]/.test(v)))throw new MoveinError('INVALID_AGGREGATE_DIMENSION')
  if(Object.values(r.metrics).some(v=>typeof v!=='number'||!Number.isFinite(v)))throw new MoveinError('INVALID_AGGREGATE_METRIC')
  // Every row is revalidated by the provider's allowlists, including a reviewed carry.
  const clean=normalizeMatomo({format:'vane-matomo-normalized/1',records:[r]},site,policy)
  if(!clean?.length)throw new MoveinError('INVALID_AGGREGATE')
  const value=clean[0]!
  return {...value,id:sha256(canonicalJson(['vane-report',site.id,value.provider,value.day,value.report,value.dimensions]))}
 })
 const ids=new Set(records.map(r=>r.id));if(ids.size!==records.length)throw new MoveinError('DUPLICATE_AGGREGATE_ROW')
 records.sort((a,b)=>a.id.localeCompare(b.id))
 const content=canonicalJson({records,policyHash:sha256(site.config_json),policyVersion:site.version}),artifactHash=sha256(content),name='normalized-matomo-reports.json'
 const source:SourceBundle={artifacts:[{name,sha256:artifactHash,size:new TextEncoder().encode(content).length}],diagnostics:[],records:records.map((r,i)=>({namespace:namespace(site.id),kind:'aggregate',sourceId:r.id,payload:r as unknown as Json,payloadHash:sha256(canonicalJson(r)),artifactHash,location:{artifact:name,row:i+1}}))}
 // An aggregate is a report row, not a page load. Preview rows show the source measures separately.
 return {source,events:[],discarded:{},aggregates:records,carry:{format:'vane-aggregate-preview/1',records}}
}
