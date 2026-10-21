import { readFile } from 'node:fs/promises';
import { ImportError, requireValue } from './common.mjs';

export async function client(origin, cookieFile) {
  const cookie = (await readFile(cookieFile, 'utf8')).trim();
  requireValue(cookie.length > 0 && cookie.length < 65536 && !/[\r\n]/.test(cookie), 'INVALID_COOKIE_FILE');
  return async (path, body) => {
    let response;
    try {
      response = await fetch(origin + path, {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', origin, cookie },
        body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
      });
    } catch { throw new ImportError('HTTP_REQUEST_FAILED'); }
    // Never include a provider response body, URL or cookie in diagnostics.
    if (!response.ok) { await response.body?.cancel(); throw new ImportError(`HTTP_${response.status}`); }
    const reader = response.body?.getReader();
    const chunks = []; let size = 0;
    if (reader) while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 4_000_000) { await reader.cancel(); throw new ImportError('HTTP_RESPONSE_TOO_LARGE'); }
      chunks.push(chunk.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new ImportError('HTTP_INVALID_JSON'); }
  };
}
