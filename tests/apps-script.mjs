import { Worker } from 'node:worker_threads'
// Runs an Apps Script file (a Looker Studio connector) as Google's runtime does: its UrlFetchApp.fetch is synchronous.
// The script runs in a worker thread that blocks on Atomics.wait while this thread answers each fetch through
// `fetcher` (the installation under test); PropertiesService keeps the user's properties in memory. Google's runtime
// is the only fake.
const runtime=`const {parentPort,workerData}=require('node:worker_threads'),vm=require('node:vm')
const control=new Int32Array(workerData.control),data=new Uint8Array(workerData.data),props=new Map()
const context=vm.createContext({
 UrlFetchApp:{fetch(url,options){Atomics.store(control,0,0);parentPort.postMessage({type:'fetch',url,options:JSON.parse(JSON.stringify(options??{}))});Atomics.wait(control,0,0);const r=JSON.parse(new TextDecoder().decode(data.slice(0,control[1])));return {getResponseCode:()=>r.status,getContentText:()=>r.body}}},
 PropertiesService:{getUserProperties:()=>({getProperty:k=>props.has(k)?props.get(k):null,setProperty:(k,v)=>{props.set(k,String(v))},deleteProperty:k=>{props.delete(k)}})},
})
vm.runInContext(workerData.source,context)
parentPort.on('message',m=>{try{parentPort.postMessage({type:'result',id:m.id,value:JSON.parse(JSON.stringify(context[m.fn](m.arg)??null))})}catch(e){parentPort.postMessage({type:'result',id:m.id,error:String(e.message)})}})`
export function appsScript(source,fetcher) {
 const control=new SharedArrayBuffer(8),data=new SharedArrayBuffer(8<<20),c=new Int32Array(control),d=new Uint8Array(data),pending=new Map(),fetches=[]
 const worker=new Worker(runtime,{eval:true,workerData:{source,control,data}});let n=0
 worker.on('message',async m=>{
  if(m.type==='fetch'){fetches.push(m);const r=await fetcher(m.url,m.options),bytes=new TextEncoder().encode(JSON.stringify(r));d.set(bytes);Atomics.store(c,1,bytes.length);Atomics.store(c,0,1);Atomics.notify(c,0);return}
  const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.value)
 })
 return {call:(fn,arg)=>new Promise((resolve,reject)=>{const id=++n;pending.set(id,{resolve,reject});worker.postMessage({id,fn,arg})}),fetches,close:()=>worker.terminate()}
}
