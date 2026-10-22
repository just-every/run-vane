// Compact canonical IDs use their exact 128 bits followed by the untouched UTF-8
// goal suffix. Other historically accepted IDs remain TEXT: no accepted input is
// rewritten or rejected because it does not have canonical UUID hyphen positions.
const encoder=new TextEncoder()
function canonicalTail(siteId:string,id:string) {
 const prefix=siteId+':',tail=id.startsWith(prefix)?id.slice(prefix.length):null
 return tail!==null&&/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.test(tail)?tail:null
}
export function encodeRawId(siteId:string,id:string):ArrayBuffer|string {
 const tail=canonicalTail(siteId,id)
 if(tail===null)return id
 const suffix=encoder.encode(tail.slice(36)),bytes=new Uint8Array(16+suffix.length),hex=tail.slice(0,36).replaceAll('-','')
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
export type RawToken = ['text'|'blob',string]
export function rawToken(siteId:string,id:string):RawToken {
 const tail=canonicalTail(siteId,id)
 if(tail===null)return ['text',id]
 // The canonical UUID already is the exact stored bytes in hexadecimal form.
 // Encode only its untouched suffix instead of parsing and formatting 16 bytes
 // for every pageview in the JSON batch transport.
 const suffix=tail.length===36?'':Array.from(encoder.encode(tail.slice(36)),byte=>byte.toString(16).padStart(2,'0')).join('')
 return ['blob',tail.slice(0,36).replaceAll('-','')+suffix]
}
