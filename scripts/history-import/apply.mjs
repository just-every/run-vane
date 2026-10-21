import { requireValue, originOf, progress } from './common.mjs';
import { privateDirectory, readJson, checkManifest, readPage, atomicJson } from './store.mjs';
import { reviewedPage } from './review.mjs';
import { client } from './http.mjs';

export async function apply(options) {
  requireValue(options.yes === true, 'APPLY_REQUIRES_YES');
  const dir = options['review-dir'];
  await privateDirectory(dir);
  const manifest = checkManifest(await readJson(dir, 'manifest.json'));
  requireValue(manifest.complete, 'PREVIEW_INCOMPLETE');
  requireValue(originOf(manifest.origin) === manifest.origin && manifest.siteId.length > 0, 'INVALID_MANIFEST');
  const post = await client(manifest.origin, options['cookie-file']);
  // Check the complete review before the first write, retaining only one page.
  for (const entry of manifest.pages) reviewedPage(await readPage(dir, entry));
  let rows = 0;
  for (const [index, entry] of manifest.pages.entries()) {
    const page = reviewedPage(await readPage(dir, entry));
    while (!entry.complete) {
      const result = await post('/api/vane/import-apply', {
        siteId: manifest.siteId, document: page.carry, fingerprint: page.fingerprint,
      });
      requireValue(typeof result?.complete === 'boolean' && typeof result?.job?.id === 'string' &&
        result.job.id.length > 0 && result.fingerprint === page.fingerprint &&
        (!entry.jobId || entry.jobId === result.job.id), 'INVALID_APPLY_RESPONSE');
      const changed = entry.jobId !== result.job.id || entry.complete !== result.complete;
      entry.jobId = result.job.id; entry.complete = result.complete;
      if (changed) await atomicJson(dir, 'manifest.json', manifest);
      progress('apply', index + 1, rows + (entry.complete ? entry.rows : 0), false);
    }
    rows += entry.rows;
  }
  progress('apply', manifest.pages.length, rows, true);
}
