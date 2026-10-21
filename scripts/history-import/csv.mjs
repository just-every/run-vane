import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { ImportError, requireValue } from './common.mjs';

// Retain at most one source page. The raw input is never written to disk.
const MAX_DOCUMENT_BYTES = 2_000_000;
export async function* csvPages(path, completed) {
  const hash = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, raw = '', cell = '', cells = [], state = 'start', skipLf = false;
  let header, page = [], pageBytes = 0, first = true;

  function finishRow() {
    cells.push(cell);
    const row = { text: raw, cells };
    raw = ''; cell = ''; cells = []; state = 'start';
    if (!row.cells.some(value => value !== '')) return null;
    if (!header) {
      header = row;
      pageBytes = Buffer.byteLength(header.text) + 1;
      return null;
    }
    requireValue(row.cells.length === header.cells.length, 'CSV_COLUMN_COUNT');
    const size = Buffer.byteLength(row.text) + 1;
    requireValue(Buffer.byteLength(header.text) + 1 + size <= MAX_DOCUMENT_BYTES, 'CSV_ROW_TOO_LARGE');
    let ready = null;
    if (page.length && pageBytes + size > MAX_DOCUMENT_BYTES) {
      ready = { document: header.text + '\n' + page.join('\n') + '\n', rows: page.length, header: header.cells };
      page = []; pageBytes = Buffer.byteLength(header.text) + 1;
    }
    page.push(row.text); pageBytes += size;
    if (page.length !== 500) return ready;
    ready = { document: header.text + '\n' + page.join('\n') + '\n', rows: page.length, header: header.cells };
    page = []; pageBytes = Buffer.byteLength(header.text) + 1;
    return ready;
  }

  function* consume(text) {
    for (const ch of text) {
      if (first) { first = false; if (ch === '\uFEFF') continue; }
      if (skipLf) { skipLf = false; if (ch === '\n') continue; }
      if (state !== 'quoted' && (ch === '\r' || ch === '\n')) {
        const ready = finishRow();
        if (ch === '\r') skipLf = true;
        if (ready) yield ready;
        continue;
      }
      raw += ch;
      // A bounded row also bounds fields discarded later by the server.
      requireValue(raw.length <= MAX_DOCUMENT_BYTES, 'CSV_ROW_TOO_LARGE');
      if (state === 'quoted') {
        if (ch === '"') state = 'closed'; else cell += ch;
      } else if (state === 'closed') {
        if (ch === '"') { cell += '"'; state = 'quoted'; }
        else if (ch === ',') { cells.push(cell); cell = ''; state = 'start'; }
        else throw new ImportError('CSV_AFTER_QUOTE');
      } else if (ch === ',') {
        cells.push(cell); cell = ''; state = 'start';
      } else if (ch === '"') {
        requireValue(state === 'start', 'CSV_UNEXPECTED_QUOTE'); state = 'quoted';
      } else { cell += ch; state = 'plain'; }
    }
  }

  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length; hash.update(chunk);
    yield* consume(decoder.decode(chunk, { stream: true }));
  }
  yield* consume(decoder.decode());
  requireValue(state !== 'quoted', 'CSV_UNCLOSED_QUOTE');
  if (raw.length || cell.length || cells.length) {
    const ready = finishRow(); if (ready) yield ready;
  }
  requireValue(header, 'CSV_EMPTY');
  if (page.length) yield { document: header.text + '\n' + page.join('\n') + '\n', rows: page.length, header: header.cells };
  completed.sha256 = hash.digest('hex'); completed.bytes = bytes;
}
