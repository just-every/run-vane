import { insist, VaneError } from '../core'

export const BATCH_MAX_BYTES = 65536
export const BATCH_MAX_RECORDS = 100
export async function batchBody(request: Request) {
 const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0
 if (reader) for (;;) {
  const chunk = await reader.read(); if (chunk.done) break
  size += chunk.value.byteLength
  if (size > BATCH_MAX_BYTES) { await reader.cancel(); throw new VaneError('body', 'Send at most 64 KB per collection batch.', 413) }
  chunks.push(chunk.value)
 }
 const bytes = new Uint8Array(size); let offset = 0
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
 let payload: any
 try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new VaneError('json', 'Send a UTF-8 JSON collection batch.') }
 insist(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).length === 1 && Object.hasOwn(payload, 'events'), 'fields', 'A collection batch contains only events.')
 insist(Array.isArray(payload.events) && payload.events.length >= 1 && payload.events.length <= BATCH_MAX_RECORDS, 'events', 'Send 1 to 100 normal pageview records.')
 return payload.events as any[]
}
