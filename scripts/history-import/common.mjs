import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export class ImportError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function requireValue(condition, code) {
  if (!condition) throw new ImportError(code);
}
export const digest = value => createHash('sha256').update(value).digest('hex');

export async function sourceHash(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}

export function originOf(value) {
  let url;
  try { url = new URL(value); } catch { throw new ImportError('INVALID_ORIGIN'); }
  requireValue(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
    url.pathname === '/' && !url.search && !url.hash, 'INVALID_ORIGIN');
  return url.origin;
}

export function progress(phase, page, rows, complete) {
  process.stdout.write(JSON.stringify({ phase, page, rows, complete }) + '\n');
}
