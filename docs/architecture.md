# Project Architecture

This document describes the directory layout, technology stack, and conventions for the **Thesis Rewriting Platform**.

## Technology Stack

| Layer | Technology |
| :--- | :--- |
| Frontend | React (Vite), Tailwind CSS |
| Backend | Node.js, Express.js |
| Real-time | Socket.io (planned; wiring lives under `server/realtime/`) |
| Entry point | `app.js` at the repository root |

## Directory Layout

```
project-thesis-rewriter/
├── app.js                  # Application entry — starts the Express server
├── index.html              # Vite HTML shell for the React frontend
├── vite.config.js          # Vite + React + Tailwind build/dev configuration
├── package.json            # Dependencies and npm scripts
├── README.md               # Project proposal and course handout summary
├── AGENTS.md               # Local agent rules (gitignored; not committed)
├── .gitignore
│
├── docs/                   # All documentation (human-readable)
│   ├── architecture.md     # This file
│   ├── owl-animations.md   # Owl animation behavior spec (historical sandbox notes)
│   └── …                   # Organized in sub-directories as needed
│
├── local/                  # Personal dev workspace (gitignored)
│   └── …                   # Experiments, scratch code, local test pages
│
├── prototype/              # AI-generated reference mockups — do not modify
│   └── …
│
├── scripts/                # Data-processing and utility scripts (reserved)
│   └── .gitkeep
│
├── server/                 # Backend
│   ├── models/             # Database models and data access
│   ├── routers/            # HTTP route handlers
│   ├── middlewares/        # Express middleware (auth, parsing, validation, …)
│   └── realtime/           # WebSocket / Socket.io handlers
│
└── src/                    # Frontend business logic and UI
    ├── components/         # Reusable UI components
    ├── pages/              # Page-level views, workspace layouts, libraries
    ├── styles/             # Global CSS, layout, and animation styles
    ├── services/           # API client modules (frontend ↔ backend)
    ├── assets/             # Static UI resources (SVG, PNG, …)
    ├── App.jsx             # Root React component
    └── main.jsx            # React bootstrap
```

## Directory Responsibilities

### `docs/`

All project documentation in any human-readable format. Use sub-directories to group related material (e.g. `docs/AI-chat-histroies/` for chat transcripts).

### `local/`

Private development area, excluded from Git. Use for experiments, scratch code, local test runs, and personal notes. Nothing here is shared with the team via the repository.

### `prototype/`

Reference mockups produced by AI (e.g. HTML/CSS prototypes). **Read-only for agents and developers** — use as design reference only; do not edit these files.

### `scripts/`

Reserved for standalone data-processing and utility scripts (imports, migrations, batch jobs). Not part of the running application. Owl layout and path tooling previously lived here; layout constants are now committed under `src/pages/libraries/animations/`.

### `server/`

Express backend code only.

| Sub-directory | Purpose |
| :--- | :--- |
| `models/` | Database schemas, ORM models, query helpers |
| `routers/` | REST (or similar) route definitions and controllers |
| `middlewares/` | Cross-cutting server concerns (CORS extensions, auth, error handling, …) |
| `realtime/` | Socket.io namespaces, event handlers, pub/sub integration |

### `src/`

React frontend application.

| Sub-directory | Purpose |
| :--- | :--- |
| `components/` | Reusable UI building blocks shared across pages |
| `pages/` | Top-level routes, workspace screens, and page-local libraries |
| `styles/` | Global CSS, responsive rules, workspace/owl layout, animation styles |
| `services/` | HTTP/WebSocket client wrappers that call `server/` APIs |
| `assets/` | Project-owned images, icons, and other static design assets |

## Frontend: Workspace & Owl UI

The main UI is a single responsive **workspace** that switches between desktop and mobile layouts at **576px** (`src/styles/media.css`, desktop-first).

### Pages (`src/pages/`)

| File | Role |
| :--- | :--- |
| `WorkspacePage.jsx` | Renders both desktop and mobile workspaces; CSS toggles visibility |
| `desktopWorkspace.jsx` | Pale-green workspace + right-side blackboard + fixed owl container |
| `mobileWorkspace.jsx` | Floating owl shortcut window (long-press drag, left snap) |
| `libraries/useFloatingWindow.js` | Pointer/drag logic and snap positioning for mobile window |
| `libraries/animations/` | Owl animation runtime (see below) |

### Components (`src/components/`)

| File | Role |
| :--- | :--- |
| `OwlContainer.jsx` | Three-layer owl stack: indicators, animated owl stage, bottom asset (books/twig) |

### Page libraries — animations (`src/pages/libraries/animations/`)

React modules ported from the `local/animations/` sandbox. **No CSS in this folder** — styles live under `src/styles/animations/`.

| File | Role |
| :--- | :--- |
| `owl-container-layout.json` | Desktop/mobile layer proportions, blackboard caps, floating-window constants |
| `containerLayout.js` | Reads layout JSON; exposes CSS vars and mobile/blackboard metrics |
| `animationState.jsx` | Shared state, timers, DOM cache helpers |
| `eyes.jsx` | Blink, observe, eye transforms |
| `head.jsx` | Head shake, rotate, marking-time, stabilized |
| `particles.jsx` | Sleep-note smoke |
| `standby.jsx` | Standby variant orchestration |
| `createOwlAnimator.jsx` | Composes modules into a mountable animator |
| `useOwlAnimator.jsx` | React hook: start standby on mount, dispose on unmount |

### Styles (`src/styles/`)

| File | Role |
| :--- | :--- |
| `index.css` | Tailwind entry; imports `main.css` and `media.css` |
| `main.css` | Global tokens (pale-green background), base resets |
| `media.css` | **Required.** Desktop-first breakpoint at `max-width: 576px`; hides blackboard on mobile |
| `workspace.css` | Workspace shell, blackboard sizing (`100dvh`, cap `33dvw`), floating window |
| `owl-container.css` | Overlapped owl container layers, indicator/owl/books positioning |
| `animations/base.css` | Animation stage scaffolding (minimal) |
| `animations/eyes.css` | Eye close / blink styling |
| `animations/head.css` | Head shake, stabilized, note smoke keyframes |
| `animations/feet.css` | Marking-time foot/body waddle |

### Assets (`src/assets/`)

Owl-related assets include `owl.svg`, `books.svg`, `twig.svg`, indicator SVGs (`thinking`, `answer`, `error`), `blackboard.png`, and wing/wand test SVGs for future magic-wand work.

### Layout behavior (summary)

**Desktop (>576px)**

- Blackboard: fixed right, height `100dvh`, width `min(33dvw, natural aspect from PNG)`.
- Owl container: bottom-center of blackboard, width **50%** of blackboard; layers overlap per `owl-container-layout.json`.
- Standby animations run on the owl stage via `useOwlAnimator`.

**Mobile (≤576px)**

- No blackboard.
- Floating window: visible width `min(128px, 33.33dvw)`; **25%** of container width overflows left when snapped.
- No minimum top margin; user can drag vertically, then snaps left on release.

## Runtime Model

### Development

```bash
npm run dev
```

Runs two processes in parallel:

1. **Express** (`app.js`) on port **3001** — API at `/api/*`
2. **Vite** dev server on port **5173** — React UI with hot reload

Open **http://localhost:5173/** for the workspace UI. Vite proxies `/api` and `/socket.io` to Express.

### Production

```bash
npm run build   # Vite builds frontend into dist/
npm start       # NODE_ENV=production — Express serves dist/ + API
```

Open **http://localhost:3001/** (or `PORT` if set).

## API Conventions (initial)

- REST routes are mounted under `/api` (see `server/routers/`).
- Health check: `GET /api/health` → `{ "status": "ok" }`.

## Adding New Files

Before creating any new file, determine its target directory using the table above. If no existing directory fits, **do not invent a new top-level folder** — agree on the path with the team first. See `AGENTS.md` for agent-specific placement rules.

**Placement reminders:**

- Reusable UI → `src/components/`
- Page orchestration and page-local libraries → `src/pages/` (animations under `src/pages/libraries/animations/`)
- Page/workspace look-and-feel → `src/styles/` directly; animation CSS → `src/styles/animations/`
- Do not add `.css` inside `src/pages/libraries/`
