// Compact canonical IDs use their exact 128 bits followed by the untouched UTF-8
// goal suffix. Other historically accepted IDs remain TEXT: no accepted input is
// rewritten or rejected because it does not have canonical UUID hyphen positions.
export function encodeRawId(siteId:string,id:string):ArrayBuffer|string {
 const prefix=siteId+':',tail=id.startsWith(prefix)?id.slice(prefix.length):null
 if(tail===null||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.test(tail))return id
 const suffix=new TextEncoder().encode(tail.slice(36)),bytes=new Uint8Array(16+suffix.length),hex=tail.slice(0,36).replaceAll('-','')
 for(let i=0;i<16;i++)bytes[i]=parseInt(hex.slice(i*2,i*2+2),16)
 bytes.set(suffix,16)
 return bytes.buffer
}
export function encodeRawHash(value:string|null|undefined):ArrayBuffer|string|null {
 if(value==null)return null
 if(!/^[0-9a-f]{64}$/.test(value))return value
 return Uint8Array.from(value.match(/../g)!,byte=>parseInt(byte,16)).buffer
}
export function rawIdSite(id:string):string { return id.slice(0,id.indexOf(':')) }
