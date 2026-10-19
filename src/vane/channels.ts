// DASH-004: every page load gets a channel at collection from its source, utm_medium and paid-click flag,
// tried in this order (the methodology page publishes the same rules and lists):
//   Affiliates      utm_medium is affiliate or affiliates
//   Display         utm_medium is display, banner, cpm, expandable or interstitial
//   Paid Social     a social source with a paid click or a paid medium (cpc, ppc, cpm, cpv, paid…, retargeting)
//   Paid Search     any other paid click or paid medium
//   AI Assistants   ChatGPT, Perplexity, Claude, Gemini or Copilot
//   Email           an email client or webmail referrer, or utm_medium/utm_source email, e-mail or newsletter
//   Organic Search  a search engine, or utm_medium organic
//   Organic Social  a social network, or utm_medium social, social-network, social-media or sm
//   Referral        any other source
//   Direct          no source
// A source matches a list by name (a utm_source or ref value such as google) or by hostname, ignoring a
// leading www., m., l. or lm.; a hostname entry also covers its subdomains, and an entry ending in . any top-level domain.
export const CHANNELS=['Direct','Organic Search','Paid Search','Organic Social','Paid Social','Email','Referral','AI Assistants','Affiliates','Display'] as const
export const LISTS={
 ai:['chatgpt.com','chat.openai.com','perplexity.ai','claude.ai','gemini.google.com','copilot.microsoft.com','chatgpt','perplexity','claude','gemini','copilot'],
 email:['mail.google.com','outlook.live.com','outlook.office.com','outlook.office365.com','mail.yahoo.com','mail.aol.com','mail.proton.me','app.fastmail.com','mail.zoho.com','webmail','email','e-mail','newsletter'],
 search:['google.','bing.com','duckduckgo.com','search.yahoo.com','yandex.','baidu.com','ecosia.org','search.brave.com','startpage.com','qwant.com','google','bing','duckduckgo','yahoo','yandex','baidu','ecosia','brave','startpage','qwant'],
 social:['facebook.com','instagram.com','x.com','twitter.com','t.co','linkedin.com','lnkd.in','reddit.com','pinterest.com','tiktok.com','youtube.com','threads.net','bsky.app','news.ycombinator.com','mastodon.social','tumblr.com','quora.com','facebook','fb','instagram','ig','twitter','linkedin','reddit','pinterest','tiktok','youtube','threads','bluesky','hackernews'],
}
const key=(source:string)=>source.toLowerCase().replace(/^(?:www|m|l|lm)\./,'')
export const listed=(list:readonly string[],source:string)=>{const k=key(source);return list.some(entry=>entry.endsWith('.')?k.startsWith(entry):entry.includes('.')?k===entry||k.endsWith('.'+entry):k===entry)}
const PAID=/^(?:cpc|ppc|cpm|cpv|cpa|paid.*|retargeting|paidsearch|paidsocial)$/
export function channelOf(source:string,medium:string|null,paidClick:boolean):string {
 const m=(medium??'').toLowerCase(),social=listed(LISTS.social,source),paid=paidClick||PAID.test(m);
 if(['affiliate','affiliates'].includes(m))return 'Affiliates';
 if(['display','banner','cpm','expandable','interstitial'].includes(m))return 'Display';
 if(paid&&social)return 'Paid Social';
 if(paid)return 'Paid Search';
 if(source!=='direct'&&listed(LISTS.ai,source))return 'AI Assistants';
 if(listed(LISTS.email,source)||['email','e-mail','newsletter'].includes(m))return 'Email';
 if(listed(LISTS.search,source)||m==='organic')return 'Organic Search';
 if(social||['social','social-network','social-media','sm'].includes(m))return 'Organic Social';
 return source==='direct'?'Direct':'Referral';
}
// Email-client and webmail referrers group as one source, and their URLs are never kept.
export const webmail=(host:string)=>host.includes('.')&&listed(LISTS.email,host)
