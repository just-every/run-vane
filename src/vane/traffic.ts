import { insist, type Config } from './core'
// COLLECT-003: traffic dropped at ingestion, each counted by reason (never silently) in the daily exclusion counts.
// The owner's rules come first: excluded IP addresses or ranges, then excluded countries; then Vane's maintained
// lists: crawlers and automation (Cloudflare's bot score below 30 or a verified bot where Cloudflare provides
// them, else the user-agent list), data-centre networks (Cloudflare's ASN), then referrer spam. The visitor's IP
// address, country and user agent are compared in memory only and never stored.
export type TrafficReason='excluded-ip'|'excluded-country'|'bot'|'data-centre'|'referrer-spam'
// Lowercased user-agent fragments of crawlers, link previewers, monitors, headless browsers and HTTP libraries.
export const BOT_AGENTS=['bot/','bot;','bot-','crawl','spider','slurp','archiver','facebookexternalhit','embedly','headlesschrome','phantomjs','puppeteer','playwright','selenium','webdriver','lighthouse','pagespeed','gtmetrix','pingdom','uptimerobot','statuscake','curl/','wget/','python-requests','python-urllib','aiohttp','go-http-client','java/','libwww-perl','httpclient','axios/','node-fetch','scrapy','ahrefs','semrush','mj12','bingpreview','mediapartners-google','google-inspectiontool','feedfetcher']
// Referrer-spam domains (a listed domain covers its subdomains).
export const SPAM_REFERRERS=['semalt.com','buttons-for-website.com','darodar.com','ilovevitaly.com','priceg.com','hulfingtonpost.com','best-seo-offer.com','buy-cheap-online.info','free-share-buttons.com','social-buttons.com','get-free-traffic-now.com','trafficmonetize.org','4webmasters.org','kambasoft.com','savetubevideo.com','blackhatworth.com','simple-share-buttons.com','floating-share-buttons.com','event-tracking.com','success-seo.com','video--production.com','rank-checker.online','seo-platform.com','webmonetizer.net','trafficbot.life']
// Autonomous systems of hosting and cloud networks, by Cloudflare's request ASN.
export const DATA_CENTRE_ASNS:Record<number,string>={16509:'Amazon AWS',14618:'Amazon AWS',396982:'Google Cloud',8075:'Microsoft Azure',14061:'DigitalOcean',63949:'Akamai Linode',24940:'Hetzner',16276:'OVHcloud',20473:'Vultr',31898:'Oracle Cloud',45102:'Alibaba Cloud',132203:'Tencent Cloud',12876:'Scaleway',51167:'Contabo',60781:'Leaseweb'}

// An IPv4 or IPv6 address as a 128-bit number (IPv4 mapped into ::ffff:0:0/96), or null when it is neither.
function address(value:string):bigint|null {
 const v4=value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
 if(v4){const parts=v4.slice(1).map(Number);return parts.every(p=>p<=255)?(0xffffn<<32n)|parts.reduce((n,p)=>(n<<8n)|BigInt(p),0n):null}
 if(!/^[0-9a-f:]+$/i.test(value)||(value.match(/::/g)??[]).length>1)return null;
 const [head,tail]=value.includes('::')?value.split('::'):[value,undefined],left=head?head.split(':'):[],right=tail?tail.split(':'):[];
 const groups=tail===undefined?left:[...left,...Array(8-left.length-right.length).fill('0'),...right];
 if(groups.length!==8||groups.some(g=>!/^[0-9a-f]{1,4}$/i.test(g)))return null;
 return groups.reduce((n,g)=>(n<<16n)|BigInt(parseInt(g,16)),0n);
}
interface Range { base:bigint; bits:number }
function range(value:string):Range|null {
 const [ip,prefix]=value.split('/'),base=address(ip!),v4=ip!.includes('.'),max=v4?32:128,length=prefix===undefined?max:Number(prefix);
 if(base===null||!Number.isInteger(length)||length<0||length>max||(prefix!==undefined&&!/^\d{1,3}$/.test(prefix)))return null;
 return {base,bits:(v4?96:0)+length};
}
const within=(ip:bigint,r:Range)=>r.bits===0||(ip>>BigInt(128-r.bits))===(r.base>>BigInt(128-r.bits))
// The owner's excluded addresses and ranges, such as 203.0.113.7, 198.51.100.0/24 or 2001:db8::/32.
export function cleanExcludedIps(input:unknown):string[] {
 const list=[...new Set((Array.isArray(input)?input.map(String):String(input??'').split(/[\n,]/)).map(x=>x.trim().toLowerCase()).filter(Boolean))];
 insist(list.length<=50&&list.every(x=>range(x)!==null),'exclude_ips','List up to 50 IP addresses or ranges, such as 203.0.113.7, 198.51.100.0/24 or 2001:db8::/32.');
 return list;
}
const regions=new Intl.DisplayNames(['en'],{type:'region',fallback:'none'})
// Up to 30 ISO 3166-1 alpha-2 country codes, matched against Cloudflare's request country.
export function cleanExcludedCountries(input:unknown):string[] {
 const list=[...new Set((Array.isArray(input)?input.map(String):String(input??'').split(/[\s,]+/)).map(x=>x.trim().toUpperCase()).filter(Boolean))];
 insist(list.length<=30&&list.every(code=>/^[A-Z]{2}$/.test(code)&&![undefined,'Unknown Region'].includes(regions.of(code))),'exclude_countries','List up to 30 two-letter country codes, such as CA or GB.');
 return list;
}
export function excludedTraffic(request:Request,config:Config,referrerHost:string|null):TrafficReason|null {
 const ip=address(request.headers.get('cf-connecting-ip')??''),cf=(request as any).cf??{},agent=(request.headers.get('user-agent')??'').toLowerCase();
 if(ip!==null&&(config.excludeIps??[]).some(x=>within(ip,range(x)!)))return 'excluded-ip';
 if((config.excludeCountries??[]).includes((request.headers.get('cf-ipcountry')??'').toUpperCase()))return 'excluded-country';
 const score=cf.botManagement?.score;
 if((typeof score==='number'&&score<30)||cf.botManagement?.verifiedBot===true||BOT_AGENTS.some(token=>agent.includes(token)))return 'bot';
 if(Object.hasOwn(DATA_CENTRE_ASNS,Number(cf.asn)))return 'data-centre';
 const host=(referrerHost??'').toLowerCase();
 if(host&&SPAM_REFERRERS.some(domain=>host===domain||host.endsWith('.'+domain)))return 'referrer-spam';
 return null;
}
