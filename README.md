# Thesis Rewrite Lab

![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white)
![Stripe](https://img.shields.io/badge/Stripe-635BFF?logo=stripe&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)

## Background

Thesis Rewrite Lab is a full-stack academic writing workspace for improving a draft one block at a time. Users can import a document, review feedback, compare AI suggestions, and practise their own revisions before saving or exporting their work.

Tools like Grammarly offer broad writing assistance, including rewriting and citation support. This project focuses on a guided academic workflow: **analyze, practise, compare, and revise**. Its goal is to help writers understand their choices and stay in control of each change.

## Tech stack

| Area | Technologies |
| --- | --- |
| Frontend | JavaScript, React, React Router, Vite, Tailwind CSS, TipTap |
| Backend | Node.js, Express, Zod |
| Database | PostgreSQL, node-postgres (`pg`) |
| Real-time updates | Socket.IO |
| AI and academic sources | OpenAI Responses API, Model Context Protocol (MCP) SDK, Crossref API |
| NLP | Python, FastAPI, spaCy, Sentence Transformers, PyTorch, winkNLP |
| Authentication | Auth.js, Google OAuth 2.0 |
| Payments | Stripe Checkout and webhooks |
| Document import and export | Mammoth, docx |
| Deployment and CI/CD | Docker, Docker Compose, NGINX, GitHub Actions |

## Features

- **Document workspace:** import `.txt`, `.md`, and `.docx` files into a TipTap rich-text editor with tracked writing blocks.
- **Writing feedback:** combine local text analysis and a Python NLP service with contextual AI analysis, rewrite suggestions, and practice feedback.
- **Background processing:** PostgreSQL-backed rewrite jobs with row locking, retries, and source checks to avoid applying results to changed text.
- **Live updates:** Socket.IO delivers document and processing events to authenticated clients.
- **Citations:** application-owned MCP tools support academic source lookup and citation workflows using Crossref.
- **Document management:** save work, keep versions, manage deleted documents, and export DOCX files.
- **Accounts and billing:** Google sign-in through Auth.js and subscription flows through Stripe Checkout and webhooks.

## Architecture

The browser provides the editor, the server coordinates processing, and the database stores the work:

1. **Import a draft:** the server extracts the text, divides it into writing blocks, and saves them in the database.
2. **Review a block:** the server uses text analysis, the NLP service, and AI to provide feedback on the selected passage.
3. **Request rewrites:** background workers process queued requests and send progress and results back to the editor through the server.
4. **Apply and save:** the writer chooses changes, saves document versions, and exports the revised draft.

## Local setup

### Prerequisites

- Node.js **22.13 or newer** and npm.
- Docker with Docker Compose for PostgreSQL and the NLP service.
- Google OAuth credentials for a **Web application**.
- An OpenAI API key for AI features; Stripe test credentials to exercise billing.

### 1. Install dependencies

```sh
git clone https://github.com/6Beaming/Thesis-Rewrite-Lab.git
cd Thesis-Rewrite-Lab
npm ci
```

### 2. Configure the environment

Copy [`.env.example`](.env.example) to `.env`

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | Browser origin; defaults to `http://localhost:5173`. |
| `DATABASE_URL` | PostgreSQL connection; the example matches local Compose. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Required to start the application and sign in. |
| `AUTH_SECRET` | Session secret; required in production. Development generates a local secret when omitted. |
| `OPENAI_API_KEY` | Enables OpenAI-backed features. Keep it server-side. |
| `NLP_SERVICE_URL` | Local NLP endpoint: `http://127.0.0.1:8081`. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRODUCT_ID`, `STRIPE_PRICE_ID` | Configure Stripe billing. |

In your Google OAuth application, register:

- JavaScript origin: `http://localhost:5173`
- Redirect URI: `http://localhost:5173/auth/callback/google`

The example environment also documents model settings, NLP feature flags, timeouts, and production options. Keep credentials out of Git and client-side `VITE_` variables.

### 3. Start services and apply migrations

```sh
npm run db:up
npm run nlp:up
npm run db:migrate
```

Wait for PostgreSQL to be ready before running migrations. The first NLP image build downloads Python dependencies and model files and may take several minutes. Use `docker compose ps` to check service health and `npm run nlp:logs` to inspect NLP startup.

### 4. Run the application

```sh
npm run dev
```

Open [localhost:5173](http://localhost:5173). Vite proxies API, authentication, and Socket.IO requests to Express on port **3001**. PostgreSQL listens on **5432**, and the NLP service is exposed locally on **8081**.

Sign in with Google, import a document, select a writing block, and review feedback or request rewrite suggestions. AI and billing workflows require their corresponding provider configuration.

## Repository layout

```text
app.js                 Express entry point and worker startup
src/                   React pages, editor, services, and shared utilities
server/ai/             AI workflows and rewrite worker
server/mcp/            Academic-source tools
server/models/         PostgreSQL access and migrations
server/nlp/            NLP client, partitioning, and background jobs
server/nlp_service/    Python FastAPI service
server/realtime/       Socket.IO authentication and event delivery
server/routers/        HTTP API routes
scripts/               Database and development utilities
deployment/            Production scripts and NGINX configuration
docs/                  Architecture and feature documentation
```

## Further reading

- [Authentication architecture](docs/alpha/authentication-architecture.md)
- [Backend and real-time behavior](docs/beta/backend-and-realtime.md)
- [File upload](docs/beta/file-upload.md) and [block partitioning](docs/beta/block-partitioning.md)
- [AI and MCP integration](docs/beta/ai-integration.md)
- [NLP, AI, and citation workflows](docs/final/NLP-AI-MCP-cool-factors-upgrades.md)
- [Stripe integration](docs/beta/stripe.md)
- [Document export](docs/final/export.md)
- [Production deployment runbook](deployment/README.md)

Production uses containerized application, NLP, and PostgreSQL services behind NGINX. Review the runbook and adapt its existing hostnames, image references, and provider endpoints before deploying to another environment. Documentation under `docs/alpha`, `docs/beta`, and `docs/final` also includes historical implementation plans.
