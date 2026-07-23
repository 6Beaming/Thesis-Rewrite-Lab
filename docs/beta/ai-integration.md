# AI Integration



This document focuses on
where each workflow starts, which files are involved, what is sent to OpenAI,
how MCP adds external data, and where results are stored.

Document upload and non-AI block partitioning are explained separately in
[`file-upload.md`](./file-upload.md) and
[`block-partitioning.md`](./block-partitioning.md).

## At a Glance

| Workflow | Main endpoint | AI module | Storage |
| --- | --- | --- | --- |
| Block Analysis | `POST /api/documents/:documentId/blocks/:blockId/analyze` | `server/ai/blockAnalysis.js` | `block_analyses` |
| MCP source lookup | Internal step before uncached analysis | `server/mcp/academicSources.js` | Saved inside the analysis result |
| Three-tone Rewriting | `POST /api/documents/:documentId/blocks/:blockId/rewrites` | `server/ai/blockRewrites.js` | `block_rewrite_options` |
| Practice feedback | `POST /api/documents/:documentId/blocks/:blockId/practice-feedback` | `server/ai/practiceFeedback.js` | `block_practice_attempts` |

All OpenAI requests run in Express. The browser never receives the OpenAI API
key and never chooses the model.

## Shared Request Flow

```text
TipTap block selected
    -> WorkspacePage stores its block ID and current text
    -> pending editor changes are saved
    -> documentsApi sends the block ID to Express
    -> Express verifies the signed-in user owns the document and block
    -> an exact cached result is returned when available
    -> otherwise the server runs the required AI workflow
    -> Zod validates the Structured Output
    -> the result and token usage are saved
    -> WorkspacePage renders the result
```

The browser does not send authoritative source text. After ownership is
verified, the server reads the current block from PostgreSQL. Analysis and
Practice may also load the immediately previous and next blocks for local flow
context. The full paper is not sent to OpenAI.


## Block Analysis

### File Workflow

1. `src/components/DocumentEditor.jsx` finds the TipTap block containing the
   cursor and reports its `blockId`, text, and status.
2. `src/pages/WorkspacePage.jsx` stores that information in
   `activeEditorBlock` and saves unsaved changes before analysis.
3. `src/services/documentsApi.js` posts the block ID and enabled filters.
4. `server/routers/documents.js` validates the request, checks ownership, loads
   the block and its neighbors, and checks the analysis cache.
5. On a cache miss, the route calculates deterministic metrics and runs the MCP
   academic-source lookup described below.
6. `server/ai/blockAnalysis.js` sends the block, neighbors, filter definitions,
   and MCP context to the OpenAI Responses API.
7. `server/models/analyses.js` saves the validated result in `block_analyses`.
8. `WorkspacePage.jsx` renders metrics, scores, issues, and learning goals.
9. `src/lib/analysisPhraseDecorations.js` underlines each exact issue-evidence
   phrase in the editor with a red wavy line.

### Filters and Output

All four filters start selected:

| Filter ID | UI label |
| --- | --- |
| `clarity` | Clear and understandable |
| `conciseness` | Concise and direct |
| `academic-style` | Academic and precise |
| `flow` | Logical flow |

Local code calculates character, word, sentence, and average sentence-length
metrics before the model call. The model returns:

- a short summary and rhetorical purpose;
- clarity, formality, coherence, and conciseness scores;
- zero to twelve issues with exact evidence, explanation, and suggestion; and
- one to four learning goals for Practice.

Evidence must be an exact excerpt from the block. Underlines remain visible for
every block analyzed during the current workspace session. Editing a block
invalidates its old underlines and cached client view.

The persistent cache key combines the document, stable block ID, exact source
text hash, selected filters, model, and prompt version.

## How MCP Works with AI

MCP enriches Block Analysis with bibliographic data from Crossref. MCP retrieves
external source metadata; OpenAI uses that metadata only as supporting context
while evaluating the writing.

### File Workflow

1. On an analysis cache miss, `server/routers/documents.js` calls
   `lookupAcademicSourcesViaMcp()` with the selected block text.
2. `server/mcp/academicSources.js` extracts up to three unique DOI values.
3. If a DOI exists, it creates an MCP client and the application-owned
   `thesis-rewriter-academic-sources` MCP server using the official SDK's linked
   `InMemoryTransport` pair.
4. The client calls `listTools()` and confirms that `lookup_crossref_doi` is
   available.
5. The client calls that tool once per DOI. The tool requests Crossref and
   returns normalized title, author, year, publisher, journal, work type, and
   DOI URL fields.
6. `server/ai/blockAnalysis.js` places the MCP status and successful records in
   the OpenAI input as `externalSourceContext`.
7. OpenAI returns the writing analysis. The server attaches the complete MCP
   lookup status and safe errors to that result before saving it.

```text
Analysis route
    -> MCP client discovers lookup_crossref_doi
    -> MCP client calls the application-owned MCP server
    -> MCP tool reads Crossref
    -> normalized metadata returns through MCP
    -> metadata becomes untrusted context for OpenAI analysis
    -> combined result is cached and rendered
```

This is application-orchestrated MCP integration: the model does not call
Crossref or choose tools itself. The MCP client/server exchange still performs
real tool discovery and invocation, while the in-memory transport avoids a
separate process, public MCP URL, or tunnel.

Important boundaries:

- only Block Analysis directly invokes MCP;
- the tool receives DOI strings, not the paper, user identity, or OpenAI key;
- tool output is untrusted and cannot issue model instructions;
- Crossref metadata may reveal a citation mismatch but cannot prove a paper's
  claims;
- `not-needed` means no DOI was found, `completed` means all lookups succeeded,
  `partial` means some succeeded, and `unavailable` means none succeeded;
- MCP or Crossref failure does not stop the writing analysis; and
- an analysis cache hit repeats neither the MCP lookup nor the OpenAI request.

Run the real MCP/Crossref path without calling OpenAI:

```bash
npm run mcp:smoke -- 10.1038/nphys1170
```

## Three-Tone Rewriting

### File Workflow

1. `WorkspacePage.jsx` shows one card for each supported tone.
2. A card's **Generate** or **Regenerate** button saves pending edits and calls
   `src/services/documentsApi.js`.
3. `server/routers/documents.js` checks ownership and the exact rewrite cache.
4. `server/ai/blockRewrites.js` sends the selected block through the Responses
   API and validates the rewrite, explanation, changes, warnings, and
   meaning-preservation flag.
5. `server/models/rewrites.js` stores the option in
   `block_rewrite_options`.
6. **Use this rewrite** calls the acceptance endpoint, records `accepted_at`,
   replaces the block text in `DocumentEditor`, marks it `processed`, and moves
   to the next block.

Supported tones:

| Tone ID | Purpose |
| --- | --- |
| `formal-academic` | Objective, precise, research-centered writing |
| `persuasive-argumentative` | Active, confident reasoning that emphasizes significance |
| `accessible-concise` | Clear, direct writing without filler or heavy jargon |

Each tone is generated separately; there is no bulk-generation endpoint.
Rewrites must preserve claims, citations, quotations, names, numbers, equations,
and technical terms. Options that fail meaning preservation cannot be applied.

The rewrite cache key includes the document, stable block ID, source-text hash,
tone, model, and prompt version. Regeneration bypasses that exact cached option.

Acceptance endpoint:

```http
POST /api/documents/:documentId/blocks/:blockId/rewrites/:rewriteId/accept
```

## Practice Feedback Mode

### File Workflow

1. `WorkspacePage.jsx` collects the student's revision for the active block.
2. Pending editor changes are saved before feedback is requested.
3. `src/services/documentsApi.js` posts `attemptText` to the Practice endpoint.
4. `server/routers/documents.js` validates ownership, loads the source block and
   neighbors, and loads the newest analysis for the exact source text when one
   exists.
5. `server/ai/practiceFeedback.js` compares the original with the student's
   revision through the Responses API.
6. `server/models/practice.js` stores the validated result in
   `block_practice_attempts`.
7. `WorkspacePage.jsx` displays original-versus-revision scores, strengths,
   prioritized hints, suggested phrases, a next step, and readiness.

Analysis is helpful but not required. When matching analysis exists, Practice
receives its issues, evidence, suggestions, and learning goals. Feedback must
recognize issues the student fixed without restoring wording that Analysis
flagged. The server checks every suggested phrase and retries once if it
conflicts with the matching analysis.

Practice teaches instead of replacing the student's work:

- strengths describe improvements introduced by the revision;
- hints provide short phrases, not a complete replacement block;
- original and revision scores are shown together; and
- `readyToApply` does not automatically change the block text or status.

The cache key includes the document, block, source-text hash, attempt-text hash,
matching analysis ID, model, and prompt version.

## Shared Security and Persistence

- All routes require an Auth.js session and verify document/block ownership.
- Document text, practice text, neighbor text, and MCP output are treated as
  untrusted data rather than model instructions.
- Models are selected through server environment variables.
- Responses use `store: false`, a 30-second timeout, one SDK retry, and strict
  Zod Structured Outputs.
- AI routes share a rate limit of 30 requests per 15 minutes per rate-limit
  identity.
- Only the selected block and immediate neighbors are sent to OpenAI.
- Token-usage metadata is stored when the API returns it.

`activeEditorBlock.blockId` is temporary React state, not LocalStorage. Its value
matches the persistent `document_blocks.id`. Selecting a block temporarily shows
it as `processing`; leaving restores its previous display status unless the user
uses **Skip**, **Complete**, or **Use this rewrite**.

## Database Tables

The AI integration adds three PostgreSQL tables in `scripts/db/schema.sql`:

```text
documents
    -> block_analyses
    -> block_rewrite_options
    -> block_practice_attempts

document_blocks.id
    -> matches each AI row's logical block_id
```

Each AI table has a `document_id` foreign key with `ON DELETE CASCADE`, so
deleting a document also deletes its AI data. `block_id` is intentionally a
stable logical UUID rather than a foreign key. Normal saves may replace rows in
`document_blocks`; keeping AI rows attached to the document prevents those
saves from deleting valid history and cache entries.

| New table | What it stores | Unique cache identity |
| --- | --- | --- |
| `block_analyses` | Selected filters, deterministic metrics, structured analysis, MCP/Crossref result, usage, model, and prompt version | Document + block + source-text hash + filter signature + model + prompt version |
| `block_rewrite_options` | Tone, rewritten text, explanation, changes, meaning check, warnings, usage, and `accepted_at` | Document + block + source-text hash + tone + model + prompt version |
| `block_practice_attempts` | Student attempt, structured feedback, matching analysis key, usage, model, and prompt version | Document + block + source hash + attempt hash + analysis context + model + prompt version |

Important fields:

- `source_text_hash` prevents results for old block text from being reused.
- `attempt_text_hash` identifies an exact repeated Practice submission.
- `analysis_context_key` makes Practice feedback change when its supporting
  analysis changes; it is `none` when no matching analysis exists.
- `result_json`, `feedback_json`, and other JSONB columns store validated
  Structured Outputs without flattening every model field into a column.
- `usage_json` stores OpenAI token usage when available.
- `model` and `prompt_version` keep caches valid when AI configuration changes.
- `created_at` indexes support retrieving the latest result for a block.

The matching model files are `server/models/analyses.js`,
`server/models/rewrites.js`, and `server/models/practice.js`. Apply the tables
with `npm run db:migrate`.

## Key Files

| File | Responsibility |
| --- | --- |
| `.env.example` | Server-only model configuration and optional Crossref settings |
| `scripts/db/schema.sql` | AI tables, foreign keys, cache indexes, and latest-result indexes |
| `server/routers/documents.js` | Authenticated orchestration for all AI endpoints |
| `server/ai/blockAnalysis.js` | Analysis prompt, metrics, schema, and OpenAI call |
| `server/mcp/academicSources.js` | MCP client/server, DOI tool, Crossref normalization, and fallback |
| `server/ai/blockRewrites.js` | Three rewrite tones, schema, safety prompt, and OpenAI call |
| `server/ai/practiceFeedback.js` | Comparative coaching schema, prompt, and conflict retry |
| `server/models/analyses.js` | Analysis context, cache, and persistence |
| `server/models/rewrites.js` | Rewrite cache, persistence, and acceptance |
| `server/models/practice.js` | Practice cache and persistence |
| `src/services/documentsApi.js` | Browser calls to the AI endpoints |
| `src/pages/WorkspacePage.jsx` | AI state, request handling, stale-result guards, and result UI |
| `src/components/DocumentEditor.jsx` | Active block reporting, text replacement, status, and decorations |
| `src/lib/analysisPhraseDecorations.js` | Exact evidence matching and red wavy underlines |
