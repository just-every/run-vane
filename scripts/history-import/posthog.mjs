import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { ImportError, requireValue } from './common.mjs';

// PostHog JSON Lines: one complete event object per nonblank line. Raw
// properties live only in this bounded page and the existing preview request.
const MAX_DOCUMENT_BYTES = 2_000_000;
const envelopeBytes = Buffer.byteLength('{"results":[]}');
export async function* posthogPages(path, completed) {
  const hash = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, pending = '', first = true, rows = 0;
  let page = [], pageBytes = envelopeBytes;
  const document = () => ({ document: '{"results":[' + page.join(',') + ']}', rows: page.length });

  function* line(raw) {
    if (!raw.trim()) return;
    requireValue(Buffer.byteLength(raw) <= MAX_DOCUMENT_BYTES, 'POSTHOG_ROW_TOO_LARGE');
    let event;
    try { event = JSON.parse(raw); } catch { throw new ImportError('POSTHOG_INVALID_JSON_LINE'); }
    requireValue(event && typeof event === 'object' && !Array.isArray(event), 'POSTHOG_EVENT_OBJECT_REQUIRED');
    // Event type, timestamp, paths and identifiers follow the server's current
    // PostHog importer. Never duplicate or bypass those rules in this command.
    const value = JSON.stringify(event), size = Buffer.byteLength(value);
    requireValue(envelopeBytes + size <= MAX_DOCUMENT_BYTES, 'POSTHOG_ROW_TOO_LARGE');
    if (page.length && pageBytes + 1 + size > MAX_DOCUMENT_BYTES) {
      yield document(); page = []; pageBytes = envelopeBytes;
    }
    pageBytes += size + Number(page.length > 0); page.push(value); rows++;
    if (page.length === 500) {
      yield document(); page = []; pageBytes = envelopeBytes;
    }
  }

  function* consume(text) {
    if (first && text.length) { first = false; if (text[0] === '\uFEFF') text = text.slice(1); }
    const parts = text.split('\n');
    for (let index = 0; index < parts.length; index++) {
      pending += parts[index];
      requireValue(Buffer.byteLength(pending) <= MAX_DOCUMENT_BYTES, 'POSTHOG_ROW_TOO_LARGE');
      if (index < parts.length - 1) { yield* line(pending); pending = ''; }
    }
  }

  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length; hash.update(chunk);
    yield* consume(decoder.decode(chunk, { stream: true }));
  }
  yield* consume(decoder.decode());
  if (pending.length) yield* line(pending);
  requireValue(rows > 0, 'POSTHOG_EMPTY');
  if (page.length) yield document();
  completed.sha256 = hash.digest('hex'); completed.bytes = bytes;
}
