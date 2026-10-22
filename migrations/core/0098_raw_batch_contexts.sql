-- Resolve each distinct context once per native admission batch. The public
-- transaction fills and clears these references; they are neither raw history
-- nor an idempotency ledger. Nullable references allow replay-only contexts
-- absent from the dictionary, without interning otherwise unused durable data.
CREATE TABLE vane_collection_batch_contexts(
 context_index INTEGER PRIMARY KEY,
 site INTEGER,
 context INTEGER
);
