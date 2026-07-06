# Alpha Architecture

Last updated: 2026-07-06

This document reflects the current alpha codebase after the Google OAuth merge, the reusable owl animation migration, and the cleanup of disconnected frontend scaffolding.

## Current Product Status

The live SPA currently has two routed entry points:

- `/` -> `RequireSignIn` -> `WorkspacePage`
- `/profile` -> `RequireSignIn` -> `Profile`

Inside `WorkspacePage`, the signed-in experience switches between the homepage shell and the document workspace without changing the route. The previously separate `Dashboard`, `AuthButton`, `desktopWorkspace`, `mobileWorkspace`, and the old chalk test-login branch inside `WorkspacePage` are obsolete and have been removed.

## Stack

| Layer | Technology | Status |
| --- | --- | --- |
| Frontend shell | React + Vite | Active |
| Styling | Tailwind entry styles plus custom CSS | Active |
| Editor | TipTap | Active for local and scaffolded DB documents |
| Owl animation | Inline SVG + CSS + JS animation controller | Active and reusable |
| Auth | Auth.js for Express + Google OAuth 2.0 | Scaffolded; requires PostgreSQL and valid OAuth config |
| Backend API | Express.js | Partially connected |
| Database | PostgreSQL | Auth schema ready; product persistence incomplete |
| Upload parsing | Multer + Mammoth + `initialClustering` | Partially scaffolded |
| Realtime | Socket.io placeholder location | Not started |

## Directory Layout

```text
project-thesis-rewriter/
|-- app.js
|-- compose.yaml
|-- docs/
|   |-- alpha/
|   |   |-- architecture.md
|   |   |-- authentication-architecture.md
|   |   `-- owl-animations.md
|   `-- session transcripts/
|-- scripts/
|-- server/
|   |-- auth.js
|   |-- middlewares/
|   |-- models/
|   |-- realtime/
|   `-- routers/
`-- src/
    |-- assets/
    |-- components/
    |-- pages/
    |-- services/
    `-- styles/
```

## Unresolved Frontend Issues

These are the main client-side issues still implied by the current implementation.

| Issue | Where it lives | Current implication |
| --- | --- | --- |
| Block-status reconciliation is still frontend-only | `src/components/DocumentEditor.jsx`, `src/pages/WorkspacePage.jsx` | Rapid edits, manual empty paragraphs, and fast undo/redo sequences can still create transient ordering or status inconsistencies before the next reconciliation pass. |
| Workspace orchestration is concentrated in one large page component | `src/pages/WorkspacePage.jsx` | The page is functional, but animation state, editor state, mobile panel state, and local fallbacks are tightly coupled, which makes future fixes riskier and harder to isolate. |
| Homepage and workspace still rely on demo/local fallbacks | `src/pages/HomePage.jsx`, `src/pages/homepageTrash.jsx`, `src/pages/homepageVersionControl.jsx` | The UI behaves well offline, but some successful flows do not prove that the backend path is correct because they may be silently using demo data. |
| Account avatar behavior spans local preview plus API state | `src/pages/HomePage.jsx`, `src/pages/homepageAccount.jsx` | The UI can look correct even when backend persistence is unavailable, so avatar persistence bugs may appear only after reload or after switching auth users. |

## Backend / Database Impact On Existing Features

| Feature | Frontend status | Backend impact |
| --- | --- | --- |
| Google sign-in | UI and client flow are implemented | Requires Docker/PostgreSQL, `npm run db:migrate`, valid Google OAuth credentials, and correct callback origin before it works end-to-end. |
| Homepage documents list | Fully rendered with sorting/search UI | Falls back to local demo documents when `/api/documents` fails. |
| Create new document | Button and workspace transition work | If the create API fails, the app opens a local demo document instead of a persisted DB document. |
| Upload document | Upload controls exist in homepage and workspace | Real upload depends on Express upload routes, file parsing, and PostgreSQL-backed persistence; `.docx` remains especially dependent on backend readiness. |
| Save document | Toolbar/workspace save flow works | Real persistence depends on `/api/documents/:id`; otherwise the UI reports local/API fallback states. |
| Trash | Trash page UI works | Real restore/delete-forever requires `/api/trash` data; otherwise the page shows local demo trash items. |
| Version history | Diff/revert UI works | Real versions depend on DB-backed snapshots; demo documents use generated local snapshots only. |
| Account avatar | Upload and preview UI work | Persistent avatar storage is not yet fully synchronized with the Auth.js identity model and backend availability. |
| Progress banner | Presentationally complete | Uses current frontend user stats, not a completed backend progress aggregation pipeline. |

## Unimplemented Or Placeholder Subpages

| Page | File | Status |
| --- | --- | --- |
| Subscription | `src/pages/homepageSubscription.jsx` | Placeholder only |
| Support | `src/pages/homepageSupport.jsx` | Placeholder only |
| Credits | `src/pages/homepageCredits.jsx` | Minimal static content only |
| Rewriting backend results | Workspace side panels | Placeholder generators only; no real AI or service backend |
| Practicing backend results | Workspace side panels | Placeholder generators only; no real AI or service backend |
| Realtime collaboration | `server/realtime/` | Not started |

## Frontend Page Inventory

### Routed pages

| Page | File | Role | Status | Implementation notes |
| --- | --- | --- | --- | --- |
| App router | `src/App.jsx` | Mounts the protected app routes | Active | Uses `Routes` and a thin route graph to keep auth gating centralized. |
| Profile | `src/pages/Profile.jsx` | Minimal signed-in profile view and sign-out action | Active | Wrapped by `RequireSignIn`; consumes `useAuth()` only. |

### Signed-in shell pages

| Page | File | Role | Status | React behavior notes |
| --- | --- | --- | --- | --- |
| Homepage shell | `src/pages/HomePage.jsx` | Signed-in landing surface for docs, trash, versions, account, support, credits, and subscription | Active with local/demo fallbacks | Combines `useState` for UI mode, `useEffect` for API fetching and local-store sync, and `useMemo` for progress and seeded fallback state. |
| Workspace shell | `src/pages/WorkspacePage.jsx` | Signed-in editor/workspace, blackboard owl, rewriting/practicing/analyzing panels, mobile assistant, save flow | Active with scaffolded backend connectivity | This is the most complex page. It combines `useState` for editor/workspace state, `useRef` for animator/editor/timer handles, `useCallback` for action handlers, `useMemo` for derived styles/signatures, and `useEffect` for fetches, timers, event listeners, and synchronization. |
| Account panel | `src/pages/homepageAccount.jsx` | Sliding account overlay and avatar upload entry | Active | Uses `useRef` for file input and Lottie mount node, `useState` for local preview, and `useEffect` to mount/destroy the streak animation. |
| Trash page | `src/pages/homepageTrash.jsx` | Trash browsing, restore, permanent delete | Active with demo fallback | Uses `useEffect` for initial load and toggles between real API and demo mode. |
| Version history | `src/pages/homepageVersionControl.jsx` | Version list, diff viewer, revert flow | Active with demo fallback | Uses `useMemo` for diff generation and `useEffect` to switch between demo snapshots and real API requests. |
| Subscription | `src/pages/homepageSubscription.jsx` | Subscription placeholder | Placeholder | Static `EmptyState`. |
| Support | `src/pages/homepageSupport.jsx` | Support placeholder | Placeholder | Static `EmptyState`. |
| Credits | `src/pages/homepageCredits.jsx` | Credits placeholder | Minimal | Static content with current external assets only. |

## Component Inventory

### Auth and identity

| Component | File | Role | Status |
| --- | --- | --- | --- |
| Auth provider | `src/components/AuthProvider.jsx` | Shared auth context, session loading, sign-in/sign-out actions | Active |
| Sign-in gate | `src/components/RequireSignIn.jsx` | Chalkboard auth screen and Google OAuth launcher | Active |
| Profile avatar | `src/components/ProfileAvatar.jsx` | Shared avatar renderer for profile/auth-aware surfaces | Active |
| Owl logo badge | `src/components/OwlLogoBadge.jsx` | Owl-head brand badge used in homepage identity UI | Active |

### Homepage shell

| Component | File | Role | Status |
| --- | --- | --- | --- |
| Home shell | `src/components/HomeShell.jsx` | Top-level homepage layout, header, sidebar, main content slot | Active |
| Home header | `src/components/HomeHeader.jsx` | Header layout and action placement | Active |
| Header actions | `src/components/HeaderActions.jsx` | New doc, upload, search, and subscription controls | Active |
| Home sidebar | `src/components/HomeSidebar.jsx` | Desktop/mobile docs-version-trash-support-credits navigation | Active |
| Mobile sidebar toggle | `src/components/MobileSidebarToggle.jsx` | Shared round menu/toggle button style | Active |
| Progress banner | `src/components/ProgressBanner.jsx` | Progress card content and layout | Active |
| Progress ring | `src/components/ProgressRing.jsx` | Animated circular progress display | Active |
| Documents section | `src/components/DocumentsSection.jsx` | Document list section wrapper and sorting controls | Active |
| Document card | `src/components/DocumentCard.jsx` | Homepage/trash document tile | Active |
| Document menu | `src/components/DocumentMenu.jsx` | Three-dot menu for per-document actions | Active |
| Sort dropdown | `src/components/SortDropdown.jsx` | Styled selector used on the homepage | Active |
| Empty state | `src/components/EmptyState.jsx` | Generic placeholder page/card surface | Active |
| Confirm modal | `src/components/ConfirmModal.jsx` | Confirmation modal for destructive actions | Active |

### Workspace and editor

| Component | File | Role | Status |
| --- | --- | --- | --- |
| Document editor | `src/components/DocumentEditor.jsx` | TipTap editor host, block metadata normalization, page splitting, toolbar integration | Active |
| Editor toolbar | `src/components/EditorToolbar.jsx` | Rich text controls, selectors, save/back interactions | Active |
| Toolbar button | `src/components/ToolbarButton.jsx` | Shared toolbar icon button primitive | Active |
| A4 editor page | `src/components/A4EditorPage.jsx` | A4 paper canvas shell with page number positioning | Active |
| Academic style panel | `src/components/AcademicStylePanel.jsx` | Template/custom style configuration for workspace | Active |
| Template cards | `src/components/TemplateCards.jsx` | Template selection tiles inside the academic style panel | Active |
| History selector | `src/components/HistorySelector.jsx` | Workspace history list and expand/collapse control | Active |

### Owl animation surface

| Component | File | Role | Status |
| --- | --- | --- | --- |
| Owl container | `src/components/OwlContainer.jsx` | Shared desktop/mobile owl stage, indicators, particle layer, bottom assets | Active |

## Service Inventory

| Service | File | Role | Status |
| --- | --- | --- | --- |
| Auth service | `src/services/auth.js` | Calls Auth.js session, CSRF, sign-in, and sign-out endpoints | Active |
| Request helper | `src/services/request.js` | Shared `/api` JSON request wrapper | Active |
| Documents API | `src/services/documentsApi.js` | List/create/load/save/upload/trash/block-status requests | Active but backend-dependent |
| Trash API | `src/services/trashApi.js` | Trash list/restore/delete-forever requests | Active but backend-dependent |
| Users API | `src/services/usersApi.js` | `getMe` and profile-picture upload requests | Active but backend-dependent |
| Versions API | `src/services/versionsApi.js` | Version list/detail/revert requests | Active but backend-dependent |

## Backend Inventory And Status

| Area | Main files | Status | Notes |
| --- | --- | --- | --- |
| Express app | `app.js` | Active scaffold | Mounts Auth.js, `/api`, middleware, and production static serving. |
| Auth config | `server/auth.js` | Active scaffold | Reads env vars, configures Google provider, and creates the DB adapter. |
| API router | `server/routers/index.js` | Active scaffold | Mounts `users`, `documents`, and `trash`; `/api/me` is protected. |
| Documents routes | `server/routers/documents.js` | Partial | Routes exist, but full DB-backed reliability still depends on environment and data-model completion. |
| Trash routes | `server/routers/trash.js` | Partial | Exists, but frontend still falls back to demo data frequently. |
| Users routes | `server/routers/users.js` | Partial | Exists for profile info and avatar upload. |
| Auth adapter | `server/models/auth-adapter.js` | Active scaffold | Session, user, and account persistence for Auth.js. |
| Product models | `server/models/documents.js`, `blocks.js`, `versions.js`, `users.js` | Partial | Product persistence is present but not yet fully verified end-to-end. |
| Realtime | `server/realtime/` | Not started | Reserved location only. |

## Owl Animation Architecture

The full animation report is in [owl-animations.md](/C:/Users/yyfxh/OneDrive/Desktop/project-thesis-rewriter/docs/alpha/owl-animations.md).

At a high level:

- `OwlContainer.jsx` is the reusable render surface.
- `src/pages/libraries/animations/*` contains the animator/state/path logic.
- `src/styles/animations/*` contains the animation CSS.
- The app uses one 512x512 owl SVG plus a generated path catalog for wing/wand morphs.

## Development Notes

- Vite frontend: usually `http://localhost:5173/`
- Express backend: `http://localhost:3001/`
- Vite proxies `/api`, `/auth`, and `/socket.io` to Express.
- Local auth/database startup still depends on Docker Desktop, PostgreSQL, `.env`, and `npm run db:migrate`.

