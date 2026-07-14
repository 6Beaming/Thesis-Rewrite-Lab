# AI Integration

Last updated: 2026-07-13

This is the living technical document for AI integration in Thesis Rewriter.
Update it whenever an AI workflow, prompt, endpoint, database table, model,
configuration value, or AI-facing UI behavior changes.

This document distinguishes implemented behavior from planned behavior. A
feature must not be described as complete until its frontend, authenticated
backend path, persistence, and verification are implemented.

## Current Status

| Area | Status | Current behavior |
| --- | --- | --- |
| OpenAI configuration | Implemented | Server-only API key and model variables are documented in `.env.example`. |
| OpenAI Responses API | Implemented | Express calls configured models for analysis, rewriting, and practice feedback through the OpenAI Node SDK. |
| Structured Outputs | Implemented | Analysis, rewriting, and practice responses are parsed and validated with Zod and `zodTextFormat`. |
| Deterministic block metrics | Implemented | Counts and simple writing signals are calculated locally before the model call. |
| Selected-block analysis | Implemented | Users select one editor block, choose filters, and request focused coaching. |
| Analysis persistence | Implemented | Results are cached in `block_analyses` using document, block, text hash, filters, model, and prompt version. |
| Three rewriting options | Implemented | Users generate, inspect, regenerate, and apply Formal & Academic, Persuasive & Argumentative, and Accessible & Concise rewrites. |
| Practice feedback | Implemented | Users submit their own selected-block revision and receive comparative scores, concrete improvements, short phrase suggestions, and a readiness flag. |
| Realtime AI progress | Not implemented | Socket.io is installed, but AI processing events are not connected. |
| Per-user AI credits | Not implemented | The analysis, rewriting, and practice routes have an IP rate limit but no user quota or subscription enforcement. |

## User Workflow

The implemented analysis workflow processes one selected block at a time:

```text
User selects a TipTap block
    -> chooses one or more analysis filters
    -> clicks Analyze selected block
    -> unsaved editor changes are saved first
    -> Express verifies the signed-in user owns the document and block
    -> server loads the selected block and its immediate neighbors
    -> deterministic metrics are calculated locally
    -> cached analysis is returned when the cache key matches
    -> otherwise the OpenAI Responses API generates structured coaching
    -> validated analysis is persisted
    -> React renders metrics, scores, issues, and practice goals
```

Only the selected block and its immediate previous and next blocks are supplied
to the analysis prompt. The full paper is not sent to the model.

The intended complete product workflow remains:

```text
Analyze selected block
    -> generate a rewrite from any of the three tone cards
    -> let the user write a practice revision
    -> return teaching feedback with targeted phrase suggestions
    -> apply or reject a suggestion
    -> save the edited document
    -> advance to another block
```

## Configuration

The server reads these variables:

```env
OPENAI_API_KEY=
OPENAI_REWRITE_MODEL=gpt-5.4-mini
OPENAI_ANALYSIS_MODEL=gpt-5.4-mini
OPENAI_PRACTICE_MODEL=gpt-5.4-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

- `OPENAI_API_KEY` authenticates requests made by Express.
- `OPENAI_ANALYSIS_MODEL` selects the block-analysis model.
- `OPENAI_REWRITE_MODEL` selects the three-tone rewriting model.
- `OPENAI_PRACTICE_MODEL` selects the student-revision coaching model.
- `OPENAI_EMBEDDING_MODEL` is reserved for future embedding-based features;
  current semantic partitioning runs locally and does not call this model.

Real values belong in the untracked `.env` file during local development and
in deployment secrets in production. The API key must never use a `VITE_`
prefix because Vite exposes such values to browser code.

After pulling schema changes, run:

```bash
npm run db:migrate
```

Model identifiers are read from environment variables instead of being selected
by the browser. This prevents users from changing cost or capability settings.
Pin a model snapshot before a graded demonstration if repeatable behavior is
more important than automatically receiving model updates.

## Implemented Block Analysis

### File Workflow

1. `src/components/DocumentEditor.jsx` detects which TipTap block contains the
   user's cursor and reads its `attrs.blockId`.
2. `src/pages/WorkspacePage.jsx` keeps that ID temporarily in
   `activeEditorBlock.blockId`. When the user clicks **Analyze selected block**,
   it first saves unsaved editor changes and starts the analysis request.
3. `src/services/documentsApi.js` sends the document ID, selected block ID, and
   enabled filters to `POST /api/documents/:documentId/blocks/:blockId/analyze`.
4. `server/routers/documents.js` validates the filters and signed-in user, then
   coordinates the database lookup, cache check, deterministic metrics, AI call,
   and saved result.
5. `server/models/analyses.js` uses the document ID, block ID, and user ID to
   load the selected block from PostgreSQL with its immediate previous and next
   blocks. It also reads and writes cached results in `block_analyses`.
6. `server/ai/blockAnalysis.js` sends the selected block and its neighboring
   context to the OpenAI Responses API and validates the structured response.
7. The response returns through the same route to `WorkspacePage.jsx`, which
   displays the metrics, issues, scores, and practice goals for that block.

`activeEditorBlock.blockId` itself is temporary React state. For a saved
document, its value corresponds to the persistent `document_blocks.id` stored
in PostgreSQL; active block selection is not stored in LocalStorage.

### Endpoint

```http
POST /api/documents/:documentId/blocks/:blockId/analyze
Content-Type: application/json
```

Request body:

```json
{
  "filters": ["passive", "nominalization"]
}
```

Supported filters:

| Filter | Intended coaching focus |
| --- | --- |
| `passive` | Passive constructions and whether they weaken directness. |
| `nominalization` | Dense noun forms that may hide an action or actor. |
| `hedging` | Qualification, uncertainty, and strength of claims. |
| `transitions` | Local connections to the preceding and following blocks. |

At least one filter is required. Unknown filters return `400` rather than being
silently ignored.

Successful response shape:

```json
{
  "analysis": {
    "id": "analysis-uuid",
    "blockId": "block-uuid",
    "sourceTextHash": "sha256-hash",
    "filters": ["nominalization", "passive"],
    "deterministic": {
      "characterCount": 218,
      "wordCount": 37,
      "sentenceCount": 2,
      "averageSentenceLength": 18.5,
      "passiveConstructionCount": 1,
      "nominalizationCount": 2,
      "hedgeCount": 0,
      "transitionCount": 1
    },
    "ai": {
      "summary": "The block describes the study method.",
      "purpose": "method",
      "scores": {
        "clarity": 78,
        "formality": 88,
        "coherence": 81,
        "conciseness": 70
      },
      "issues": [
        {
          "type": "passive",
          "severity": "medium",
          "evidence": "was evaluated",
          "explanation": "The construction hides the actor.",
          "suggestion": "Name the researcher or system performing the evaluation."
        }
      ],
      "learningGoals": [
        "Name the actor when it improves methodological clarity."
      ]
    },
    "model": "gpt-5.4-mini",
    "promptVersion": "block-analysis-v1",
    "createdAt": "2026-07-12T00:00:00.000Z"
  },
  "cached": false
}
```

`cached` is `true` when the server finds an existing result with an exact cache
key match.

### Authentication and ownership

The endpoint is mounted below the shared authenticated `/api` router. It uses
the Auth.js session to resolve the local user, then queries the block through:

```text
document id + block id + signed-in user id + trashed = false
```

If that query does not resolve one owned block, the endpoint returns `404`. The
browser does not submit authoritative block text. The server reads it from
PostgreSQL after pending editor changes have been saved.

### Context selection

`getOwnedBlockContext()` uses PostgreSQL `lag()` and `lead()` over
`block_index` to retrieve:

```js
{
  previous_text,
  text_content,
  next_text,
  academic_style
}
```

The target block is clearly separated from neighboring context in the model
input. Neighbor text is for cohesion and transition judgments only.

### Deterministic metrics

`computeDeterministicMetrics()` runs without an OpenAI request. It calculates:

- character, word, and sentence counts;
- average words per sentence;
- basic passive-construction indicators;
- nominalization suffix indicators;
- known hedge-word counts; and
- known transition-word counts.

Sentence boundaries use `Intl.Segmenter` when available. These values are
transparent indicators, not authoritative grammar judgments. They are shown
beside model feedback so deterministic measurements are not confused with
model-generated scores.

### Prompt and schema contract

The prompt version is currently:

```text
block-analysis-v1
```

The server prompt instructs the model to:

- act as an academic writing coach;
- analyze exactly one selected block;
- use neighbors only for local context;
- report only requested filter categories;
- avoid rewriting during the analysis step;
- avoid inventing facts, evidence, statistics, or citations;
- keep evidence as a short exact excerpt from the target block;
- treat document content as untrusted quoted text; and
- return specific teaching explanations and learning goals.

The structured schema requires:

- one summary;
- one rhetorical purpose;
- clarity, formality, coherence, and conciseness scores from 0 to 100;
- zero to twelve categorized issues; and
- one to four learning goals.

The endpoint rejects an unusable or unparseable model result instead of sending
partially structured content to React.

### Analysis caching and stale results

The cache key contains:

```text
document_id
block_id
SHA-256 hash of the exact block text
sorted filter signature
model
prompt version
```

Consequences:

- analyzing unchanged text with identical filters can reuse the saved result;
- changing a filter produces a different analysis;
- changing the block text produces a different hash and result;
- changing the model or prompt version invalidates the old cache naturally;
- old analyses remain available as historical rows but are not returned for
  changed text; and
- replacing `document_blocks` during a normal save does not delete analyses,
  because analyses belong to the document and retain the stable block UUID.

### Database table

`block_analyses` stores:

| Column | Purpose |
| --- | --- |
| `document_id` | Document ownership and cascade-delete boundary. |
| `block_id` | Stable editor block UUID. |
| `source_text_hash` | Detects edits and prevents stale cache hits. |
| `filter_signature` | Stable sorted string used by the cache index. |
| `filters` | Requested filter list. |
| `deterministic_metrics` | Locally calculated measurements. |
| `result_json` | Validated model analysis. |
| `usage_json` | OpenAI token-usage metadata when available. |
| `model` | Model that produced the result. |
| `prompt_version` | Prompt/schema contract version. |
| `created_at` | Creation or cache-refresh time. |

The unique cache index covers the complete cache key. Deleting a document
deletes its analyses.

### Frontend behavior

`WorkspacePage` receives the selected block, including its current text, from
`DocumentEditor.onActiveBlockChange`.

The Analyzing panel now:

1. shows a preview of the selected block;
2. lets the user enable or disable filters;
3. saves unsaved editor content before analysis;
4. disables duplicate submissions while a request is active;
5. triggers the existing owl loading/error states;
6. displays deterministic metrics separately from model scores;
7. displays issue counts by filter;
8. shows evidence, explanations, and suggestions; and
9. exposes learning goals for the Practice workflow.

Client results are keyed by block id, current block text, and selected filters.
Changing the selected text or filter set therefore hides a result that no
longer matches the current view.

Local demo documents cannot call the endpoint because they do not have owned
PostgreSQL document and block records.

## Errors, Limits, and Privacy

Implemented controls:

- authenticated API router;
- document and block ownership check;
- fixed server-selected model;
- strict filter validation;
- Zod-validated Structured Output;
- 30-second OpenAI client timeout;
- one SDK retry;
- 30 analysis, rewrite-generation, or practice-feedback requests per 15 minutes per rate-limit identity;
- safe messages for upstream failures and rate limits;
- source-text hashing and response caching;
- `store: false` on the Responses API request; and
- no full-paper submission.

Current limitations:

- there is no per-user credit balance or subscription check;
- there is no cancellation button after a request starts;
- latency is not stored separately from token usage;
- there is no prompt-regression fixture set yet;
- the endpoint has not been load-tested; and
- automated verification does not make a paid live model call.

Application logs must not print API keys, full papers, or raw OpenAI error
objects containing sensitive request details.

## Implemented Three-Tone Rewriting

Generation endpoint:

```http
POST /api/documents/:documentId/blocks/:blockId/rewrites
```

Request body for one tone:

```json
{
  "tone": "formal-academic",
  "force": false
}
```

`tone` is required and must be one of the three supported identifiers. Each card
has its own **Generate** or **Regenerate** action; there is no bulk-generation
request. `force: true` bypasses the exact cache match for that tone.

Implemented tones:

| Tone | Best for | Focus |
| --- | --- | --- |
| Formal & Academic | Dissertations, peer-reviewed journals, and committee submissions. | Objectivity, precise academic vocabulary, neutrality, and appropriately impersonal or passive constructions. |
| Persuasive & Argumentative | Thesis statements, proposals, and op-eds. | Active verbs, strong reasoning, and why the claim or finding matters. |
| Accessible & Concise | Executive summaries, abstract overviews, and elevator pitches. | Short sentences, active verbs, plain language, and no filler or unnecessary jargon. |

Each option returns rewritten text, concrete changes, explanations,
meaning-preservation status, and warnings. Citations, quotations, names,
numbers, equations, and technical terms must be preserved.

The formal prompt may foreground research with passive or impersonal language,
but it must not create “empirical evidence” that was absent from the source.
All three tones prohibit invented evidence, facts, citations, examples, results,
or stronger certainty.

Rewrite options are cached in `block_rewrite_options` by document, stable block
ID, exact source-text hash, tone, model, and prompt version. Regeneration updates
that exact option and clears its previous acceptance timestamp.

Accepting an option uses:

```text
AI option selected
    -> POST /api/documents/:documentId/blocks/:blockId/rewrites/:rewriteId/accept
    -> record accepted_at
    -> DocumentEditor.applyCurrentBlockStatus({
         status: 'processed',
         replacementText,
         targetBlockId
       })
    -> mark the workspace dirty for saving
    -> advance to the next processing block
```

The frontend saves unsaved source text before generation, rejects stale results
when the active block changes during a request, shows explanations and warnings,
and disables options where the model reports that meaning was not preserved.

Block selection is temporary: the selected block is displayed as `processing`
for AI work, but its stored TipTap/PostgreSQL status is unchanged until the user
clicks **Skip**, **Complete**, or **Use this rewrite**. Moving to another block
restores the previous block's original display status. Rewriting targets the
selected block, and **Use this rewrite** persists `processed` while replacing
its text.

## Implemented Practice Feedback

### File workflow

1. `src/pages/WorkspacePage.jsx` reads `activeEditorBlock.blockId` and the
   student's text from the Practice panel. It optionally displays the current
   analysis learning goals, but analysis is not required to submit practice.
2. Pending editor changes are saved so the server compares the attempt with the
   current PostgreSQL block rather than stale browser text.
3. `src/services/documentsApi.js` sends the attempt to the authenticated
   practice endpoint.
4. `server/routers/documents.js` validates the attempt, resolves the signed-in
   user, loads the owned block and immediate neighbors, checks the exact cache,
   and coordinates generation and persistence.
5. `server/ai/practiceFeedback.js` sends the comparison prompt through the
   Responses API and validates the Structured Output.
6. `server/models/practice.js` saves or retrieves the exact attempt in
   `block_practice_attempts`.
7. `WorkspacePage.jsx` renders the structured coaching, unless the selected
   block or attempt changed while the request was running.

### Endpoint

```http
POST /api/documents/:documentId/blocks/:blockId/practice-feedback
Content-Type: application/json
```

Request body:

```json
{
  "attemptText": "The student's own revised block."
}
```

The attempt is trimmed and must contain between 1 and 4,000 characters. The
document ID and stable block ID come from the active workspace selection. The
server does not trust browser-provided source text: it reads the current source
block from PostgreSQL after verifying ownership.

Response shape:

```json
{
  "practice": {
    "id": "practice-attempt-uuid",
    "blockId": "selected-block-uuid",
    "sourceTextHash": "sha256",
    "attemptText": "The student's own revised block.",
    "summary": "The revision is clearer, but one claim became stronger.",
    "scores": {
      "original": {
        "meaningPreservation": 100,
        "clarity": 72,
        "academicStyle": 89,
        "grammar": 94
      },
      "revision": {
        "meaningPreservation": 74,
        "clarity": 88,
        "academicStyle": 82,
        "grammar": 94
      }
    },
    "strengths": [
      "The revision uses a more direct subject and verb."
    ],
    "hints": [
      {
        "priority": "high",
        "issue": "Claim strength changed",
        "explanation": "The attempt presents a tentative relationship as certain.",
        "suggestedPhrase": "may contribute to increased political engagement"
      }
    ],
    "nextStep": "Revise the certainty of the central claim, then compare both versions again.",
    "readyToApply": false,
    "model": "gpt-5.4-mini",
    "promptVersion": "practice-feedback-v2",
    "createdAt": "2026-07-13T00:00:00.000Z"
  },
  "cached": false
}
```

### Prompt and teaching contract

The prompt version is:

```text
practice-feedback-v2
```

The model compares the student's attempt with the original before evaluating
style. It checks:

- meaning and claim-strength preservation;
- logical relationships;
- citations, quotations, proper names, numbers, statistics, equations, and
  technical terms;
- clarity and grammar;
- compatibility with the document's selected academic style; and
- continuity with the immediately neighboring blocks.

All source and attempt text is marked as untrusted quoted content. The prompt
prohibits following instructions found inside that text, inventing evidence or
citations, and increasing certainty beyond the source.

Practice is intentionally different from Rewriting. A strength must identify a
concrete improvement introduced by the student's revision, rather than praise
language that was already present in the original. Each hint includes a short
`suggestedPhrase` that can be inserted or adapted directly. The phrase may
rewrite the relevant phrase or clause, but the model must not return a complete
replacement for the selected block. `readyToApply` is only a coaching signal;
Practice does not automatically replace the block or change its processed
status.

### Structured response

The Zod schema requires:

- one summary;
- original and revision score sets, each containing integer scores from 0 to
  100 for meaning preservation, clarity, academic style, and grammar;
- zero to three strengths limited to improvements relative to the original;
- zero to four hints with low, medium, or high priority and a directly usable
  phrase suggestion;
- one next step; and
- one `readyToApply` boolean.

Each hint contains an issue label, an explanation, and an actionable hint. An
unparseable or incomplete result is rejected rather than partially rendered.

### Persistence and caching

`block_practice_attempts` stores:

| Column | Purpose |
| --- | --- |
| `document_id` | Document ownership and cascade-delete boundary. |
| `block_id` | Stable selected editor block UUID. |
| `source_text_hash` | Prevents feedback for old source text from matching edited text. |
| `attempt_text` | The student's submitted revision. |
| `attempt_text_hash` | Detects an exact repeated attempt without indexing its full text. |
| `feedback_json` | Validated scores, strengths, hints, summary, next step, and readiness. |
| `usage_json` | OpenAI token-usage metadata when available. |
| `model` | Model that generated the coaching. |
| `prompt_version` | Prompt/schema contract version. |
| `created_at` | Creation or exact-cache refresh time. |

The exact cache key is:

```text
document_id
block_id
SHA-256 hash of the source text
SHA-256 hash of the normalized attempt
model
prompt version
```

Changing the source block, student attempt, configured model, or prompt version
therefore requests fresh feedback. Repeating the same normalized attempt for
unchanged source text reuses saved feedback.

### Frontend behavior

Desktop displays the revision composer and coaching together. Mobile uses two
navigable cards and moves to the coaching card while the request runs. Both
layouts:

- require an active block and a non-empty attempt;
- show analysis learning goals as list items, or prompt the user to analyze the
  selected block when no goals are available;
- enforce the 4,000-character input limit;
- save unsaved editor changes before the request;
- use the owl loading and error states;
- clear practice text and feedback when another block is selected;
- discard a response if the block or attempt changed during the request; and
- compare original and revision scores with a visible change value;
- show only revision-specific improvements under **What you did well**;
- render each **Try** value as suggested language rather than another
  instruction; and
- distinguish "Ready for review" from "Revise and retry" without changing the
  block's status.


## AI-Related File Inventory

### Implemented AI files

| File | Responsibility |
| --- | --- |
| `.env.example` | Documents server-only API key and model configuration. |
| `server/ai/blockAnalysis.js` | Metrics, filter normalization, hash creation, Zod schema, versioned prompt, OpenAI client, and Responses API call. |
| `server/ai/blockAnalysis.test.js` | Tests deterministic metrics, filter normalization, signatures, and hashing. |
| `server/ai/blockRewrites.js` | Defines the three tones, Structured Output schemas, versioned safety prompt, and rewrite generation calls. |
| `server/ai/blockRewrites.test.js` | Tests supported tones and stable structured-result mapping. |
| `server/ai/practiceFeedback.js` | Validates practice attempts and defines the versioned coaching prompt and Structured Output schema. |
| `server/ai/practiceFeedback.test.js` | Tests practice-attempt normalization and length validation. |
| `server/models/analyses.js` | Loads owned block context and reads/writes cached analyses. |
| `server/models/rewrites.js` | Reads/writes cached rewrite options and records accepted options. |
| `server/models/practice.js` | Reads and writes exact cached student attempts and structured coaching. |
| `server/routers/documents.js` | Exposes authenticated analysis, rewriting, and practice endpoints. |
| `scripts/db/schema.sql` | Defines the AI result tables and their exact cache indexes. |
| `src/services/documentsApi.js` | Calls the analysis, rewriting, and practice endpoints. |
| `src/pages/WorkspacePage.jsx` | Saves pending edits, requests AI results, rejects stale results, renders analysis and practice coaching, and applies accepted rewrites. |
| `src/components/DocumentEditor.jsx` | Reports the currently selected block and its text. |
| `src/styles/workspace.css` | Styles analysis controls, metrics, scores, issues, goals, loading, errors, and responsive layouts. |

### Supporting documentation

| File | Responsibility |
| --- | --- |
| `docs/beta/ai-integration.md` | Source of truth for implemented and planned AI behavior. |
| `docs/beta/block-partitioning.md` | Explains document block creation and semantic/character modes. |
| `docs/beta/file-upload.md` | Explains upload parsing and block persistence. |
| `docs/alpha/document.md` | Explains the earlier document runtime and editor/status flow. |
| `docs/alpha/owl-animations.md` | Explains assistant animations reused by AI loading and errors. |

### Expected future files or modules

The exact names can change, but this inventory must be updated when they are
implemented.

| Planned area | Intended responsibility |
| --- | --- |
| Prompt regression fixtures | Detect behavior changes across prompt/model updates. |
| AI request accounting | Store latency, usage, status, and user credit consumption. |

## Verification

The block-analysis, three-tone rewriting, and Practice implementations were
verified on 2026-07-13 with:

```bash
npm run db:migrate
npm run check:server
npm test
npm run build
```

Observed results:

- product schema migration succeeded;
- all three AI persistence tables exist in PostgreSQL;
- server syntax checks passed;
- all 27 automated tests passed; and
- the Vite production build succeeded.

The build still reports existing dependency/bundle warnings for `lottie-web`
and large chunks. These warnings are not produced by the AI integrations.

No paid live OpenAI request was made during automated verification. A final
manual test requires a valid `OPENAI_API_KEY`, a signed-in browser session, and
a persisted document.

## Implementation Checklist

- [x] Add server-only OpenAI environment variables.
- [x] Install the OpenAI Node SDK and Zod.
- [x] Add the server-only OpenAI client for block analysis.
- [x] Add the analysis Structured Output schema.
- [x] Add a versioned analysis prompt.
- [x] Add deterministic block metrics.
- [x] Add analysis persistence and exact cache keys.
- [x] Add the authenticated block-analysis endpoint.
- [x] Connect the Analyzing panel to the endpoint.
- [x] Save unsaved editor text before analysis.
- [x] Add stale-result protection using the source-text hash and client key.
- [x] Add analysis rate limiting, timeout, token-usage storage, and safe errors.
- [ ] Add prompt regression fixtures and authenticated endpoint integration tests.
- [ ] Add per-user AI request or credit limits.
- [x] Add rewrite persistence and endpoint.
- [x] Replace placeholder rewrite cards with API results.
- [x] Persist accepted rewrite metadata.
- [x] Add practice-attempt persistence and endpoint.
- [x] Replace placeholder practice feedback with API results.
- [ ] Add realtime progress only if observed request duration requires it.

## Change Log

### 2026-07-13

- Replaced the Practice placeholder delay with authenticated Responses API
  coaching for the currently selected block.
- Added `practice-feedback-v2`, a strict schema for meaning, clarity, academic
  style, grammar, strengths, prioritized hints, next steps, and readiness.
- Refined Practice feedback to compare original and revision scores, restrict
  strengths to actual improvements, and return directly usable phrase
  suggestions instead of instructional **Try** text.
- Kept Practice educational by prohibiting the model from supplying a complete
  replacement and by leaving text application and block status unchanged.
- Added exact attempt caching and persistence in `block_practice_attempts`, with
  source and attempt hashes, model metadata, prompt version, and token usage.
- Connected desktop and mobile Practice cards, analysis learning goals,
  pre-request saving, input validation, owl states, and stale-result rejection.
- Added `OPENAI_PRACTICE_MODEL`, validation tests, schema migration coverage,
  and this file-by-file workflow documentation.

### 2026-07-12

- Implemented Formal & Academic, Persuasive & Argumentative, and Accessible &
  Concise block rewrites through the Responses API.
- Added structured rewrite explanations, changes, meaning-preservation flags,
  warnings, exact caching, per-tone regeneration, and acceptance timestamps.
- Connected desktop and mobile rewrite cards to generation, safe application,
  editor replacement, block completion, and next-block advancement.
- Made block selection temporarily display as processing, added adjacent Skip
  and Complete actions, and made AI rewriting target the selected block.
- Removed the duplicate selected-block preview and Skip control from the
  rewriting panel, and removed bulk generation so rewrites are requested from
  one tone card at a time.
- Moved selected-block actions into an end-of-block ProseMirror widget, removed
  the Processing label, added next-block navigation, and strengthened status
  colors while keeping selection status temporary and visually singular.
- Layered the end-of-block action widget above the selected-block outline so the
  border cannot cross through its controls.
- Kept the desktop owl below the AI panels and removed pointer handling from its
  decorative overlay so rewrite explanation and acceptance buttons remain fully
  clickable; mobile owl dragging remains interactive.
- Implemented selected-block analysis through the OpenAI Responses API.
- Added local deterministic metrics for sentence length and writing signals.
- Added strict filter validation and Zod Structured Output parsing.
- Added prompt-injection guidance that treats document blocks as untrusted text.
- Added authenticated document/block ownership validation.
- Added `block_analyses`, source-text hashing, prompt versioning, model metadata,
  token-usage storage, and exact cache keys.
- Kept analyses attached to documents so ordinary block-row replacement during
  a save does not delete valid cached results.
- Replaced placeholder analyzing statistics with selected-block results,
  coaching notes, scores, and practice goals.
- Documented the file-by-file selected-block analysis workflow.
- Added responsive analysis styling and existing owl loading/error integration.
- Recorded verification results and remaining limitations.

### 2026-07-11

- Created this living AI integration document.
- Added the initial target architecture, configuration, inventory, and roadmap.
- Recorded the earlier analyzing, rewriting, and practice placeholders.
- Moved non-AI partitioning and upload documentation to dedicated beta files.
