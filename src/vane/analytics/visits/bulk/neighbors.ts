// Seek one timestamp bucket per existing context, then compare complete tokens
// within that bucket. Excluding this transaction's rows recovers the exact old
// successor/predecessor without walking an accumulated anonymous raw chain.
export function neighbor(row: string, direction: 'before' | 'after', old = false): string {
 const op = direction === 'before' ? '<' : '>'
 const order = direction === 'before' ? 'DESC' : 'ASC'
 const existing = (alias: string) => old ? `AND NOT EXISTS(SELECT 1 FROM vane_visit_work queued WHERE queued.raw_id=${alias}.raw_id AND queued.action='bulk')` : ''
 return `(SELECT candidate.raw_id FROM vane_raw_contexts cx JOIN vane_raw_events candidate ON candidate.raw_id=COALESCE(
  (SELECT tied.raw_id FROM vane_raw_events tied WHERE tied.context=cx.context AND tied.at_offset=${row}.at_offset
   AND tied.token${op}${row}.token ${existing('tied')} ORDER BY tied.token ${order} LIMIT 1),
  (SELECT adjacent.raw_id FROM vane_raw_events adjacent WHERE adjacent.context=cx.context AND adjacent.at_offset=(
   SELECT bucket.at_offset FROM vane_raw_events bucket WHERE bucket.context=cx.context AND bucket.at_offset${op}${row}.at_offset
   ${existing('bucket')} ORDER BY bucket.at_offset ${order} LIMIT 1)
   ${existing('adjacent')} ORDER BY adjacent.token ${order} LIMIT 1))
  WHERE cx.site=${row}.site AND cx.day=${row}.day AND cx.visitor=${row}.visitor AND cx.kind='pageview'
  ORDER BY candidate.at_offset ${order},candidate.token ${order} LIMIT 1)`
}
