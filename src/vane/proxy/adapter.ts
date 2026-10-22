/** Server only. The caller attests visitor metadata using its hosting platform or locked-down ingress. */
export interface TrustedProxyVisitor {
 ip?: string | null
 country?: string | null
 region?: string | null
 city?: string | null
}
export interface ProxyAdapterOptions {
 installationOrigin: string
 connectionId: string
 siteId: string
 siteOrigin: string
 publicPrefix: string
 serverCredential: string
}

/** Keep this factory closure-free: setup downloads serialize the compiled function itself. */
export function createVaneProxy(options: ProxyAdapterOptions) {
 const { connectionId, siteId, publicPrefix, serverCredential } = options
 const installation = new URL(options.installationOrigin)
 const site = new URL(options.siteOrigin)
 const isOrigin = (url: URL) => url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password
 if (!isOrigin(installation) || !(installation.protocol === 'https:' || (installation.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(installation.hostname)))) throw new Error('Invalid installation origin')
 if (!isOrigin(site) || !['https:','http:'].includes(site.protocol)) throw new Error('Invalid site origin')
 if (!/^[a-zA-Z0-9_-]+$/.test(connectionId) || !/^[a-zA-Z0-9_-]+$/.test(siteId)) throw new Error('Invalid proxy identifier')
 if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(publicPrefix)) throw new Error('Invalid public prefix')
 if (!serverCredential || !/^[\x21-\x7e]{16,512}$/.test(serverCredential)) throw new Error('Missing server credential')
 const ipv4 = (ip: string) => /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(ip) && ip.split('.').every(part => Number(part) <= 255)
 const validIP = (ip: string) => {
  if (ipv4(ip)) return true
  if (ip.length > 45 || !ip.includes(':') || !/^[a-fA-F0-9:.]+$/.test(ip)) return false
  try { return new URL('http://[' + ip + ']/').hostname.startsWith('[') } catch { return false }
 }
 const limited = async (stream: ReadableStream<Uint8Array> | null, cap: number) => {
  if (!stream) return new Uint8Array()
  const reader = stream.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
   for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > cap) { await reader.cancel(); throw new Error('Body too large') }
    chunks.push(value)
   }
  } finally { reader.releaseLock() }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return result
 }
 return async function proxy(request: Request, visitor: TrustedProxyVisitor): Promise<Response> {
  const url = new URL(request.url), origin = request.headers.get('origin')
  const cors = new Headers({ 'cache-control':'no-store', 'x-content-type-options':'nosniff', vary:'Origin' })
  if (origin === site.origin) cors.set('access-control-allow-origin', origin)
  const fail = (status: number) => new Response(null, {status, headers:cors})
  if (origin && origin !== site.origin) return fail(403)
  if (url.search || !url.pathname.startsWith(publicPrefix + '/')) return fail(404)
  const suffix = url.pathname.slice(publicPrefix.length + 1)
  const get = suffix === 'script.js' || suffix === 'config/' + siteId
  const post = /^(collect|collect-batch|engage|custom|event|perf|exposure|heat-click)$/.test(suffix) || ['signal/','declined/','ignored/'].some(path => suffix === path + siteId)
  if (!get && !post) return fail(404)
  // A custom collection subdomain needs a preflight; no visitor data goes upstream here.
  if (request.method === 'OPTIONS') {
   const requested = request.headers.get('access-control-request-method')
   if (origin !== site.origin || requested !== (post ? 'POST' : 'GET') || (request.headers.get('access-control-request-headers') || '').split(',').some(h => h.trim() && h.trim().toLowerCase() !== 'content-type')) return fail(403)
   cors.set('access-control-allow-methods', post ? 'POST' : 'GET')
   cors.set('access-control-allow-headers','Content-Type')
   return new Response(null,{status:204,headers:cors})
  }
  if (request.method !== (get ? 'GET' : 'POST')) return fail(405)
  if (!visitor?.ip || !validIP(visitor.ip)) return fail(503)
  const headers = new Headers({ authorization:'Bearer ' + serverCredential, 'x-vane-proxy-ip':visitor.ip })
  for (const name of ['origin','user-agent','content-type','dnt','sec-gpc']) {
   const value = request.headers.get(name)
   if (value) headers.set(name,value)
  }
  for (const [key,value] of Object.entries({country:visitor.country,region:visitor.region,city:visitor.city})) {
   if (!value) continue
   if (value.length > 100 || /[\x00-\x1f\x7f]/.test(value)) return fail(503)
   if (key === 'country' && !/^[A-Z]{2}$/.test(value)) continue
   headers.set('x-vane-proxy-' + key,key === 'country' ? value : encodeURIComponent(value))
  }
  if (request.headers.has('content-encoding')) return fail(415)
  const length = request.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > 65536)) return fail(413)
  let body: Uint8Array<ArrayBuffer>
  try { body = await limited(request.body,65536) } catch { return fail(413) }
  if (get && body.byteLength) return fail(400)
  const upstreamURL = installation.origin + '/api/vane/proxy/' + connectionId + '/' + suffix
  try {
   const upstream = await fetch(upstreamURL, { method:request.method, headers, body:post ? body : undefined, redirect:'manual', credentials:'omit', cache:'no-store', signal:AbortSignal.timeout(10000) })
   if (upstream.status >= 300 && upstream.status < 400) { await upstream.body?.cancel(); return fail(502) }
   const bytes = await limited(upstream.body,1048576)
   // Fail closed even if an upstream error inadvertently echoes the authentication value.
   if (new TextDecoder().decode(bytes).includes(serverCredential)) return fail(502)
   const contentType = upstream.headers.get('content-type')
   if (contentType && !/^(?:application\/(?:json|javascript)|text\/(?:plain|javascript))(?:;|$)/i.test(contentType)) return fail(502)
   if (contentType) cors.set('content-type',contentType)
   return new Response([204,205,304].includes(upstream.status) ? null : bytes, {status:upstream.status,headers:cors})
  } catch { return fail(502) }
 }
}
