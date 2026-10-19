// API-002: a ZIP archive of stored (uncompressed) files with UTF-8 names and CRC-32 checks, as every unzip tool reads.
const CRC=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0})
const crc32=(bytes:Uint8Array)=>{let c=0xffffffff;for(const b of bytes)c=CRC[(c^b)&0xff]!^(c>>>8);return (c^0xffffffff)>>>0}
export function zip(files:{name:string,text:string}[],at:number):Uint8Array<ArrayBuffer> {
 const utf8=new TextEncoder(),d=new Date(at),time=(d.getUTCHours()<<11)|(d.getUTCMinutes()<<5)|(d.getUTCSeconds()>>1),date=((d.getUTCFullYear()-1980)<<9)|((d.getUTCMonth()+1)<<5)|d.getUTCDate()
 const local:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0
 for(const file of files){
  const name=utf8.encode(file.name),data=utf8.encode(file.text),crc=crc32(data)
  const head=new DataView(new ArrayBuffer(30));[[0,0x04034b50,4],[4,20,2],[6,0x0800,2],[8,0,2],[10,time,2],[12,date,2],[14,crc,4],[18,data.length,4],[22,data.length,4],[26,name.length,2],[28,0,2]].forEach(([at,value,size])=>size===4?head.setUint32(at!,value!,true):head.setUint16(at!,value!,true))
  const entry=new DataView(new ArrayBuffer(46));[[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x0800,2],[10,0,2],[12,time,2],[14,date,2],[16,crc,4],[20,data.length,4],[24,data.length,4],[28,name.length,2],[30,0,2],[32,0,2],[34,0,2],[36,0,2],[38,0,4],[42,offset,4]].forEach(([at,value,size])=>size===4?entry.setUint32(at!,value!,true):entry.setUint16(at!,value!,true))
  local.push(new Uint8Array(head.buffer),name,data);central.push(new Uint8Array(entry.buffer),name);offset+=30+name.length+data.length
 }
 const size=central.reduce((n,part)=>n+part.length,0),end=new DataView(new ArrayBuffer(22));[[0,0x06054b50,4],[4,0,2],[6,0,2],[8,files.length,2],[10,files.length,2],[12,size,4],[16,offset,4],[20,0,2]].forEach(([at,value,s])=>s===4?end.setUint32(at!,value!,true):end.setUint16(at!,value!,true))
 const parts=[...local,...central,new Uint8Array(end.buffer)],out=new Uint8Array(parts.reduce((n,part)=>n+part.length,0));let at2=0;for(const part of parts){out.set(part,at2);at2+=part.length}
 return out
}
