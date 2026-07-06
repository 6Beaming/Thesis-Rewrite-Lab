# Project Architecture

Last updated: 2026-07-06

This document describes the current structure and implementation status of the Thesis Rewriting Platform. It reflects the latest frontend-first prototype work: authentication, homepage, workspace editor, reusable owl components, and local demo document flows are now mostly functional, while database-backed backend integration is still incomplete.

## Technology Stack

| Layer | Technology | Current status |
| :--- | :--- | :--- |
| Frontend | React, Vite, Tailwind entry CSS plus custom CSS | Active prototype; primary work surface |
| Editor | TipTap | Local editing, inline formatting, block statuses, undo/redo paths are active |
| Animation | Inline SVG owl, CSS, JS animation controllers | Active reusable animation library |
| Backend | Node.js, Express.js | Partially scaffolded; not fully connected |
| Database | PostgreSQL | Planned/scaffolded; local app still relies heavily on demo/local data |
| Upload parsing | Multer, Mammoth/docx-oriented scripts | Planned/scaffolded; not yet reliable from UI |
| Real-time | Socket.io | Planned; not started for product behavior |

## Directory Layout

```text
project-thesis-rewriter/
|-- app.js                  # Express entry point
|-- index.html              # Vite HTML shell
|-- vite.config.js          # Vite configuration and dev proxy
|-- package.json            # npm scripts and dependencies
|-- README.md               # Project proposal / course summary
|-- docs/                   # Project documentation
|   |-- architecture.md     # This file
|   `-- owl-animations.md   # Owl animation architecture and behavior
|-- local/                  # Gitignored private workspace and animation reference pages
|-- prototype/              # Read-only reference mockups
|-- scripts/                # Data processing and local utility scripts
|-- server/                 # Express backend
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
| Auth page | `src/pages/WorkspacePage.jsx`, `src/styles/auth.css`/workspace styles | Functional frontend-only login test. `test@example.com` / `123456` navigates to homepage after a fake 5s delay. |
| Homepage | `src/pages/HomePage.jsx`, `src/components/Home*`, document/card components | Functional local/demo UI. Sorting, menus, trash/version pages, account panel, progress UI, responsive sidebar are implemented as frontend behavior. |
| Workspace editor | `src/pages/WorkspacePage.jsx`, `src/components/DocumentEditor.jsx`, `src/components/EditorToolbar.jsx` | Functional local TipTap editor. Supports title editing, save flow, rich text toolbar, block statuses, rewriting/practicing panels, local placeholder responses, undo/redo, and unsaved-back prompt. |
| Owl assistant | `src/components/OwlContainer.jsx`, `src/pages/libraries/animations/*`, `src/styles/animations/*` | Reusable desktop/mobile owl component and animation controller are active. |
| Subscription page | `src/pages/homepageSubscription.jsx` | Placeholder/disabled content. Requires real subscription/product logic later. |
| Support/Credits pages | `src/pages/homepageSupport.jsx`, `src/pages/homepageCredits.jsx` | Static or placeholder content. Credits should be expanded when external services/libraries become finalized. |

## Component Placement

Reusable UI components live in `src/components/`. Page orchestration remains in `src/pages/`.

Important current components:

| Component | Role |
| :--- | :--- |
| `OwlContainer.jsx` | Reusable owl stage, indicators, particles, bottom asset layer |
| `DocumentEditor.jsx` | TipTap editor surface, block metadata, status transitions, editor commands |
| `EditorToolbar.jsx` | Formatting, save, block status, undo/redo controls |
| `ProgressBanner.jsx` / `ProgressRing.jsx` | Homepage progress card |
| `DocumentCard.jsx`, `DocumentMenu.jsx`, `DocumentsSection.jsx` | Homepage document list and card actions |
| `HomeHeader.jsx`, `HomeSidebar.jsx`, `MobileSidebarToggle.jsx` | Responsive homepage shell |
| `AcademicStylePanel.jsx`, `HistorySelector.jsx` | Workspace side controls |

## Frontend Data Flow

### Current Working Path

The UI can operate with local demo data and frontend placeholder behavior:

```text
User action -> React page state -> local/demo document model -> TipTap JSON -> UI refresh
```

Examples:

- Auth login uses a hardcoded frontend test account.
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

Some route/model/service files exist, but the UI should still be treated as not fully backend-connected.

## Backend Status Matrix

| Backend area | Status | Notes |
| :--- | :--- | :--- |
| Express app entry | May be fine but not fully verified | `app.js` exists and dev server scripts are present. Full route behavior has not been treated as production-ready. |
| API router mounting | Partially scaffolded | `server/routers/` contains route modules, but frontend behavior still falls back to local/demo data. |
| Documents API | Partially scaffolded, not fully connected | Frontend has `src/services/documentsApi.js`; upload, document persistence, versions, and block updates are not reliably backed by PostgreSQL yet. |
| Trash API | Partially scaffolded, not fully connected | Trash UI can show local demo items. PostgreSQL-backed trash behavior is not finished. |
| Version history API | Partially scaffolded, not fully connected | Version history currently works for dummy/demo content only. Real diff/revert persistence needs backend/database work. |
| Users/profile API | Partially scaffolded | Account panel/avatar behavior is frontend-oriented; persistent profile/avatar upload is not complete. |
| PostgreSQL models | Partially scaffolded | `server/models/` contains database-related files, but the app is not yet operating as a fully database-backed product. |
| Upload middleware/parsing | Partially scaffolded, not working end-to-end | Multer/mammoth/docx-oriented setup exists, but UI upload is not currently reliable. |
| Authentication/session backend | Not started for real use | Auth page uses a frontend-only test account. No real users, sessions, password reset, or signup flow is complete. |
| Subscription/payment backend | Not started | Subscription page is placeholder. |
| Rewriting/practicing AI backend | Not started | Rewriting and practice responses are placeholder functions only. |
| Real-time collaboration | Not started | `server/realtime/` is reserved. |

## Frontend Features Blocked By Backend

| Feature | Current behavior | Blocker |
| :--- | :--- | :--- |
| File upload from homepage/workspace | UI exists but upload cannot be relied on | Backend upload endpoint, file parsing, DB persistence, and error handling are incomplete. |
| Real document persistence | Local/demo data and save flow exist | PostgreSQL-backed save/load/version records are incomplete. |
| Version history with real diffs/revert | Dummy/demo data only | Version model/routes and DB integration need completion. |
| Trash restore/delete forever | Local/demo behavior only | Trash records and permanent delete APIs need completion. |
| Account avatar persistence | UI exists | User profile/avatar upload API and storage are incomplete. |
| Subscription page | Placeholder/disabled page | Product/payment/backend entitlement logic not started. |
| Real login/signup/reset | Frontend test account only | Auth backend not started. |
| Rewriting/practicing generation | Placeholder responses only | AI/service backend not started. |
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
npm run dev          # Express + Vite
npm run dev:client   # Vite only
npm run dev:server   # Express only
npm run build        # Production frontend build
npm start            # Production server
```

Vite usually serves the frontend on `http://localhost:5173/`, or the next open port if 5173 is busy.

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
