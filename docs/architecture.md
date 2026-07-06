# Project Architecture

Last updated: 2026-07-06

This document describes the current structure and implementation status of the Thesis Rewriting Platform after the alpha frontend work and the Google OAuth authentication merge.

## Technology Stack

| Layer | Technology | Current status |
| :--- | :--- | :--- |
| Frontend | React, Vite, Tailwind entry CSS plus custom CSS | Active prototype; primary work surface |
| Editor | TipTap | Local editing, inline formatting, block statuses, undo/redo paths are active |
| Animation | Inline SVG owl, CSS, JS animation controllers | Active reusable animation library |
| Authentication | Auth.js for Express, Google OAuth 2.0 | Backend scaffold merged; requires env vars, PostgreSQL, and OAuth setup to run end-to-end |
| Backend | Node.js, Express.js | Partially scaffolded; auth routes and product API routes coexist |
| Database | PostgreSQL | Auth schema scaffolded; document/product persistence remains incomplete |
| Upload parsing | Multer, Mammoth, `initialClustering` | Scaffolded; UI still has local fallbacks while backend/database setup is unfinished |
| Real-time | Socket.io | Planned; not started for product behavior |

## Directory Layout

```text
project-thesis-rewriter/
|-- app.js                  # Express entry point, API mount, Auth.js mount
|-- compose.yaml            # Local PostgreSQL service for auth/database work
|-- index.html              # Vite HTML shell
|-- vite.config.js          # Vite configuration and dev proxy
|-- package.json            # npm scripts and dependencies
|-- README.md               # Project proposal / course summary
|-- docs/                   # Project documentation
|   |-- architecture.md
|   |-- owl-animations.md
|   `-- alpha/
|       `-- authentication-architecture.md
|-- local/                  # Gitignored private workspace and animation reference pages
|-- prototype/              # Read-only reference mockups
|-- scripts/                # Data processing and local utility scripts
|-- server/                 # Express backend
|   |-- auth.js             # Auth.js configuration
|   |-- models/             # Database/data-access layer
|   |-- routers/            # API route handlers
|   |-- middlewares/        # Express middleware
|   `-- realtime/           # WebSocket/Socket.io handlers, planned
`-- src/                    # React frontend
    |-- assets/             # Static images and SVG assets
    |-- components/         # Reusable React components
    |-- pages/              # Page-level views and page-local libraries
    |-- services/           # Frontend API clients
    `-- styles/             # Global, page, editor, and animation CSS
```

## Frontend Pages

| Area | Main files | Status |
| :--- | :--- | :--- |
| Authentication gate | `src/components/RequireSignIn.jsx`, `src/components/AuthProvider.jsx` | Uses the chalkboard/owl UI and manually starts Google OAuth from the chalk button. No password login/signup is used after the auth merge. |
| Homepage | `src/pages/HomePage.jsx`, `src/components/Home*`, document/card components | Functional local/demo UI. Sorting, menus, trash/version pages, account panel, progress UI, responsive sidebar are implemented as frontend behavior. Account UI prefers the Auth.js session user when available. |
| Workspace editor | `src/pages/WorkspacePage.jsx`, `src/components/DocumentEditor.jsx`, `src/components/EditorToolbar.jsx` | Functional local TipTap editor. Supports title editing, save flow, rich text toolbar, block statuses, rewriting/practicing panels, local placeholder responses, undo/redo, and unsaved-back prompt. |
| Owl assistant | `src/components/OwlContainer.jsx`, `src/pages/libraries/animations/*`, `src/styles/animations/*` | Reusable desktop/mobile owl component and animation controller are active. |
| Subscription page | `src/pages/homepageSubscription.jsx` | Placeholder/disabled content. Requires real subscription/product logic later. |
| Support/Credits pages | `src/pages/homepageSupport.jsx`, `src/pages/homepageCredits.jsx` | Static or placeholder content. Credits should be expanded when external services/libraries become finalized. |

## Authentication Flow

The merged auth flow follows `docs/alpha/authentication-architecture.md`:

```text
RequireSignIn button -> AuthProvider.signIn() -> /auth/csrf -> /auth/signin/google -> Google OAuth -> /auth/callback/google -> database session -> homepage
```

Important current rules:

- Google OAuth is the only real sign-in mechanism.
- The old frontend-only `test@example.com` password form is no longer the route gate.
- `RequireSignIn` does not auto-redirect on first render; the chalkboard button starts OAuth.
- Auth.js is mounted under `/auth/*`.
- `GET /api/me` is protected by `loadAuthSession` and `requireAuth`.
- Full auth requires `.env` values for `APP_ORIGIN`, `DATABASE_URL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `AUTH_SECRET`.

## Frontend Data Flow

### Current Working Path

The UI can operate with local demo data and frontend placeholder behavior:

```text
User action -> React page state -> local/demo document model -> TipTap JSON -> UI refresh
```

Examples:

- Rewriting cards produce placeholder responses after a 5s delay.
- Rewriting card click applies placeholder text directly through the TipTap transaction history.
- Practicing uses local placeholder text, not an API.
- Homepage document cards can show local/demo documents.
- Trash/version pages currently use local/demo data when backend data is unavailable.

### Intended Backend Path

The intended production path is:

```text
React UI -> src/services/* API client -> Express routes -> server/models/* -> PostgreSQL
```

Some route/model/service files exist, but document workflows should still be treated as not fully backend-connected.

## Backend Status Matrix

| Backend area | Status | Notes |
| :--- | :--- | :--- |
| Express app entry | May be fine but not fully verified | `app.js` now includes Helmet, CORS, Auth.js routing, `/api` routing, production static serving, and graceful auth DB close. |
| Auth.js / Google OAuth | Partially connected | Auth branch scaffold is merged. It should work after local PostgreSQL, migrations, and Google OAuth env vars are configured. |
| Auth database adapter | Partially connected | `server/models/auth-adapter.js` and `server/models/migrations/001_auth.sql` exist for Auth.js sessions/users/accounts. |
| API router mounting | Partially scaffolded | `server/routers/` modules are mounted; frontend behavior still falls back to local/demo data. |
| Documents API | Partially scaffolded, not fully connected | Frontend has `src/services/documentsApi.js`; upload, document persistence, versions, and block updates are not reliably backed by PostgreSQL yet. |
| Trash API | Partially scaffolded, not fully connected | Trash UI can show local demo items. PostgreSQL-backed trash behavior is not finished. |
| Version history API | Partially scaffolded, not fully connected | Version history currently works for dummy/demo content only. Real diff/revert persistence needs backend/database work. |
| Users/profile API | Partially scaffolded | Account panel can use Google session data. Persistent profile/avatar upload is still separate from Auth.js user identity. |
| Upload middleware/parsing | Partially scaffolded, not working end-to-end | Multer/mammoth/docx-oriented setup exists, but UI upload depends on backend/database readiness. |
| Subscription/payment backend | Not started | Subscription page is placeholder. |
| Rewriting/practicing AI backend | Not started | Rewriting and practice responses are placeholder functions only. |
| Real-time collaboration | Not started | `server/realtime/` is reserved. |

## Frontend Features Blocked By Backend

| Feature | Current behavior | Blocker |
| :--- | :--- | :--- |
| Google sign-in | UI and Auth.js client flow exist | Requires local PostgreSQL, migrations, valid OAuth credentials, and callback URL setup. |
| File upload from homepage/workspace | UI exists and has local `.txt`/`.md` fallbacks | Backend upload endpoint, file parsing, DB persistence, and error handling need database verification. |
| Real document persistence | Local/demo data and save flow exist | PostgreSQL-backed save/load/version records are incomplete. |
| Version history with real diffs/revert | Dummy/demo data only | Version model/routes and DB integration need completion. |
| Trash restore/delete forever | Local/demo behavior only | Trash records and permanent delete APIs need completion. |
| Account avatar persistence | UI exists | User profile/avatar storage is not synchronized with Auth.js users yet. |
| Subscription page | Placeholder/disabled page | Product/payment/backend entitlement logic not started. |
| Real rewriting/practicing generation | Placeholder responses only | AI/service backend not started. |
| Progress percentage | Static/local calculation | Real progress aggregation from document/block records is incomplete. |

## Editor And Block Model

The current editor stores document content as TipTap JSON. Paragraph nodes receive block metadata:

| Attribute | Meaning |
| :--- | :--- |
| `blockId` | Stable local/demo identifier for a paragraph block |
| `status` | `processing`, `unprocessed`, `processed`, or `skipped` |
| `length` | Character length used for demo progress calculations |
| `lineHeight`, `textIndent`, `fontFamily`, `fontSize`, `textAlign` | Formatting metadata |

Important current rules:

- Empty paragraphs can exist for editing, but they are not valid processing candidates.
- Processing order is top-to-bottom by line number: the first non-empty unprocessed block becomes processing.
- Editing a processed/skipped paragraph marks it unprocessed again.
- Placeholder apply/disable changes go through TipTap transactions, so undo/redo can include them.
- The workspace keeps local/demo document state synchronized from editor JSON until real persistence is connected.

## Owl And Animation Architecture

See `docs/owl-animations.md` for details. Summary:

- `OwlContainer.jsx` is the reusable component for auth, workspace desktop, and mobile/floating contexts.
- The owl SVG uses one fixed 512x512 viewBox and scales through the container.
- Standby/head/eye/feet behavior is transform/CSS driven.
- Wing/wand show and thinking use generated SVG path catalogs for accurate morphs.
- Auth and workspace both bind hover/click interactions to the same animator facade.

## Development Commands

```bash
npm run db:up        # Start local PostgreSQL
npm run db:migrate   # Apply auth schema
npm run dev          # Express + Vite
npm run dev:client   # Vite only
npm run dev:server   # Express only
npm run build        # Production frontend build
npm start            # Production server
```

Vite usually serves the frontend on `http://localhost:5173/`, or the next open port if 5173 is busy. Vite proxies `/api`, `/auth`, and `/socket.io` to the Express server.

## File Placement Rules

- Reusable UI: `src/components/`
- Page orchestration: `src/pages/`
- Frontend API clients: `src/services/`
- Animation JS libraries: `src/pages/libraries/animations/`
- Animation CSS: `src/styles/animations/`
- Backend routes: `server/routers/`
- Backend database logic: `server/models/`
- Scripts/utilities: `scripts/`
- Documentation: `docs/`
- Do not modify `prototype/`.
- Do not rely on `local/` for committed product behavior.
