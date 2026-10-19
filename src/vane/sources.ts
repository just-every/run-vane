import { insist } from './core'
// DASH-014: the maintained source list, published on the methodology page. Each named source lists what it
// matches: a hostname (and its subdomains, such as l.facebook.com), a hostname prefix ending in a dot (any
// top-level domain, with or without www.) or an Android app referrer. Names a site sends itself as utm_source,
// ref or source are reported as sent (COLLECT-002); its bare names only feed the channel definitions (DASH-004). The first match wins; an unlisted source reports
// under its own hostname, and a site's approved grouping rules (APPROVE-001) are tried before this list.
export interface NamedSource { name:string; match:string[]; names?:string[]; kind?:'ai'|'email'|'search'|'social' }
const app=(id:string)=>'android-app://'+id
export const SOURCES:NamedSource[]=[
 {name:'ChatGPT',match:['chatgpt.com','chat.openai.com'],names:['chatgpt'],kind:'ai'},
 {name:'Perplexity',match:['perplexity.ai'],names:['perplexity'],kind:'ai'},
 {name:'Claude',match:['claude.ai'],names:['claude'],kind:'ai'},
 {name:'Gemini',match:['gemini.google.com'],names:['gemini'],kind:'ai'},
 {name:'Copilot',match:['copilot.microsoft.com'],names:['copilot'],kind:'ai'},
 {name:'Webmail',match:['webmail','mail.google.com','outlook.live.com','outlook.office.com','outlook.office365.com','mail.yahoo.com','mail.aol.com','mail.proton.me','app.fastmail.com','mail.zoho.com',app('com.google.android.gm')],kind:'email'},
 {name:'Google',match:['google.',app('com.google.android.googlequicksearchbox')],names:['google'],kind:'search'},
 {name:'Bing',match:['bing.com'],names:['bing'],kind:'search'},
 {name:'DuckDuckGo',match:['duckduckgo.com'],names:['duckduckgo'],kind:'search'},
 {name:'Yahoo',match:['search.yahoo.com'],names:['yahoo'],kind:'search'},
 {name:'Yandex',match:['yandex.'],names:['yandex'],kind:'search'},
 {name:'Baidu',match:['baidu.com'],names:['baidu'],kind:'search'},
 {name:'Ecosia',match:['ecosia.org'],names:['ecosia'],kind:'search'},
 {name:'Brave Search',match:['search.brave.com'],names:['brave'],kind:'search'},
 {name:'Startpage',match:['startpage.com'],names:['startpage'],kind:'search'},
 {name:'Qwant',match:['qwant.com'],names:['qwant'],kind:'search'},
 {name:'Facebook',match:['facebook.com','fb.com',app('com.facebook.katana')],names:['facebook','fb'],kind:'social'},
 {name:'Instagram',match:['instagram.com',app('com.instagram.android')],names:['instagram','ig'],kind:'social'},
 {name:'X',match:['x.com','twitter.com','t.co',app('com.twitter.android')],names:['twitter','x'],kind:'social'},
 {name:'LinkedIn',match:['linkedin.com','lnkd.in',app('com.linkedin.android')],names:['linkedin'],kind:'social'},
 {name:'Reddit',match:['reddit.com',app('com.reddit.frontpage')],names:['reddit'],kind:'social'},
 {name:'Pinterest',match:['pinterest.'],names:['pinterest'],kind:'social'},
 {name:'TikTok',match:['tiktok.com'],names:['tiktok'],kind:'social'},
 {name:'YouTube',match:['youtube.com','youtu.be',app('com.google.android.youtube')],names:['youtube'],kind:'social'},
 {name:'Threads',match:['threads.net','threads.com'],names:['threads'],kind:'social'},
 {name:'Bluesky',match:['bsky.app'],names:['bluesky'],kind:'social'},
 {name:'Mastodon',match:['mastodon.social'],names:['mastodon'],kind:'social'},
 {name:'Tumblr',match:['tumblr.com'],names:['tumblr'],kind:'social'},
 {name:'Quora',match:['quora.com'],names:['quora'],kind:'social'},
 {name:'Hacker News',match:['news.ycombinator.com'],names:['hackernews'],kind:'social'},
 {name:'Slack',match:['slack.com',app('com.slack.android')],names:['slack'],kind:'social'},
 {name:'Discord',match:['discord.com','discord.gg',app('com.discord')],names:['discord'],kind:'social'},
 {name:'Product Hunt',match:['producthunt.com'],names:['producthunt']},
 {name:'GitHub',match:['github.com'],names:['github']},
]
export interface SourceRule { match:string; name:string }
const MATCH=/^(?:android-app:\/\/[a-z0-9._]{1,200}|[a-z0-9][a-z0-9.-]{0,252})$/,NAME=/^[A-Za-z0-9][A-Za-z0-9 .&+-]{0,39}$/
export function cleanSourceRules(input:unknown):SourceRule[] {
 const lines=Array.isArray(input)?input.map((rule:any)=>typeof rule==='string'?rule:`${rule?.match}=${rule?.name}`):String(input??'').split('\n').map(x=>x.trim()).filter(Boolean);
 insist(lines.length<=30,'source_rules','Use at most 30 source grouping rules.');
 return lines.map(line=>{const at=line.indexOf('='),match=line.slice(0,at).trim().toLowerCase(),name=line.slice(at+1).trim();insist(at>0&&MATCH.test(match)&&NAME.test(name),'source_rules','Write each grouping rule as brewblog.example=Brew Blog, one per line.');return {match,name}});
}
// The SQL label for a raw source column: the site's rules, then the list, else the source itself. Every
// value inlined here is a constant or matched MATCH/NAME, which admit no quote.
const literal=(value:string)=>`'${value.replace(/'/g,"''")}'`
const condition=(column:string,entry:string)=>entry.startsWith('android-app://')||!entry.includes('.')?`${column}=${literal(entry)}`:entry.endsWith('.')?`(${column} LIKE ${literal(entry+'%')} OR ${column} LIKE ${literal('www.'+entry+'%')})`:`(${column}=${literal(entry)} OR ${column} LIKE ${literal('%.'+entry)})`
export function sourceNameSql(rules:SourceRule[]=[],column='source'):string {
 const value=`lower(${column})`,named=[...rules.map(rule=>({name:rule.name,match:[rule.match]})),...SOURCES];
 return `CASE WHEN ${column}='direct' THEN 'direct' ${named.map(source=>`WHEN ${source.match.map(entry=>condition(value,entry)).join(' OR ')} THEN ${literal(source.name)}`).join(' ')} ELSE ${column} END`
}
