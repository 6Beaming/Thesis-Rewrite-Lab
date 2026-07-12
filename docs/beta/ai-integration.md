# AI Integration

Last updated: 2026-07-11

This is the living technical document for AI integration in the Thesis Rewriter.
Update it whenever an AI workflow, prompt, endpoint, database table, model, or
AI-facing UI behavior changes.

## Current Status

The AI foundation is partially implemented, but the application does not call
the OpenAI API yet.

| Area | Status | Current behavior |
| --- | --- | --- |
| OpenAI configuration | Ready | Server-only environment variable placeholders and model defaults exist. |
| OpenAI Node SDK | Installed | The `openai` package is installed but is not imported by application code yet. |
| Structured-response validation | Installed | `zod` is installed but AI schemas have not been created yet. |
| Deterministic document blocks | Implemented | Uploads are separated into sentence-aware, character-balanced blocks. |
| Analyzing panel | UI placeholder | Statistics are derived locally in `WorkspacePage`; no model is called. |
| Three rewriting options | UI placeholder | Cards simulate responses and errors with timers. |
| Practice feedback | UI placeholder | Feedback is generated locally after a simulated delay. |
| Semantic clustering | Not implemented | The embedding model is configured but is not called. |
| AI result persistence | Not implemented | There are no analysis, rewrite-option, or practice-attempt tables yet. |
| Realtime AI progress | Not implemented | Socket.io is installed, but AI processing events are not connected. |

Do not describe analysis, rewriting, practice feedback, embeddings, or realtime
AI processing as complete until their rows above have been updated.

## Intended User Workflow

The application processes one selected document block at a time:

```text
Upload document
    -> extract text and formatting
    -> create sentence-aware, character-balanced blocks
    -> select the current processing block
    -> analyze the block
    -> generate three tone-based rewrites
    -> let the user write and submit a practice rewrite
    -> return teaching feedback
    -> apply or reject a suggestion
    -> save the edited document and advance to the next block
```

The model should receive only the selected block and the minimum neighboring
context required to understand it. It must not regenerate the full paper.

## Architecture

### Current flow

```text
React workspace
    -> local placeholder analysis/rewrite/practice behavior
    -> TipTap replacement and block-status change
    -> Express document API
    -> PostgreSQL document, block, progress, and version records
```

### Target AI flow

```text
React workspace
    -> authenticated AI API request
    -> Express validates user, document, block, and request
    -> server loads the authoritative block text from PostgreSQL
    -> deterministic metrics are calculated locally
    -> server calls the OpenAI Responses API
    -> structured response is validated
    -> result and request metadata are persisted
    -> React renders the result
    -> accepted text enters the existing TipTap save/status workflow
```

OpenAI requests must be made only by Express. React must never receive the API
key or call OpenAI directly.

## Model Configuration

The current defaults in `.env.example` are:

```env
OPENAI_API_KEY=
OPENAI_REWRITE_MODEL=gpt-5.4-mini
OPENAI_ANALYSIS_MODEL=gpt-5.4-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

- `OPENAI_API_KEY` authenticates server-side API requests.
- `OPENAI_REWRITE_MODEL` will generate the three rewrite choices and their explanations.
- `OPENAI_ANALYSIS_MODEL` will analyze a block and evaluate practice attempts.
- `OPENAI_EMBEDDING_MODEL` is reserved for optional semantic boundary detection.

Real secrets belong in the untracked `.env` file during local development and
in deployment secrets in production. Never add a `VITE_` prefix to the API key,
because Vite exposes those variables to browser code.

Model names must be read from environment variables rather than repeated across
services. Pin model snapshots before a graded demonstration if consistent output
is required.

## Deterministic Preprocessing

AI starts after deterministic preprocessing. The `clustering` helper currently:

- uses sentence boundaries instead of `split('.')`;
- recognizes periods, question marks, and exclamation marks;
- avoids splitting common abbreviations and decimal numbers;
- targets 800 characters per block;
- uses a 450-character minimum and 1,200-character maximum;
- keeps a sentence intact when one sentence exceeds the maximum;
- treats every newline in `.txt` as a paragraph boundary;
- follows Markdown rules in `.md`, where a blank line separates paragraphs and
  a single newline remains inside the same paragraph;
- ignores repeated newlines instead of creating empty blocks;
- preserves `.docx` paragraph and heading boundaries while keeping soft line
  breaks inside their containing paragraph; and
- allows `.docx` text marks to be divided at the same calculated boundaries.

These blocks already have stable UUIDs, character lengths, and processing
statuses in PostgreSQL. AI endpoints should identify a block by its UUID and
load its text from the database. They should not trust block text submitted by
the browser.

Semantic clustering, if added, should operate after safe sentence segmentation.
It should compare adjacent units and preserve document order rather than globally
reordering sentences by similarity.

## Planned AI Workflows

### Block analysis

Planned endpoint:

```http
POST /api/documents/:documentId/blocks/:blockId/analyze
```

The server will combine deterministic measurements with model judgments. The
structured response should include:

- a short summary and rhetorical purpose;
- clarity, formality, coherence, and conciseness scores;
- concrete issues with severity and evidence;
- safe text offsets for highlighting; and
- learning goals used by rewriting and practice modes.

The analysis prompt must prohibit invented claims, citations, evidence, and
statistics.

### Three-tone rewriting

Planned endpoint:

```http
POST /api/documents/:documentId/blocks/:blockId/rewrites
```

The initial tones are:

| Tone | Behavior |
| --- | --- |
| Concise | Reduce unnecessary wording while preserving every claim. |
| Formal | Use conventional academic language without unnecessary complexity. |
| Accessible | Improve readability without weakening academic accuracy. |

Each option should return rewritten text, concrete changes, explanations,
meaning-preservation status, and warnings. Citations, quotations, names,
numbers, equations, and technical terms must be preserved unless the user
explicitly changes them.

Accepting an option should reuse the existing editor flow:

```text
AI option selected
    -> DocumentEditor.applyCurrentBlockStatus({
         status: 'processed',
         replacementText,
         targetBlockId
       })
    -> save document
    -> persist accepted-option metadata
    -> advance to the next processing block
```

### Practice feedback

Planned endpoint:

```http
POST /api/documents/:documentId/blocks/:blockId/practice-feedback
```

Practice mode should show learning goals before model answers. The user writes a
revision, and the model compares the original and attempted text using stable
criteria such as meaning preservation, target tone, clarity, and grammar.

The first response should provide strengths and targeted hints, not replace the
student's work with a complete model answer. A separate action may reveal an
example rewrite afterward.

### Semantic boundaries

The Embeddings API may later support optional semantic blocks:

1. segment text safely into sentences or original paragraphs;
2. embed each adjacent unit;
3. calculate cosine similarity between adjacent units;
4. create a boundary when similarity drops below an evaluated threshold; and
5. enforce the same character minimum and maximum.

This workflow is optional. Character-balanced deterministic clustering remains
the default until semantic clustering is implemented and evaluated.

## Planned Persistence

Dedicated tables should store AI data rather than putting large results into
`document_blocks.attrs`:

| Planned table | Purpose |
| --- | --- |
| `block_analyses` | Analysis result, source-text hash, filters, model, and prompt version. |
| `block_rewrite_options` | Tone, rewritten text, explanation, warnings, and accepted timestamp. |
| `practice_attempts` | User attempt, target tone, model feedback, and scores. |
| `ai_requests` or equivalent | Token usage, latency, status, request ID, and error metadata. |

Every stored result should include a hash of the source block text. If the block
changes, the UI must treat results generated from the old hash as stale.

## Prompt and Response Rules

Prompts should be versioned in one server-side module. Each stored AI result
should record the prompt version that produced it.

All workflows must:

- use structured outputs validated by server-side schemas;
- operate on the selected block only;
- distinguish target text from neighboring context;
- preserve the author's meaning;
- avoid inventing sources, facts, quotations, or results;
- return concrete explanations rather than generic statements;
- treat document text and user instructions as untrusted input; and
- fail safely when output cannot be parsed or validated.

Changing a prompt should include regression testing against a fixed collection
of academic paragraphs.

## Security, Privacy, and Cost Controls

Before enabling real AI endpoints:

- require an authenticated session;
- verify that the document and block belong to the signed-in user;
- load authoritative block text from PostgreSQL;
- validate filters, tones, text lengths, and request bodies;
- apply a stricter rate limiter to AI endpoints;
- prevent duplicate requests from repeated clicks;
- configure request timeouts and cancellation;
- avoid logging complete papers or API keys;
- cache results by block hash, filters, prompt version, and model;
- track token usage and latency;
- add per-user request or credit limits; and
- document how submitted academic text is processed.

## AI-Related File Inventory

Keep this inventory updated when files are added, renamed, or removed.

### Configuration and dependencies

| File | Status | AI responsibility |
| --- | --- | --- |
| `.env.example` | Active | Documents the server-only API key and model environment variables. |
| `package.json` | Active | Declares `openai` and `zod`; runs clustering tests. |
| `package-lock.json` | Active | Locks OpenAI SDK and validation-library dependency versions. |
| `README.md` | Existing overview | Describes the original tentative AI architecture; some model/LangChain/MCP details may not match the current implementation plan. |
| `docs/beta/ai-integration.md` | Active | Source of truth for current AI integration status and planned workflows. |

### Preprocessing and upload

| File | Status | AI responsibility |
| --- | --- | --- |
| `scripts/lib/clustering.cjs` | Implemented | Creates deterministic sentence-aware, character-balanced model input blocks. |
| `scripts/lib/clustering.test.cjs` | Implemented | Tests punctuation, abbreviations, decimals, boundaries, balancing, and oversized sentences. |
| `server/routers/documents.js` | Implemented preprocessing | Uses clustering for live `.txt`, `.md`, and `.docx` uploads while preserving supported formatting. |
| `scripts/process-upload.cjs` | Implemented preprocessing | Uses the same clustering behavior in the CLI importer. |
| `server/models/blocks.js` | Supporting | Creates stable block IDs, stores block text/status, and advances processing. |
| `server/models/documents.js` | Supporting | Persists uploaded documents, blocks, saves, and progress. |
| `scripts/db/schema.sql` | Supporting; AI extension planned | Defines current document/block tables; future AI tables will be added here or through migrations. |

### Workspace and editor

| File | Status | AI responsibility |
| --- | --- | --- |
| `src/pages/WorkspacePage.jsx` | Placeholder UI | Owns analyzing, rewriting, and practicing state; currently simulates AI responses and errors. |
| `src/components/DocumentEditor.jsx` | Supporting | Exposes the selected block and applies accepted replacement text/status changes. |
| `src/services/documentsApi.js` | Supporting | Saves documents and updates block statuses; AI API functions are not present yet. |
| `src/styles/workspace.css` | Active UI | Styles analysis statistics, rewrite cards, practice cards, errors, loading states, and responsive AI panels. |
| `src/components/OwlContainer.jsx` | Supporting UI | Displays the assistant character used during workflow feedback. |
| `src/pages/libraries/animations/createOwlAnimator.jsx` | Supporting UI | Provides thinking, success, error, interaction, and magic animation behavior. |
| `src/pages/libraries/animations/useOwlAnimator.jsx` | Supporting UI | Connects React components to the owl animator lifecycle. |
| `src/assets/thinking.svg` | Supporting UI | Thinking-state visual asset. |
| `src/assets/error.svg` | Supporting UI | Error-state visual asset. |
| `src/assets/answer.svg` | Supporting UI | Answer/success visual asset. |
| `src/assets/magic_wand.svg` | Supporting UI | Rewrite-application visual asset. |

### Existing supporting documentation

| File | Status | AI responsibility |
| --- | --- | --- |
| `docs/alpha/architecture.md` | Existing | Records which AI-facing flows are placeholders. |
| `docs/alpha/document.md` | Existing | Explains current block selection, rewrite replacement, status, and save behavior. |
| `docs/alpha/owl-animations.md` | Existing | Explains animations currently triggered by placeholder AI interactions. |

### Planned files

These names are recommendations and should be updated if implementation chooses
different names.

| Planned file | Intended responsibility |
| --- | --- |
| `server/ai/client.js` | Construct and export the server-only OpenAI client. |
| `server/ai/prompts.js` | Define versioned analysis, rewriting, and practice prompts. |
| `server/ai/schemas.js` | Define Zod and structured-output schemas. |
| `server/ai/analyzeBlock.js` | Run block analysis and deterministic metric composition. |
| `server/ai/generateRewrites.js` | Generate and validate the three tone-based options. |
| `server/ai/evaluatePractice.js` | Evaluate a user's rewrite and return teaching feedback. |
| `server/routers/ai.js` | Expose authenticated document/block AI endpoints. |
| `server/models/analyses.js` | Persist and retrieve block analyses. |
| `server/models/rewrites.js` | Persist rewrite options and accepted choices. |
| `server/models/practiceAttempts.js` | Persist practice attempts and feedback. |
| `src/services/aiApi.js` | Call the application's Express AI endpoints from React. |
| `src/components/AiWritingPanel.jsx` | Present analysis, rewrite, and practice results outside `WorkspacePage`. |
| `server/ai/*.test.js` | Test prompts, validation, stale hashes, authorization, and failures. |

## Implementation Checklist

- [x] Add server-only OpenAI environment placeholders.
- [x] Install the OpenAI Node SDK and Zod.
- [x] Replace period-only splitting with deterministic balanced clustering.
- [x] Test clustering behavior.
- [ ] Add the server-only OpenAI client.
- [ ] Add structured response schemas.
- [ ] Add versioned prompts.
- [ ] Add analysis persistence and endpoint.
- [ ] Connect the analyzing panel to the endpoint.
- [ ] Add rewrite persistence and endpoint.
- [ ] Replace placeholder rewrite cards with API results.
- [ ] Persist accepted rewrite metadata.
- [ ] Add practice-attempt persistence and endpoint.
- [ ] Replace placeholder practice feedback with API results.
- [ ] Add stale-result detection using source-text hashes.
- [ ] Add AI rate limits, timeouts, token tracking, and user quotas.
- [ ] Add prompt regression fixtures and endpoint tests.
- [ ] Evaluate whether semantic embeddings materially improve boundaries.
- [ ] Add realtime progress only if request duration requires it.

## Change Log

### 2026-07-11

- Created this living AI integration document.
- Recorded the existing OpenAI configuration and installed dependencies.
- Recorded that current analyzing, rewriting, and practice behavior is placeholder-only.
- Documented deterministic sentence-aware, character-balanced preprocessing.
- Added the initial target architecture, file inventory, and implementation checklist.
