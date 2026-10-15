# Agent commands

Use an authenticated administrator session, kept private. POST JSON to
`/api/vane/commands` with the exact installation Origin header:

```json
{"command":"site.create","input":{"name":"Fern Studio","origin":"https://fern.example","paths":["/","/thanks"],"goals":{"signup":"/thanks"},"campaigns":["launch"],"sources":["search.example"],"consent":"required","sampleRate":100,"retentionDays":90}}
```

`site.configure` takes the same fields plus `siteId`. `history.erase` takes
`{"siteId":"the-site-id"}`. The response is a pending proposal with its ID and
normalized payload. The owner reviews and decides in **Approvals**. No collection
settings or history change at preparation. Approval/rejection records actor and
time. Replayed approvals and stale configuration proposals refuse.

GET `/api/vane/sites`, `/api/vane/summary?siteId=...` and
`/api/vane/proposals` provide evidence (proposals require administrator/owner).
The owner-only move-in doors are POST `/api/vane/import-preview` with
`{siteId,document}`, POST `/api/vane/import-apply` with
`{siteId,document:preview.carry,fingerprint}`, GET
`/api/vane/import-journal?siteId=...&jobId=...` and POST
`/api/vane/import-undo` with `{siteId,jobId}`. Repeat apply/undo until `complete`
is true. Sanitized carry contains no visitor identifiers. The owner performs
imports, rather than delegating approval to an agent.

GET `/api/vane/export` downloads analytics. POST `/api/vane/restore` accepts
`{archive,journal?}` in an empty analytics store. The separate approval form is
`/app/action`; agents must leave proposals for the person. All mutations enforce
same-origin requests. There are no live provider calls in this protocol.
