import { insist, statement, type Env } from './core'
import type { Funnel } from './funnels'
import { nativePageJoinSql } from './raw/page-joins'
// CONV-007: the standard ecommerce events are custom events (CONV-002) with these names. Each may carry up to 50
// product lines (items) with one ISO 4217 currency for the event: a line is a SKU (1 to 64 characters), a name
// (1 to 100), an optional category (1 to 100), a whole quantity from 1 to 10,000 and a unit price from 0 to
// 1,000,000,000, kept in the currency's minor units (rounded half up, so 19.999 USD is 20.00). Text is plain (no
// control characters or < >); a line with an email address refuses the event, as a property does. Other events
// carry no lines. WooCommerce (INSTALL-002), Shopify (INSTALL-003) and Stall (INSTALL-010) send these same events.
export const ECOMMERCE=['Product view','Add to cart','Begin checkout','Purchase'] as const
// The ready-made funnel over them, within one visit (CONV-005), shown on a site that sent any of them.
export const ECOMMERCE_FUNNEL:Funnel={name:'Ecommerce',steps:ECOMMERCE.map(name=>'event:'+name)}
const EMAIL=/[^\s@]+@[^\s@]+\.[^\s@]+/
export interface Line { sku:string; name:string; category:string|null; quantity:number; priceMinor:number }
// A currency's minor-unit digits (USD 2, JPY 0), from the runtime's ISO 4217 data.
export const minorDigits=(currency:string)=>new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2
export function cleanCurrency(input:unknown):string {
 const code=String(input??'').toUpperCase();
 insist(/^[A-Z]{3}$/.test(code)&&Intl.supportedValuesOf('currency').includes(code),'currency','Send an ISO 4217 currency code such as USD.');
 return code;
}
export const toMinor=(amount:number,currency:string)=>Math.round(amount*10**minorDigits(currency))
const text=(value:unknown,max:number,label:string)=>{const s=String(value??'').trim();insist(typeof value==='string'||typeof value==='number','items',`Each product line needs a ${label}.`);insist(s.length>0&&s.length<=max&&!/[\u0000-\u001f\u007f<>]/.test(s),'items',`A product ${label} has 1 to ${max} characters of plain text.`);insist(!EMAIL.test(s),'personal','An event carrying an email address is refused.');return s}
export function cleanLines(name:string,items:unknown,currency:unknown):{lines:Line[],currency:string|null} {
 if(items===undefined){insist(currency===undefined,'currency','A currency comes with product lines.');return {lines:[],currency:null}}
 insist((ECOMMERCE as readonly string[]).includes(name),'items',`Only the ${ECOMMERCE.join(', ')} events carry product lines.`);
 insist(Array.isArray(items)&&items.length>=1&&items.length<=50,'items','Send 1 to 50 product lines.');
 const code=cleanCurrency(currency);
 const lines=(items as any[]).map(item=>{
  insist(item&&typeof item==='object'&&Object.keys(item).every(k=>['sku','name','category','quantity','price'].includes(k)),'items','A product line has only sku, name, category, quantity and price.');
  const quantity=item.quantity===undefined?1:item.quantity,price=item.price;
  insist(Number.isInteger(quantity)&&quantity>=1&&quantity<=10000,'items','A quantity is a whole number from 1 to 10,000.');
  insist(typeof price==='number'&&Number.isFinite(price)&&price>=0&&price<=1e9,'items','A price is a number from 0 to 1,000,000,000.');
  return {sku:text(item.sku,64,'SKU'),name:text(item.name,100,'name'),category:item.category===undefined?null:text(item.category,100,'category'),quantity,priceMinor:toMinor(price,code)};
 });
 return {lines,currency:code};
}
export const lineStatements=(env:Env,eventId:string,siteId:string,day:string,lines:Line[],currency:string|null)=>lines.map((l,i)=>statement(env,'INSERT OR IGNORE INTO vane_ecommerce_lines(event_id,site_id,day,line,sku,name,category,quantity,price_minor,currency) VALUES(?,?,?,?,?,?,?,?,?,?)',eventId,siteId,day,i,l.sku,l.name,l.category,l.quantity,l.priceMinor,currency))
// The product report: one row per SKU, name, category and currency as sent, over the report's (possibly filtered)
// page loads: product views (lines on Product view events), quantities added to cart, checked out and purchased,
// and revenue (purchased quantity times unit price) in the currency the event sent, never converted.
export async function productReport(env:Env,scope:string,from:string,to:string,events:string) {
 const pageJoin=events==='vane_events'?nativePageJoinSql('ce.page_id'):`JOIN (SELECT id FROM ${events} WHERE kind='pageview' AND site_id IN (SELECT value FROM json_each(?1)) AND day>=?2 AND day<?3) p ON p.id=ce.page_id`
 const result=await env.DB.prepare(`SELECT l.sku,l.name,l.category,l.currency,SUM(CASE WHEN ce.name='Product view' THEN 1 ELSE 0 END) AS views,SUM(CASE WHEN ce.name='Add to cart' THEN l.quantity ELSE 0 END) AS added,SUM(CASE WHEN ce.name='Begin checkout' THEN l.quantity ELSE 0 END) AS checkouts,SUM(CASE WHEN ce.name='Purchase' THEN l.quantity ELSE 0 END) AS purchased,SUM(CASE WHEN ce.name='Purchase' THEN l.quantity*l.price_minor ELSE 0 END) AS revenue_minor FROM vane_ecommerce_lines l JOIN vane_custom_events ce ON ce.id=l.event_id ${pageJoin} GROUP BY 1,2,3,4 ORDER BY purchased DESC,revenue_minor DESC,views DESC,l.sku`).bind(scope,from,to).all<any>()
 return result.results.map(r=>({sku:r.sku,name:r.name,category:r.category,currency:r.currency,views:Number(r.views),added:Number(r.added),checkouts:Number(r.checkouts),purchased:Number(r.purchased),revenue:Number(r.revenue_minor)/10**minorDigits(r.currency)}))
}
