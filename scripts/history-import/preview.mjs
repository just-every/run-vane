import { csvPages } from './csv.mjs';
import { posthogPages } from './posthog.mjs';
import { sourceHash, digest, requireValue, progress } from './common.mjs';
import { privateDirectory, readJson, atomicJson, pageName, pageDigest, readPage, checkManifest } from './store.mjs';
import { reviewedPage, checkHeader } from './review.mjs';
import { client } from './http.mjs';

export async function preview(options) {
  const source = await sourceHash(options.input);
  const dir = options['review-dir'];
  await privateDirectory(dir);
  const saved = await readJson(dir, 'manifest.json', true);
  const manifest = saved ? checkManifest(saved) : {
    version: 1, origin: options.origin, siteId: options.site, format: options.format,
    source, complete: false, rows: 0, normalizedRows: 0, pages: [],
  };
  requireValue(manifest.origin === options.origin && manifest.siteId === options.site &&
    manifest.format === options.format && manifest.source.sha256 === source.sha256 &&
    manifest.source.bytes === source.bytes, 'REVIEW_SOURCE_MISMATCH');
  const post = await client(options.origin, options['cookie-file']);
  manifest.complete = false;
  await atomicJson(dir, 'manifest.json', manifest);
  const second = {}; let index = 0, rows = 0;
  const pages = options.format === 'posthog' ? posthogPages(options.input, second) : csvPages(options.input, second);
  for await (const page of pages) {
    if (options.format !== 'posthog') checkHeader(page.header, options.format);
    const sourceSha256 = digest(page.document);
    const existing = manifest.pages[index];
    if (existing) {
      requireValue(existing.sourceSha256 === sourceSha256 && existing.rows === page.rows, 'REVIEW_PAGE_SOURCE_MISMATCH');
      reviewedPage(await readPage(dir, existing));
    } else {
      const reviewed = reviewedPage(await post('/api/vane/import-preview', { siteId: options.site, document: page.document }));
      requireValue(reviewed.carry.events.length <= page.rows, 'INVALID_PREVIEW_RESPONSE');
      const file = pageName(index);
      await atomicJson(dir, file, reviewed);
      manifest.pages.push({ file, sha256: pageDigest(reviewed), sourceSha256, rows: page.rows,
        normalizedRows: reviewed.carry.events.length, complete: false, jobId: null });
      manifest.rows += page.rows; manifest.normalizedRows += reviewed.carry.events.length;
      await atomicJson(dir, 'manifest.json', manifest);
    }
    index++; rows += page.rows;
    progress('preview', index, rows, false);
  }
  requireValue(second.sha256 === source.sha256 && second.bytes === source.bytes, 'SOURCE_CHANGED_DURING_PREVIEW');
  requireValue(index > 0 && index === manifest.pages.length && rows === manifest.rows, 'SOURCE_ROW_COUNT_MISMATCH');
  manifest.complete = true;
  await atomicJson(dir, 'manifest.json', manifest);
  progress('preview', index, rows, true);
}
