# Backend and Realtime Workflow

PostgreSQL and REST are the source of truth. Socket.IO only distributes changes
after a database mutation succeeds; it does not save editor drafts or replace
REST reads.

## Main Files

| File | Responsibility |
| --- | --- |
| `app.js` | Creates the HTTP server, attaches Socket.IO, and exposes the event publisher to routers. |
| `server/routers/index.js` | Loads the Auth.js session and product user, then enforces Pro access for product APIs. |
| `server/routers/documents.js` | Document, block, AI, upload, trash, and version endpoints; publishes committed document events. |
| `server/routers/users.js` | Profile and profile-picture endpoints; publishes profile changes. |
| `server/routers/trash.js` | Trash listing, restore, and permanent deletion. |
| `server/models/` | Runs PostgreSQL reads, transactions, revisions, progress calculations, and version creation. |
| `server/realtime/index.js` | Authenticates Socket.IO connections and controls user/document rooms. |
| `server/realtime/publisher.js` | Builds sanitized events and sends them to the correct rooms. |
| `src/services/*Api.js` | Calls REST from the browser. |
| `src/services/realtime.js` | Creates the Socket.IO client and registers event listeners. |
| `src/components/RealtimeProvider.jsx` | Owns the shared client cache, applies events, and refreshes REST data after reconnects. |
| `src/openapi.yml` | REST contract plus the `x-socket-io` realtime event contract. |

## REST API Groups

All paths below are under `/api`. Except for health and Stripe's signed webhook,
requests require the Auth.js session cookie. Core product APIs also require Pro
access.

| Browser service | Main APIs | Backend router |
| --- | --- | --- |
| `usersApi.js` | `GET /users/me`, `POST /users/me/profile-picture` | `users.js` |
| `documentsApi.js` | `GET/POST /documents`, `POST /documents/upload`, `GET/PATCH/DELETE /documents/{id}` | `documents.js` |
| `documentsApi.js` | Block status, analysis, rewrite, acceptance, practice, skip, and complete under `/documents/{id}/blocks/{blockId}` | `documents.js` |
| `versionsApi.js` | Version list/detail and `POST /documents/{id}/revert` | `documents.js` |
| `trashApi.js` | `GET /trash`, `POST /trash/{id}/restore`, `DELETE /trash/{id}` | `trash.js` |

## Mutation Workflow

Every persistent change follows the same path:

```text
React page
  -> browser API service
  -> Express authentication and Pro checks
  -> router
  -> PostgreSQL model transaction
  -> canonical response
  -> Socket.IO event publisher
  -> RealtimeProvider in every connected session
```

1. The browser sends a REST request, optionally with an `X-Mutation-Id`.
2. The router resolves the authenticated product user and scopes the operation
   to that user.
3. The model commits the change, recalculates derived progress, and increments
   the document revision when applicable.
4. The router returns the canonical post-commit resource.
5. The publisher removes private fields and emits an event. Failed or unsaved
   operations never produce an event.
6. `RealtimeProvider` de-duplicates by `eventId` and ignores document revisions
   older than its cached revision.

Typing, undo/redo, and unapplied or unsaved editor work remain local. Other
devices see the document only after a successful REST save or block mutation.
The conflict policy is last committed revision wins, not character-by-character
collaborative editing.

## Socket Connection and Rooms

1. `RealtimeProvider` connects to `/socket.io` with the Auth.js cookie.
2. `server/realtime/index.js` resolves the session, product user, and current
   subscription.
3. Every authenticated socket joins `billing-user:{authUserId}` so subscription
   changes can reach Basic and Pro users.
4. Pro sockets also join `user:{authUserId}` for profile, progress, and document
   events.
5. `document:subscribe` joins `document:{documentId}` only after the server
   verifies Pro access, a UUID-shaped ID, and document ownership.
6. `document:unsubscribe` leaves that room. `sync:request` is only an
   acknowledgement; REST performs the actual resynchronization.

## Realtime Events

| Event | Cause | Client result |
| --- | --- | --- |
| `subscription:updated` | Stripe reconciliation changes entitlement. | Updates billing state; an upgrade refreshes protected data, while a downgrade clears it. |
| `profile:updated` | Profile picture changes. | Replaces the cached public profile. |
| `progress:updated` | A document mutation changes user progress. | Updates cached statistics. |
| `document:created`, `document:updated`, `block:updated`, `document:reverted` | A document transaction commits. | Inserts or replaces the newer document revision. |
| `document:trashed`, `document:restored`, `document:deleted` | Trash state changes. | Moves or removes the cached document. |
| `version:created` | A snapshot is created. | Adds it to the observed document's version list. |

Event payloads contain a unique event ID, event type, timestamp, resource ID,
optional document revision and mutation ID, plus sanitized public data. Upload
bytes, profile-picture bytes, Stripe IDs, authentication data, and secrets are
never published.

## Reconnect Workflow

Socket events can be missed during a disconnect, so reconnecting does not trust
the cache:

1. Fetch `GET /api/stripe/subscription` first.
2. If the user is Pro, refresh profile, active documents, and trash through
   REST.
3. Rejoin open document rooms and refetch their details.
4. Refetch any version lists currently being observed.
5. Continue applying newer realtime events.

This makes REST/PostgreSQL authoritative while Socket.IO provides immediate
cross-device updates.
