import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { once } from 'node:events'
import { build, transform } from 'esbuild'

const load = source => import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
const bundled = await build({entryPoints:['src/vane/proxy/templates.ts','src/vane/proxy/adapter.ts'],bundle:true,write:false,outdir:'unused',format:'esm',platform:'node',target:'es2022',minify:true})
const moduleFor = name => load(bundled.outputFiles.find(f=>f.path.endsWith('/'+name+'.js')).text)
const { createVaneProxy } = await moduleFor('adapter')
const { generateProxySetup } = await moduleFor('templates')
const credential='synthetic-proxy-credential-only'
const defaults={connectionId:'synthetic-connection-1',siteId:'synthetic-site-1',siteOrigin:'https://synthetic-site.example',publicPrefix:'/insights'}
const visitor={ip:'198.51.100.41',country:'AU',region:'QLD',city:'Brisbané東京'}
const serve=async handler=>{
 const server=createServer(handler)
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 return {origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()})}
}
async function upstreamFixture(t) {
 const received=[]
 let mode='normal'
 const server=await serve(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  received.push({path:req.url,method:req.method,headers:req.headers,body:Buffer.concat(chunks).toString()})
  if(mode==='redirect'){res.writeHead(307,{location:'/unexpected'});return res.end()}
  if(mode==='echo'){res.writeHead(500,{'content-type':'text/plain'});return res.end(credential)}
  if(mode==='large'){res.writeHead(200,{'content-type':'text/plain'});return res.end('x'.repeat(1100000))}
  res.writeHead(req.method==='POST'?202:200,{'content-type':req.url.endsWith('/script.js')?'application/javascript':'application/json','set-cookie':'synthetic-session=private','authorization':'Bearer '+credential,'x-private-debug':credential})
  res.end(req.url.endsWith('/script.js')?'window.syntheticTracker=true;':JSON.stringify({accepted:true}))
 })
 t.after(server.close)
 return {...server,received,setMode:value=>{mode=value}}
}
const request = (suffix,method='GET',body,extra={}) => new Request('https://synthetic-site.example/insights/'+suffix,{method,headers:{origin:defaults.siteOrigin,'user-agent':'Synthetic visitor',...(body===undefined?{}:{'content-type':'application/json'}),...extra},body})

test('server proxy forwards every public tracker door over HTTP and strips untrusted identity and credentials',async t=>{
 const upstream=await upstreamFixture(t)
 const proxy=createVaneProxy({...defaults,installationOrigin:upstream.origin,serverCredential:credential})
 const front=await serve(async(req,res)=>{
  const init={method:req.method,headers:req.headers}
  if(req.method!=='GET'&&req.method!=='HEAD'){init.body=Readable.toWeb(req);init.duplex='half'}
  const response=await proxy(new Request('http://127.0.0.1'+req.url,init),visitor)
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
 });t.after(front.close)
 const doors=[['script.js','GET'],['config/'+defaults.siteId,'GET'],...['collect','engage','custom','event','perf','exposure','signal/'+defaults.siteId,'declined/'+defaults.siteId,'ignored/'+defaults.siteId].map(path=>[path,'POST'])]
 for(const [path,method] of doors){
  const response=await fetch(front.origin+'/insights/'+path,{method,headers:{origin:defaults.siteOrigin,'user-agent':'Synthetic visitor',cookie:'browser-secret=untrusted',authorization:'Bearer browser-secret','x-vane-proxy-ip':'203.0.113.1','x-vane-proxy-country':'US',dnt:'1','sec-gpc':'1'},body:method==='POST'?JSON.stringify({siteId:defaults.siteId}):undefined})
  assert.equal(response.status,method==='POST'?202:200)
  assert.equal(response.headers.get('set-cookie'),null)
  assert.equal(response.headers.get('authorization'),null)
  assert.equal(response.headers.get('x-private-debug'),null)
  assert.ok(!(await response.text()).includes(credential))
  const record=upstream.received.at(-1)
  assert.equal(record.path,'/api/vane/proxy/'+defaults.connectionId+'/'+path)
  assert.equal(record.method,method)
  assert.equal(record.headers.authorization,'Bearer '+credential)
  assert.equal(record.headers.cookie,undefined)
  assert.equal(record.headers.origin,defaults.siteOrigin)
  assert.equal(record.headers['user-agent'],'Synthetic visitor')
  assert.equal(record.headers['x-vane-proxy-ip'],visitor.ip)
  assert.equal(record.headers['x-vane-proxy-country'],visitor.country)
  assert.equal(decodeURIComponent(record.headers['x-vane-proxy-city']),visitor.city)
  assert.equal(record.headers.dnt,'1');assert.equal(record.headers['sec-gpc'],'1')
 }
 const response=await proxy(request('collect','POST','{}'),{ip:visitor.ip})
 assert.equal(response.status,202)
 for(const field of ['country','region','city'])assert.equal(upstream.received.at(-1).headers['x-vane-proxy-'+field],undefined)
})

test('proxy refuses unsupported doors, untrusted visitors, oversized streaming bodies and leaking upstream responses',async t=>{
 const upstream=await upstreamFixture(t)
 const proxy=createVaneProxy({...defaults,installationOrigin:upstream.origin,serverCredential:credential})
 for(const suffix of ['settings','config/other-site','signal/other-site','script.js?token=private','collect/extra','%63ollect'])assert.equal((await proxy(request(suffix),visitor)).status,404)
 assert.equal((await proxy(request('script.js','POST','{}'),visitor)).status,405)
 assert.equal((await proxy(request('collect','GET'),visitor)).status,405)
 assert.equal((await proxy(request('collect','POST','{}'),{})).status,503)
 for(const ip of ['unknown','198.51.100.1, 203.0.113.1','999.0.0.1','::gg','198.051.100.1'])assert.equal((await proxy(request('collect','POST','{}'),{ip})).status,503)
 assert.equal((await proxy(request('collect','POST','{}',{origin:'https://other.example'}),visitor)).status,403)
 assert.equal((await proxy(request('collect','POST','{}',{'content-encoding':'gzip'}),visitor)).status,415)
 assert.equal((await proxy(request('collect','POST','x'.repeat(65537)),visitor)).status,413)
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(35000));controller.enqueue(new Uint8Array(35000));controller.close()}})
 assert.equal((await proxy(new Request('https://synthetic-site.example/insights/collect',{method:'POST',body:stream,duplex:'half'}),visitor)).status,413)
 assert.equal(upstream.received.length,0)
 for(const mode of ['redirect','echo','large']){upstream.setMode(mode);const response=await proxy(request('script.js'),visitor);assert.equal(response.status,502);assert.equal(response.headers.get('location'),null);assert.equal(await response.text(),'')}
 assert.equal(upstream.received.length,3,'upstream redirect target was never requested')
 upstream.setMode('normal')
 assert.equal((await proxy(request('collect','POST','{}'),{ip:'2001:db8::42'})).status,202)
 assert.equal(upstream.received.at(-1).headers['x-vane-proxy-ip'],'2001:db8::42')
})

test('custom collection hosts answer only registered-origin preflights without upstream credentials or data',async t=>{
 const upstream=await upstreamFixture(t)
 const proxy=createVaneProxy({...defaults,installationOrigin:upstream.origin,serverCredential:credential})
 const preflight=(origin=defaults.siteOrigin,headers='content-type',suffix='collect')=>new Request('https://stats.synthetic-site.example/insights/'+suffix,{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':headers}})
 const response=await proxy(preflight(),{})
 assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),defaults.siteOrigin)
 assert.equal(response.headers.get('access-control-allow-credentials'),null)
 assert.equal((await proxy(preflight('https://other.example'),{})).status,403)
 assert.equal((await proxy(preflight(defaults.siteOrigin,'authorization'),{})).status,403)
 assert.equal((await proxy(preflight(defaults.siteOrigin,'content-type','settings'),{})).status,404)
 assert.equal(upstream.received.length,0)
})

async function generatedHandler(platform,upstream) {
 const setup=generateProxySetup({...defaults,platform,installationOrigin:'https://synthetic-installation.example'})
 const core=setup.files.find(file=>file.path==='vane-proxy.mjs').content
 // The network edge is local HTTP in this account-free proof; production generation enforces HTTPS.
 let source=setup.files.find(file=>file.path.includes(platform==='cloudflare'?'worker.mjs':platform==='netlify'?'netlify/':'route.js')).content.replace('https://synthetic-installation.example',upstream.origin)
 const coreURL='data:text/javascript;base64,'+Buffer.from(core).toString('base64')
 source=source.replace(/from ['"](?:\.\.\/|\.\/)+vane-proxy\.mjs['"]/g,'from '+JSON.stringify(coreURL))
 source=source.replace("import 'server-only';",'')
 if(platform==='vercel')source=source.replace("import { ipAddress, geolocation } from '@vercel/functions';",`const ipAddress = () => ${JSON.stringify(visitor.ip)}; const geolocation = () => (${JSON.stringify({country:visitor.country,countryRegion:visitor.region,city:visitor.city})});`)
 await transform(source,{loader:'js'});
 try { return {setup,module:await load(source)} } catch(error) { throw new Error(platform+' generated execution failed', {cause:error}) }
}

test('downloaded adapters execute with platform-attested metadata and Next rewritten path parameters',async t=>{
 const upstream=await upstreamFixture(t)
 const saved=process.env.VANE_PROXY_CREDENTIAL;process.env.VANE_PROXY_CREDENTIAL=credential
 const savedPort=process.env.VANE_PROXY_PORT;process.env.VANE_PROXY_PORT='0'
 const savedNetlify=globalThis.Netlify;globalThis.Netlify={env:{get:()=>credential}}
 t.after(()=>{if(saved===undefined)delete process.env.VANE_PROXY_CREDENTIAL;else process.env.VANE_PROXY_CREDENTIAL=saved;globalThis.Netlify=savedNetlify;if(savedPort===undefined)delete process.env.VANE_PROXY_PORT;else process.env.VANE_PROXY_PORT=savedPort})
 for(const platform of ['cloudflare','netlify','nextjs','vercel']){
  const {setup,module}=await generatedHandler(platform,upstream)
  assert.ok(setup.files.every(file=>!file.content.includes(credential)))
  const incoming=request('collect','POST',JSON.stringify({siteId:defaults.siteId}),{'x-vane-proxy-ip':'203.0.113.2','x-vane-ingress-ip':visitor.ip})
  let response
  if(platform==='cloudflare'){
   Object.defineProperty(incoming,'cf',{value:{country:visitor.country,regionCode:visitor.region,city:visitor.city}})
   incoming.headers.set('CF-Connecting-IP',visitor.ip)
   response=await module.default.fetch(incoming,{VANE_PROXY_CREDENTIAL:credential})
   assert.equal((await module.default.fetch(request('script.js'),{VANE_PROXY_CREDENTIAL:credential})).status,503)
  }else if(platform==='netlify')response=await module.default(incoming,{ip:visitor.ip,geo:{country:{code:visitor.country},subdivision:{code:visitor.region},city:visitor.city}})
  else response=await module.POST(incoming,{params:Promise.resolve({path:['collect']})})
  assert.equal(response.status,202,platform)
  assert.equal(upstream.received.at(-1).headers['x-vane-proxy-ip'],visitor.ip)
  assert.equal(upstream.received.at(-1).path,'/api/vane/proxy/'+defaults.connectionId+'/collect')
  if(platform!=='nextjs')assert.equal(decodeURIComponent(upstream.received.at(-1).headers['x-vane-proxy-city']),visitor.city)
 }
 // Exercise the generated loopback service used by both native web server recipes over real HTTP.
 for(const platform of ['nginx','apache']){
  const setup=generateProxySetup({...defaults,platform,installationOrigin:'https://synthetic-installation.example'})
  const core=setup.files.find(file=>file.path==='vane-proxy.mjs').content
  const coreURL='data:text/javascript;base64,'+Buffer.from(core).toString('base64')
  const source=setup.files.find(file=>file.path==='vane-proxy-server.mjs').content.replace('https://synthetic-installation.example',upstream.origin).replace("'./vane-proxy.mjs'",JSON.stringify(coreURL))
  const {server}=await load(source+'\n// '+platform)
  await once(server,'listening')
  try {
   const origin='http://127.0.0.1:'+server.address().port
   const response=await fetch(origin+'/insights/collect',{method:'POST',headers:{'x-vane-ingress-ip':visitor.ip,origin:defaults.siteOrigin},body:JSON.stringify({siteId:defaults.siteId})})
   assert.equal(response.status,202,platform)
   assert.equal(upstream.received.at(-1).headers['x-vane-proxy-ip'],visitor.ip)
   assert.equal((await fetch(origin+'/insights/script.js')).status,503,'service does not substitute its socket peer for missing attestation')
  }finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()})}
 }
})
