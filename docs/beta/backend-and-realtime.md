# Beta Backend and Realtime

## Storage Model

All canonical product data is stored in PostgreSQL. Migrations are applied in
order from `server/models/migrations/`: Auth.js identity first, the product
schema second, then identity linkage, document revisioning, and integrity
constraints. Original uploaded bytes and profile picture bytes are PostgreSQL
`bytea`; document structure and historical snapshots are `jsonb`.

| Table | Stored data | Key relationships |
| --- | --- | --- |
| `auth_users` | Google-authenticated identity: UUID, name, normalized email, image metadata. | Referenced by Auth.js accounts, sessions, and product users. |
| `auth_accounts` | Provider and provider-account identity. | `(provider, provider_account_id)` is the primary key; cascades from `auth_users`. |
| `auth_sessions` | SHA-256 token hash and expiry, never the raw session token. | References `auth_users`; expired sessions are cleaned by the adapter. |
| `users` | Product user UUID, immutable `auth_user_id`, email, display name, optional profile picture bytes and MIME type. | One product user per Auth.js user. |
| `user_stats` | Aggregate active-document progress and streak fields. | One row per product user. |
| `documents` | Title, academic style, style settings, canonical Tiptap JSON, original upload metadata/bytes, progress totals, current processing block, trash state, and monotonic revision. | References `users`; owns blocks and versions. |
| `document_blocks` | One logical editable block: text, status, character count, formatting attrs, and Tiptap node JSON. | References `documents`; unique ordering and at most one `processing` block. |
| `document_versions` | Immutable numbered snapshot, label, style snapshot, preview, and timestamp. | References `documents`; unique `(document_id, version_number)`. |

The current-processing foreign key is compound: `(documents.id,
documents.current_processing_block_id)` must point to a block in that same
document. Progress counters are constrained to non-negative values with
`completed_chars <= total_chars` and a rate between zero and one.

## Example Canonical Document

The API returns a fully loaded document in this form after a read or successful
save:

```json
{
  "id": "7a8f2b54-11d9-4cdf-9629-8f9007dd1d23",
  "user_id": "45c2ff69-b609-48e1-9c91-4b9d864a6a59",
  "title": "Methods draft",
  "academic_style": "APA",
  "style_settings": { "font": "Times New Roman", "spacing": "2.0" },
  "content_json": {
    "type": "doc",
    "content": [{
      "type": "paragraph",
      "attrs": {
        "blockId": "1b29db48-d561-4d3c-8371-176efad29bf4",
        "status": "processing",
        "lineHeight": "2.0",
        "textIndent": "0.5in"
      },
      "content": [{ "type": "text", "text": "Participants completed the survey." }]
    }]
  },
  "current_processing_block_id": "1b29db48-d561-4d3c-8371-176efad29bf4",
  "completed_chars": 0,
  "total_chars": 34,
  "completed_rate": 0,
  "revision": 4,
  "trashed": false,
  "blocks": [{
    "id": "1b29db48-d561-4d3c-8371-176efad29bf4",
    "block_index": 0,
    "text_content": "Participants completed the survey.",
    "status": "processing",
    "char_length": 34,
    "attrs": { "blockId": "1b29db48-d561-4d3c-8371-176efad29bf4", "status": "processing" }
  }]
}
```

## CRUD and Derived Updates

| Operation | Canonical write | Derived state and event |
| --- | --- | --- |
| Create blank document | Inserts `documents`, one processing `document_blocks` row, and an initial version. | Recalculates user progress; publishes `document:created`, `version:created`, and `progress:updated`. |
| Upload document | Resolves the source file into blocks, then inserts the document, original bytes, block rows, and initial version in one transaction. | First block is processing; publishes the same events as create. |
| Save editor draft | Locks the active document, replaces block rows from `content_json`, updates title/style/content, advances revision, and may append a version. | Ensures one processing block, recalculates document/user progress; publishes `document:updated`, optional `version:created`, and `progress:updated`. |
| Set block status | Locks the document and target block, updates status, and selects the next unprocessed block after processed/skipped actions. | Recalculates progress, appends a version, publishes `block:updated`, `version:created`, and `progress:updated`. |
| Trash, restore, delete | Updates trash state or removes an already trashed document. | Recalculates user progress; publishes `document:trashed`, `document:restored`, or `document:deleted`. |
| Version revert | Restores the selected immutable snapshot into the document and block rows, then creates a new version. | Recalculates progress; publishes `document:reverted`, `version:created`, and `progress:updated`. |
| Profile picture | Stores image bytes and MIME type on the product user row. | Publishes `profile:updated`. |

The current rewrite cards are not a backend AI service. They change a Tiptap
draft locally and make it dirty. A user save performs the normal document-save
transaction above, so a selected pseudo-AI replacement is persisted exactly
like a manual editor change. A future AI workflow should supply candidates only;
the chosen candidate must continue through the same save transaction.

## Realtime Establishment

Socket.IO is attached to the same HTTP server in `app.js`. The server transport
and authorization live in `server/realtime/index.js`; event creation and field
sanitization live in `server/realtime/publisher.js`. The browser client is
`src/services/realtime.js`, and `src/components/RealtimeProvider.jsx` owns the
shared cache and reconnection refresh.

### Authorization and Rooms

1. The Socket.IO handshake reads the Auth.js cookie session.
2. The server resolves the authenticated Auth.js user to the product user.
3. Every socket joins the trusted `user:{authUserId}` room.
4. A workspace may request `document:subscribe`; the server verifies document
   ownership before joining `document:{documentId}`.
5. `document:unsubscribe` leaves the document room. `sync:request` is an
   acknowledgement point; the client performs REST refreshes for canonical
   state on connection or reconnection.

Each REST mutation commits PostgreSQL first. Only after that commit does the
router call the publisher. Publisher payloads omit raw upload bytes, profile
picture bytes, authentication secrets, and session material. An event contains
an event UUID, type, occurrence time, resource ID, revision when applicable,
optional mutation ID, and a sanitized canonical resource.

### Before and After a Mutation

Before Save, a workspace draft is deliberately local: typing, applying a
pseudo-AI card, undo, redo, and Leave Without Saving do not notify other
sessions. This provides the single-user draft decision requested by the
workspace UX.

After a successful REST mutation, the database contains the canonical state,
the response updates the initiating session, and Socket.IO informs every other
same-user session without a browser reload. `RealtimeProvider` de-duplicates
events by event ID and applies documents only when their revision is newer than
the cached revision. On reconnect it refreshes profile, active documents,
trash, subscribed documents, and observed version lists through REST before
continuing realtime delivery.

This is intentionally last-commit-wins rather than character-level
collaboration. Database transactions serialize writes, document revisions order
committed snapshots, and the newest successful commit becomes the shared state.
