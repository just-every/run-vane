import { insist, site, VaneError, type Env, type Site } from '../core'
import { clock } from '../clock'
import { admitPageviews } from './admit'
import { batchBody } from './body'
import { IndexedCollectionError } from './error'
import { countCollectionRefusal } from './refusal'
import { validatePageview, type ValidatedPageview } from './validation'
import { validationContext } from './validation-context'

export async function collectionBatchResponse(request: Request, env: Env): Promise<Response | null> {
 if (new URL(request.url).pathname !== '/api/vane/collect-batch') return null
 let headers: Record<string, string> = { vary: 'Origin', 'cache-control': 'no-store' }
 if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'access-control-allow-origin': request.headers.get('origin') ?? 'null', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' } })
 const known = new Map<string, Site>(), recordSites: Site[] = []
 let counted = false
 try {
  insist(request.method === 'POST', 'method', 'POST required.', 405)
  const records = await batchBody(request), now = clock(), context = validationContext(request, now), plans: ValidatedPageview[] = []
  for (let index = 0; index < records.length; index++) {
   let value: Site | undefined
   try {
    const payload = records[index]
    insist(payload && typeof payload === 'object' && !Array.isArray(payload), 'event', 'Each batch item is a normal pageview record.')
    insist(JSON.stringify(payload).length <= 8192, 'body', 'A pageview record is at most 8 KB.', 413)
    const id = String(payload.siteId ?? '')
    value = known.get(id)
    if (!value) { value = await site(env, id); known.set(id, value) }
    recordSites[index] = value
    const origin = context.origin(value); headers = { ...headers, 'access-control-allow-origin': origin }
    plans.push(await validatePageview(request, value, origin, payload, now, context))
   } catch (error) {
    if (!(error instanceof VaneError)) throw error
    if (value) { await countCollectionRefusal(env, value, error); counted = true }
    throw new IndexedCollectionError(error, index)
   }
  }
  const results = await admitPageviews(request, env, plans)
  return Response.json({ atomic: true, accepted: results.filter(result => result.status === 202).length, results }, { status: 202, headers })
 } catch (error) {
  const failure = error instanceof VaneError ? error : new VaneError('collection_failed', 'The collection batch could not be committed.', 500)
  if (!counted && failure instanceof IndexedCollectionError && recordSites[failure.index]) await countCollectionRefusal(env, recordSites[failure.index]!, failure)
  return Response.json({ atomic: true, accepted: 0, error: failure.code, message: failure.message, ...(failure instanceof IndexedCollectionError ? { index: failure.index } : {}) }, { status: failure.status, headers })
 }
}
