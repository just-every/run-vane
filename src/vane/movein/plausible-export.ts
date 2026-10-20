import { insist } from '../core'
import { localDate } from '../annotations'
import { plausibleCurrency } from './plausible-definitions'

const CRC=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0})
const crc32=(bytes:Uint8Array)=>{let c=0xffffffff;for(const b of bytes)c=CRC[(c^b)&255]!^(c>>>8);return (c^0xffffffff)>>>0}
const NAMES=new Set(['visitors.csv','pages.csv','entry_pages.csv','exit_pages.csv','browsers.csv','browser_versions.csv','operating_systems.csv','operating_system_versions.csv','devices.csv','channels.csv','sources.csv','referrers.csv','utm_mediums.csv','utm_sources.csv','utm_campaigns.csv','utm_contents.csv','utm_terms.csv','countries.csv','regions.csv','cities.csv','custom_props.csv','conversions.csv'])
async function inflate(bytes:Uint8Array,expected:number) {
 const stream=new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw')),reader=stream.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>expected||length>2_000_000){await reader.cancel();insist(false,'plausible_zip_size','The export exceeds its declared size.',413)}chunks.push(part.value)}}catch(error){if(error instanceof Error&&'code' in error)throw error;insist(false,'plausible_zip','The compressed CSV is damaged or unsupported.')}
 insist(length===expected,'plausible_zip','The decompressed CSV does not match its ZIP entry.');const out=new Uint8Array(length);let at=0;for(const c of chunks){out.set(c,at);at+=c.length}return out
}
/** A bounded dashboard ZIP decoder. No filesystem extraction, visitor logs or credentials. */
export async function readPlausibleExport(input:unknown,day:unknown,currency:unknown) {
 insist(input instanceof Uint8Array&&input.byteLength>=22&&input.byteLength<=10_000_000,'plausible_zip','Choose a Plausible dashboard ZIP of at most 10 MB.');
 const bytes=input,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=(at:number)=>view.getUint16(at,true),u32=(at:number)=>view.getUint32(at,true),fits=(at:number,n:number)=>Number.isSafeInteger(at)&&at>=0&&n>=0&&at+n<=bytes.length;
 let end=-1;for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(u32(at)===0x06054b50&&at+22+u16(at+20)===bytes.length){end=at;break}
 insist(end>=0&&u16(end+4)===0&&u16(end+6)===0&&u16(end+8)===u16(end+10),'plausible_zip','Use a single-volume dashboard ZIP.');
 const count=u16(end+10),central=u32(end+16),size=u32(end+12);insist(count>0&&count<=32&&central+size===end,'plausible_zip','Use a standard ZIP containing dashboard CSVs.');
 let at=central,unpacked=0;const entries:{name:string,method:number,packed:number,length:number,crc:number,start:number,end:number}[]=[],seen=new Set<string>();
 for(let i=0;i<count;i++){
  insist(fits(at,46)&&u32(at)===0x02014b50,'plausible_zip','The ZIP directory is damaged.');
  const flags=u16(at+8),method=u16(at+10),packed=u32(at+20),length=u32(at+24),nameLength=u16(at+28),extraLength=u16(at+30),commentLength=u16(at+32),offset=u32(at+42),crc=u32(at+16),next=at+46+nameLength+extraLength+commentLength;
  insist(next<=end&&u16(at+34)===0&&!(flags&~0x080e)&&!(flags&1)&&[0,8].includes(method)&&packed!==0xffffffff&&length!==0xffffffff,'plausible_zip','Encrypted, split and ZIP64 exports are not supported.');
  const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(at+46,at+46+nameLength));insist(NAMES.has(name)&&!seen.has(name),'plausible_zip','Use the unmodified dashboard ZIP with distinct top-level CSV names.');seen.add(name);
  unpacked+=length;insist(unpacked<=10_000_000&&(!['conversions.csv','custom_props.csv'].includes(name)||length<=2_000_000),'plausible_zip_size','The dashboard export is too large for one request.',413);
  insist(offset<central&&fits(offset,30)&&u32(offset)===0x04034b50&&u16(offset+6)===flags&&u16(offset+8)===method,'plausible_zip','The ZIP entry header is damaged.');
  const localName=u16(offset+26),localExtra=u16(offset+28),start=offset+30+localName+localExtra;
  insist(start+packed<=central&&new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset+30,offset+30+localName))===name,'plausible_zip','The ZIP entry name or extent is invalid.');
  insist(entries.every(e=>start+packed<=e.start||offset>=e.end),'plausible_zip','ZIP entries overlap.');
  entries.push({name,method,packed,length,crc,start:offset,end:start+packed});at=next
 }
 insist(at===end&&seen.has('conversions.csv'),'plausible_zip','The dashboard ZIP must contain conversions.csv.');const files:Record<string,string>={};
 for(const e of entries.filter(e=>e.name==='conversions.csv'||e.name==='custom_props.csv')){const offset=e.start,start=offset+30+u16(offset+26)+u16(offset+28),packed=bytes.subarray(start,start+e.packed),data=e.method===0?packed:await inflate(packed,e.length);insist(data.length===e.length&&crc32(data)===e.crc,'plausible_zip','The CSV checksum does not match. Download the export again.');files[e.name]=new TextDecoder('utf-8',{fatal:true}).decode(data)}
 return {format:'vane-plausible-dashboard/1',day:localDate(day),currency:plausibleCurrency(currency),files}
}
