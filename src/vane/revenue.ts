import { insist, type Config, type Env } from './core'
import { cleanCurrency, minorDigits } from './ecommerce'
import { nativePageJoinSql } from './raw/page-joins'
// CONV-006: revenue is stored in the currency the event sent, as millionths of it, rounded half up to that
// currency's minor units (USD cents, JPY yen). A report sums it in the site's currency (USD unless the owner chose
// another, SITE-001). Revenue in another currency converts only at a rate the owner entered for that currency,
// dated: "CAD 0.73 from 2026-10-01" means 1 CAD = 0.73 of the site currency for events on that local day and later,
// until a later dated rate for the same currency. Rates are never fetched. Each event converts at the rate in effect
// on its own day and is rounded half up to the site currency's minor unit; revenue with no rate in effect stays
// unconverted and is listed apart in its own currency, never added to the total.
export interface Rate { currency:string; rate:number; from:string }
export interface Revenue { micros:number; currency:string }
export const MICROS=1_000_000
export function cleanRates(input:unknown,siteCurrency:string):Rate[] {
 const lines=Array.isArray(input)?input.map((r:any)=>typeof r==='string'?r:`${r?.currency} ${r?.rate} from ${r?.from}`):String(input??'').split('\n').map(x=>x.trim()).filter(Boolean);
 insist(lines.length<=50,'rates','Enter at most 50 exchange rates.');
 const rates=lines.map(line=>{const m=line.match(/^([A-Za-z]{3})\s+(\d{1,7}(?:\.\d{1,8})?)\s+from\s+(\d{4}-\d{2}-\d{2})$/);insist(m&&Number(m[2])>0&&new Date(m[3]+'T00:00:00Z').toISOString().slice(0,10)===m[3],'rates','Write each exchange rate as CAD 0.73 from 2026-10-01: one unit of that currency in the site currency, from that local day.');const currency=cleanCurrency(m![1]);insist(currency!==siteCurrency,'rates','The site currency needs no exchange rate.');return {currency,rate:Number(m![2]),from:m![3]!}});
 insist(new Set(rates.map(r=>r.currency+r.from)).size===rates.length,'rates','Enter one rate per currency and date.');
 return rates.sort((a,b)=>a.currency.localeCompare(b.currency)||a.from.localeCompare(b.from));
}
// Revenue sent with an event: {amount, currency}, an amount from 0 to 1,000,000,000.
export function cleanRevenue(input:unknown):Revenue|null {
 if(input===undefined)return null;
 insist(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['amount','currency'].includes(k)),'revenue','Send revenue as {amount, currency}.');
 const {amount,currency}=input as any,code=cleanCurrency(currency);
 insist(typeof amount==='number'&&Number.isFinite(amount)&&amount>=0&&amount<=1e9,'revenue','A revenue amount is a number from 0 to 1,000,000,000.');
 return {micros:Math.round(amount*10**minorDigits(code))*10**(6-minorDigits(code)),currency:code};
}
const literal=(value:string)=>`'${value.replace(/'/g,"''")}'`
// The SQL value of a custom event's revenue in the reporting currency, or NULL when it has none or no rate converts
// it. A site's rates convert into that site's currency, so in a roll-up only sites sharing the roll-up's currency
// (its first site's) convert; every inlined value is a site ID, a checked currency code, a date or a number.
export function convertedSql(sites:{id:string,config:Config}[],reporting:string,alias='ce'):string {
 const unit=10**(6-minorDigits(reporting)),c=`${alias}.currency`,m=`${alias}.revenue_micros`
 const rules=sites.filter(s=>(s.config.currency??'USD')===reporting).flatMap(s=>[...(s.config.rates??[])].sort((a,b)=>b.from.localeCompare(a.from)).map(r=>`WHEN ${alias}.site_id=${literal(s.id)} AND ${c}=${literal(r.currency)} AND ${alias}.day>=${literal(r.from)} THEN ROUND(${m}*${Number(r.rate)}/${unit})*${unit}`))
 return `(CASE WHEN ${m} IS NULL THEN NULL WHEN ${c}=${literal(reporting)} THEN ${m} ${rules.join(' ')} ELSE NULL END)`
}
// Totals over the report's page loads: converted revenue and the events carrying it (orders), revenue as sent by
// currency (converted or not), and unconverted revenue by currency.
export async function revenueTotals(env:Env,scope:string,from:string,to:string,events:string,converted:string) {
 const pages=`(SELECT id FROM ${events} WHERE kind='pageview' AND site_id IN (SELECT value FROM json_each(?1)) AND day>=?2 AND day<?3)`
 const pageJoin=events==='vane_events'?nativePageJoinSql('ce.page_id'):`JOIN ${pages} p ON p.id=ce.page_id`
 const [total,apart,sent]=await env.DB.batch<any>([
  env.DB.prepare(`SELECT COALESCE(SUM(r),0) AS revenue,COUNT(r) AS orders FROM (SELECT ${converted} AS r FROM vane_custom_events ce ${pageJoin} WHERE ce.revenue_micros IS NOT NULL)`).bind(scope,from,to),
  env.DB.prepare(`SELECT ce.currency AS currency,SUM(ce.revenue_micros) AS micros,COUNT(*) AS orders FROM vane_custom_events ce ${pageJoin} WHERE ce.revenue_micros IS NOT NULL AND ${converted} IS NULL GROUP BY ce.currency ORDER BY ce.currency`).bind(scope,from,to),
  env.DB.prepare(`SELECT ce.currency AS currency,SUM(ce.revenue_micros) AS micros,COUNT(*) AS orders FROM vane_custom_events ce ${pageJoin} WHERE ce.revenue_micros IS NOT NULL GROUP BY ce.currency ORDER BY ce.currency`).bind(scope,from,to),
 ])
 const byCurrency=(rows:any[])=>rows.map((r:any)=>({currency:r.currency,amount:Number(r.micros)/MICROS,orders:Number(r.orders)}))
 return {revenue:Number(total.results[0].revenue)/MICROS,orders:Number(total.results[0].orders),sent:byCurrency(sent.results),unconverted:byCurrency(apart.results)}
}
// CONV-006 payment-processor referrers (published on the methodology page): a return from checkout is not a source,
// so the page load keeps the acquisition of the visitor's latest earlier page load that day (DASH-004), else direct.
export const PAYMENT_PROCESSORS:{name:string,match:string[]}[]=[{name:'Stripe Checkout',match:['checkout.stripe.com']},{name:'PayPal',match:['paypal.com']},{name:'Shop Pay',match:['shop.app','pay.shopify.com']},{name:'Klarna',match:['klarna.com']},{name:'Afterpay',match:['afterpay.com']}]
export const paymentReferrer=(host:unknown)=>typeof host==='string'&&PAYMENT_PROCESSORS.some(p=>p.match.some(m=>host===m||host.endsWith('.'+m)))
