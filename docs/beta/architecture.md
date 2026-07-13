# Beta Architecture

## Scope

This beta is a React workspace backed by Express, Auth.js, PostgreSQL, and
Socket.IO. The browser keeps only temporary UI state such as an unsaved editor
draft, open menus, and rewrite-card responses. Canonical users, documents,
blocks, versions, profile pictures, and progress are stored in PostgreSQL.

## Repository Layout

| Path | Responsibility |
| --- | --- |
| `app.js` | Express HTTP server, Auth.js mount, API mount, production static serving, and Socket.IO attachment. |
| `server/auth.js` | Google OAuth configuration and Auth.js PostgreSQL adapter setup. |
| `server/models/` | PostgreSQL models, migrations, block normalization, document versions, and user statistics. |
| `server/routers/` | Authenticated REST handlers for profiles, documents, trash, and versions. |
| `server/middlewares/` | Session/origin enforcement, upload handling, and error mapping. |
| `server/realtime/` | Socket.IO authentication, room authorization, and committed-event publishing. |
| `src/components/` | Reusable React UI, including the editor, realtime provider, and rewrite-card module. |
| `src/pages/` | Page orchestration for the home, workspace, account, trash, and version-history views. |
| `src/services/` | Browser API clients, Socket.IO client helpers, and the server-consumed document resolver library. |
| `src/openapi.yml` | Current REST contract with an `x-socket-io` extension for realtime events. |
| `scripts/` | Operational database utilities and repeatable owl-asset generation; generated owl path data is imported by the UI at runtime. |
| `docs/beta/` | Beta architecture and backend/realtime reference. |

## Runtime Flow

1. The browser signs in through Google OAuth using Auth.js routes under
   `/auth`.
2. Authenticated browser requests use `/api`. `loadAuthSession` and
   `requireAuth` attach and verify the Auth.js user before application routers
   execute.
3. A router obtains the product `users` row from the immutable Auth.js user ID,
   then performs the scoped PostgreSQL mutation through the model layer.
4. The model returns the canonical post-commit resource. The router responds
   with that resource and publishes a sanitized Socket.IO event.
5. `RealtimeProvider` applies committed resources to each same-user browser
   session without a page reload.

## Upload Resolution

`src/services/documentResolver.js` is the upload-to-block boundary. The
documents router calls `resolveDocumentUpload({ buffer, filename })` before
creating a document. The resolver returns formatting-aware logical blocks with
this stable shape:

```js
{
  sourceType: 'heading' | 'paragraph' | 'blockquote' | 'bulletListItem' | 'orderedListItem' | 'codeBlock' | 'listItem' | 'tableCell',
  text: 'Logical block text',
  attrs: { sourceType: 'paragraph' },
  content: [{ type: 'text', text: 'Logical block text' }]
}
```

Current format behavior:

| Input | Resolution behavior |
| --- | --- |
| TXT | Decodes strict UTF-8 and turns each non-empty logical line into a block. |
| Markdown | Preserves heading, quote, list, ordered-list, and fenced-code boundaries. |
| DOCX | Uses Mammoth to obtain semantic HTML, then Parse5 to preserve headings, paragraphs, list items, table cells, line-break segments, and inline marks. |

`server/models/blocks.js` turns the resolver output into `document_blocks` rows
and Tiptap content. The first block becomes `processing`; later blocks begin
as `unprocessed`.

### Future Resolver Changes

Replace the extension-specific branch inside `resolveDocumentUpload`, not the
router or database contract. A future clustering or NLP pipeline may accept
the resolved blocks, merge or split them, attach analysis metadata in `attrs`,
and return the same `{ sourceType, text, attrs, content }` shape. The model
will continue to create UUID-backed blocks, Tiptap nodes, progress counters,
and the first processing block. This isolates future semantic partitioning from
HTTP, realtime, and persistence code.

## Pseudo AI Rewrite Boundary

`src/components/DocumentRewriter.jsx` owns the visible rewrite cards.
`generateResponse` and `regenerateResponse` are explicit temporary factories:
they produce deterministic text, while card 2 regeneration deliberately
returns a network-error state for UI handling.

When a user applies a card, `WorkspacePage` replaces the current Tiptap block,
marks it processed, selects the next unprocessed block, and marks the workspace
dirty. This is intentionally an unsaved draft: only the editor Save action
persists the resulting `content_json` and derived block rows through
`PATCH /api/documents/{documentId}`. Leave Without Saving restores the last
canonical PostgreSQL state.

### Future AI Integration

Replace the two response factories with an asynchronous AI service boundary
while preserving the card response contract. The new workflow should:

1. Send the current block UUID, text, document style settings, and any future
   resolver metadata to a server-side AI endpoint or queued workflow.
2. Return validated replacement candidates and optional explanations without
   directly mutating the document.
3. Keep provider errors as card-level errors, including retry behavior.
4. Apply a chosen candidate through the existing Tiptap transaction and leave
   the workspace dirty for the user to Save or discard.

The AI provider key, prompts, provider call, and rate limiting must stay on the
server. The browser must never receive provider credentials or directly write
the generated text to PostgreSQL outside the existing save contract.

## API Contract

`src/openapi.yml` is the REST source of truth for this beta. It covers public
health, Auth.js entry points, authenticated profile operations, document and
block CRUD, upload, trash, versions, and version reverts. Socket.IO is
described by its extension because OpenAPI models HTTP rather than bidirectional
events.
