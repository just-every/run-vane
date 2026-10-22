-- Transient admission decisions inside one D1 batch transaction. Successful
-- transactions delete their rows before committing; failed transactions roll
-- them back. This is not history, an idempotency ledger or archive custody.
CREATE TABLE vane_collection_batch_admitted(
 batch_id TEXT NOT NULL,
 record_index INTEGER NOT NULL,
 record_id TEXT NOT NULL,
 PRIMARY KEY(batch_id,record_index)
) WITHOUT ROWID;
