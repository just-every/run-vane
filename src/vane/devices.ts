// DASH-006: the server derives the device class, browser and major version, operating system and
// version, and a screen-size class from the user agent and the script's optional viewport width.
// The user agent is read here and for the visitor hash only; it is never stored.
export interface Device { device:'desktop'|'mobile'|'tablet'; browser:string; browserVersion:string|null; os:string; osVersion:string|null; screen:string|null }
const first=(ua:string,patterns:[RegExp,string][]):[string,string|null]=>{for(const [pattern,name] of patterns){const m=ua.match(pattern);if(m)return [name,m[1]??null]}return ['Other',null]}
const browsers:[RegExp,string][]=[[/Edg(?:e|A|iOS)?\/(\d+)/,'Edge'],[/OPR\/(\d+)/,'Opera'],[/SamsungBrowser\/(\d+)/,'Samsung Internet'],[/(?:Firefox|FxiOS)\/(\d+)/,'Firefox'],[/CriOS\/(\d+)/,'Chrome'],[/Chrome\/(\d+)/,'Chrome'],[/Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari\//,'Safari']]
const systems:[RegExp,string][]=[[/Windows NT (\d+\.\d+)/,'Windows'],[/(?:iPhone|iPod)[^)]*? OS (\d+(?:_\d+)?)/,'iOS'],[/iPad[^)]*? OS (\d+(?:_\d+)?)/,'iPadOS'],[/Android (\d+(?:\.\d+)?)/,'Android'],[/CrOS/,'ChromeOS'],[/Mac OS X (\d+(?:_\d+)?)/,'macOS'],[/Linux/,'Linux']]
const windows:Record<string,string>={'10.0':'10/11','6.3':'8.1','6.2':'8','6.1':'7'}
export function screenClass(width:number|undefined):string|null { return width===undefined?null:width<576?'Mobile (under 576 px)':width<992?'Tablet (576–991 px)':width<1440?'Laptop (992–1439 px)':'Desktop (1440 px and wider)' }
export function deviceOf(ua:string,width?:number):Device {
 const [browser,browserVersion]=first(ua,browsers);
 const [os,raw]=first(ua,systems),osVersion=raw===null?null:os==='Windows'?windows[raw]??raw:raw.replace('_','.');
 const device=/iPad|Tablet/.test(ua)||(/Android/.test(ua)&&!/Mobile/.test(ua))?'tablet':/Mobi|iPhone|iPod|Android/.test(ua)?'mobile':'desktop';
 return {device,browser,browserVersion,os,osVersion,screen:screenClass(width)};
}
