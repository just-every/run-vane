import { insist } from './core'
export async function input(request:Request):Promise<Record<string,any>> {
 const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
 if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>10_000_000){await reader.cancel();insist(false,'size','Use rer export/import for archives larger than 10 MB.',413)}chunks.push(part.value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 if(request.headers.get('content-type')?.includes('application/json')) { const value=JSON.parse(new TextDecoder().decode(bytes));insist(value&&typeof value==='object'&&!Array.isArray(value),'body','Expected an object.');return value }
 const form=await new Response(bytes,{headers:{'content-type':request.headers.get('content-type')??''}}).formData(),result:Record<string,any>={};
 for(const [key,value] of form){insist(!Object.hasOwn(result,key),'duplicate','Duplicate form field.');result[key]=typeof value==='string'?value:value.size?(key==='plausibleZip'||key==='metroNames'?new Uint8Array(await value.arrayBuffer()):await value.text()):''}
 return result;
}
export const jsonValue=(value:any)=>typeof value==='string'?JSON.parse(value):value
