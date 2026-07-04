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
│   └── …                   # Organized in sub-directories as needed
│       └── AI-chat-histroies/
│
├── local/                  # Personal dev workspace (gitignored)
│   └── …                   # Tentative code, tests, local reports, plans
│
├── prototype/              # AI-generated reference mockups — do not modify
│   └── …
│
├── scripts/                # Data-processing and utility scripts
│   └── …                   # (none yet)
│
├── server/                 # Backend
│   ├── models/             # Database models and data access
│   ├── routers/            # HTTP route handlers
│   ├── middlewares/        # Express middleware (auth, parsing, validation, …)
│   └── realtime/           # WebSocket / Socket.io handlers
│
└── src/                    # Frontend business logic and UI
    ├── components/         # Reusable UI components (may include sub-folders)
    ├── pages/              # Page-level views and business logic
    ├── styles/             # CSS and layout styles (Tailwind entry: index.css)
    ├── services/           # API client modules (frontend ↔ backend)
    ├── assets/             # Static UI resources (images, icons, fonts, …)
    ├── App.jsx             # Root React component
    └── main.jsx            # React bootstrap
```

## Directory Responsibilities

### `docs/`

All project documentation in any human-readable format. Use sub-directories to group related material (e.g. `docs/AI-chat-histroies/` for chat transcripts).

### `local/`

Private development area, excluded from Git. Use for experiments, scratch code, local test runs, and personal notes on code or plans. Nothing here is shared with the team via the repository.

### `prototype/`

Reference mockups produced by AI (e.g. HTML/CSS prototypes). **Read-only for agents and developers** — use as design reference only; do not edit these files.

### `scripts/`

Standalone scripts that process or transform data (imports, migrations, batch jobs, etc.). Not part of the running application.

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
| `components/` | Reusable UI building blocks; may nest by feature or library (e.g. Tailwind primitives) |
| `pages/` | Top-level routes / screens and their orchestration logic |
| `styles/` | Global and shared CSS; Tailwind is imported via `styles/index.css` |
| `services/` | HTTP/WebSocket client wrappers that call `server/` APIs |
| `assets/` | Project-owned images, icons, and other static design assets |

## Runtime Model

### Development

```bash
npm run dev
```

Runs two processes in parallel:

1. **Express** (`app.js`) on port **3001** — API at `/api/*`
2. **Vite** dev server on port **5173** — React UI with hot reload

Vite proxies `/api` and `/socket.io` to the Express server.

### Production

```bash
npm run build   # Vite builds frontend into dist/
npm start       # NODE_ENV=production — Express serves dist/ + API
```

## API Conventions (initial)

- REST routes are mounted under `/api` (see `server/routers/`).
- Health check: `GET /api/health` → `{ "status": "ok" }`.

## Adding New Files

Before creating any new file, determine its target directory using the table above. If no existing directory fits, **do not invent a new top-level folder** — agree on the path with the team first. See `AGENTS.md` for agent-specific placement rules.
