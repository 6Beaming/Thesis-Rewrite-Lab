# Beta Feature Integration Plan

Last updated: 2026-07-13

## Status And Branch Contract

This document is the approved-work checklist for integrating
`feature/ai-integration` into `feature/beta/merging`.

No merge has been started at the time this document was created.
`feature/beta/merging` remains the destination and source of truth for the
existing Google authentication, Stripe entitlement, database migration,
homepage/workspace UI, and Socket.IO architecture. `feature/ai-integration`
is the source for sentence-aware partitioning, local semantic clustering,
selected-block analysis, rewrite generation, and the starting practice UI.

The plan is clear enough to execute after explicit approval. Two details are
clarified here so they are not mistaken for already completed functionality:

1. Practice feedback on `feature/ai-integration` is a timed local placeholder.
   The merged beta must replace it with an authenticated, Pro-only,
   server-backed workflow rather than document it as complete.
2. Realtime coverage for AI means synchronizing committed, sanitized AI records
   and canonical document mutations. Streaming temporary model progress is not
   part of this merge.

## Source-Of-Truth Decisions

| Area | Source of truth | Integration decision |
| --- | --- | --- |
| Authentication and authorization | `feature/beta/merging` | Preserve Auth.js identity mapping, origin checks, session handling, and `requirePro`. |
| Stripe and subscription state | `feature/beta/merging` | Preserve billing routes, webhook ordering, entitlement middleware, refund behavior, and billing-room events. |
| Database migrations | `feature/beta/merging` | Keep ordered, checksummed migrations and add a forward-only AI migration. Never restore `scripts/db/schema.sql`. |
| Upload extraction | `feature/beta/merging` | Keep `src/services/documentResolver.js` as the only upload extraction boundary. |
| Upload/live partitioning | Hybrid | Port the sentence-aware and winkNLP algorithms from `feature/ai-integration` after structural extraction. |
| AI analysis and rewriting | `feature/ai-integration` | Port the server-side OpenAI, Zod, cache, ownership, source-hash, and rate-limit behavior behind `requirePro`. |
| Practice workflow | New merge work | Replace the local placeholder with a server-backed, persisted, Pro-only workflow. |
| Homepage/workspace appearance | `feature/beta/merging` | Preserve the existing visual structure, responsive behavior, owl UI, and component boundaries. Port behavior selectively. |
| Realtime transport | `feature/beta/merging` | Extend the existing authenticated rooms and sanitized publisher; do not introduce a second Socket.IO architecture. |
| API contract | Combined | Extend `src/openapi.yml` with upload partitioning and AI endpoints/events while preserving existing REST and realtime contracts. |

## Integration Sequence

### Phase 0: Record And Verify The Baseline

Before starting the merge:

1. Confirm the current branch is `feature/beta/merging` and the worktree has no
   unexpected tracked changes.
2. Fetch the latest remote refs and record the exact commit IDs for
   `feature/beta/merging` and `feature/ai-integration` in the merge notes.
3. Run the existing `feature/beta/merging` server checks, unit tests,
   integration tests, and frontend build before changing dependencies.
4. Verify a representative existing document can be opened, edited, saved,
   reloaded, and updated from a second signed-in browser session. Record its
   block IDs and revision so stable identity can be checked after integration.
5. Verify the existing Basic/Pro login and Stripe webhook paths before AI code
   is introduced. This isolates later regressions from pre-existing local setup
   problems.

### Phase 1: Bring In The Branch Without Accepting Conflicts Blindly

After approval, merge `feature/ai-integration` into
`feature/beta/merging` with the merge left uncommitted until conflicts and
tests are resolved. Preserve branch history, but resolve each conflicting file
according to this document rather than selecting one side for the whole file.

Known semantic conflicts requiring manual integration are:

- `package.json` and `package-lock.json`;
- `server/models/blocks.js`;
- `server/routers/documents.js`;
- `src/components/DocumentEditor.jsx`;
- `src/components/EditorToolbar.jsx`;
- `src/pages/HomePage.jsx`;
- `src/pages/WorkspacePage.jsx`; and
- `src/styles/workspace.css`.

The tracked `.env.example`, documentation, tests, API contract, migration
files, and newly added AI/partitioning modules also require content review even
when Git does not report a textual conflict.

### Phase 2: Integrate Upload Extraction And Block Partitioning

#### Extraction boundary

Keep `resolveDocumentUpload({ buffer, filename })` in
`src/services/documentResolver.js` as the format-specific extraction boundary:

- strict UTF-8 decoding for TXT;
- Markdown headings, quotes, ordered/unordered lists, fenced code, and logical
  paragraph boundaries;
- Mammoth-to-HTML conversion for DOCX;
- Parse5 traversal for DOCX headings, paragraphs, lists, table cells, soft
  breaks, and supported inline marks; and
- the existing normalized block contract containing `sourceType`, `text`,
  `attrs`, and TipTap `content`.

Do not restore the router-local DOCX HTML token parser from
`feature/ai-integration`. That parser duplicates extraction and preserves less
structure than the existing resolver.

#### Partitioning boundary

Port the sentence-aware character balancing and local winkNLP boundary scoring
from `feature/ai-integration`, but invoke it after extraction and independently
inside each resolved structural block. Partitioning must:

- never combine different headings, paragraphs, list items, quotes, code
  blocks, or table cells;
- use complete sentence boundaries where possible;
- retain the current target/minimum/maximum defaults of 800/450/1,200
  characters;
- preserve a sentence longer than the maximum instead of cutting it;
- support `semantic` and `character` modes;
- default through the request field, then `DOCUMENT_PARTITION_MODE`, then
  `semantic`;
- use winkNLP locally without an OpenAI call; and
- preserve text order and all supported inline marks when a formatted block is
  divided.

Avoid maintaining a second extraction pipeline in scripts or routers. A
runtime-specific browser adapter is acceptable because winkNLP is lazy-loaded
in the browser, but server, CLI, and browser implementations must share the
same options and behavior fixtures so their output cannot drift silently.

#### TipTap and stable block identity

Adopt the `blockSegment` representation from `feature/ai-integration` for
multiple processing segments inside one structural TipTap node. The enclosing
TipTap node must keep its semantic type and attributes; only the tracked
processing segments are divided.

For upload-time segmentation, assign one persistent UUID per segment. For a
live split of an oversized existing segment:

- retain the original block ID on the first segment;
- allocate new IDs only to additional segments;
- keep the original status on the first segment and initialize added segments
  as `unprocessed`;
- do not repartition an entire document after every keystroke;
- preserve the 450 ms idle delay and split only above the maximum; and
- persist the resulting content, rows, revision, version, and progress in the
  existing canonical document mutation transaction.

No migration should rewrite existing document content merely to adopt
`blockSegment`. The editor must continue reading the legacy node shape, and an
ordinary save must not change block IDs solely because the document was opened
in the merged build.

### Phase 3: Preserve The Migration Architecture And Add AI Tables

Keep `scripts/migrate-auth.js` as the advisory-locked, ordered, checksummed
migration runner. Do not modify already applied migrations
`001_auth.sql` through `005_stripe_checkout_attempts.sql`.

Do not restore or apply `scripts/db/schema.sql` from
`feature/ai-integration`. Its product schema predates the identity, revision,
realtime, and Stripe migrations and would reintroduce a second schema source.

Create the proposed forward-only migration
`server/models/migrations/006_ai_workflows.sql` during implementation. This
exact path is proposed for approval; it is not created by this planning step.
The migration should add:

- `block_analyses`, including document/block identity, source-text hash,
  normalized filter signature, deterministic metrics, structured result,
  usage, model, prompt version, and timestamps;
- `block_rewrite_options`, including source-text hash, tone, rewritten text,
  explanation, changes, meaning-preservation result, warnings, usage, model,
  prompt version, acceptance state, and timestamps; and
- `block_practice_attempts`, including source-text and practice-text hashes,
  submitted revision, structured feedback, usage, model, prompt version,
  acceptance state, and timestamps.

Cache uniqueness must include document ID, block ID, source hash, workflow
inputs, model, and prompt version. Ownership remains derived through the
document relation and is never accepted from the request body.

Before adding a foreign key from cached AI rows to `document_blocks`, verify
that every normal save preserves unchanged block IDs. If it does not, fix block
reconciliation first. Removed blocks should not leave reusable current-state
caches, while historical document versions must remain intact.

Migration verification must cover:

- a clean database applying migrations 001 through 006;
- an existing database upgrading from migration 005;
- repeat execution without duplicate objects;
- checksum rejection for an altered applied migration; and
- document/block deletion behavior for AI records.

### Phase 4: Integrate Pro-Only AI Analysis And Rewriting

Port the OpenAI Responses API and Zod Structured Output modules from
`feature/ai-integration`. Keep provider keys and model selection on the server.
The browser may select supported filters or rewrite tones, but it may not
provide an API key, arbitrary model ID, prompt version, document owner, or
trusted source text.

Mount AI endpoints below the existing `requirePro` middleware. The Stripe
billing router must remain mounted before `requirePro` so Basic users can
subscribe or recover payment, while all document and AI endpoints remain
Pro-only.

Preserve these analysis rules:

- validate the supported filter allow-list and require at least one filter;
- authorize ownership through the authenticated product user;
- load the selected block plus only its immediate neighbors;
- calculate deterministic metrics locally;
- protect the prompt against instructions embedded in document text;
- use `store: false`, the existing timeout/retry policy, and structured output
  validation;
- cache by source hash, sorted filters, model, and prompt version; and
- return sanitized results without raw provider request details.

Preserve these rewriting rules:

- generate only the requested supported tone;
- keep Formal & Academic, Persuasive & Argumentative, and Accessible & Concise
  as the allowed tone set;
- verify the block source hash before reusing or accepting an option;
- disable options that do not preserve meaning; and
- keep regeneration rate-limited and explicit.

The source implementation marks a rewrite accepted before the browser applies
and saves the text. That can leave `accepted_at` set when the document save
fails. The merged implementation should make acceptance a canonical server
transaction: validate the source hash, apply the replacement to the identified
block/content, update progress and revision, append the version when required,
mark the rewrite accepted, and return the committed document. Publish realtime
events only after this transaction commits.

### Phase 5: Complete The AI Practice Workflow

The five-second local placeholder in `feature/ai-integration` must be removed.
The intended beta workflow is:

```text
Select a persisted block
    -> obtain analysis and practice goals
    -> write a personal revision
    -> save unsaved document changes first
    -> POST the revision for structured coaching
    -> verify Pro entitlement, ownership, block ID, and source hash
    -> return strengths, issues, goal coverage, and actionable feedback
    -> optionally accept the personal revision through a canonical mutation
```

The proposed implementation paths, requiring approval before creation, are:

- `server/ai/practiceFeedback.js` for prompt construction, OpenAI invocation,
  timeout/retry handling, and Zod validation;
- `server/models/practice-attempts.js` for cache/persistence queries;
- `server/routers/document-ai.js` for thin nested analysis, rewrite, and
  practice route handlers rather than continuing to enlarge
  `server/routers/documents.js`;
- `src/components/BlockAnalysisPanel.jsx` for selected-block metrics and
  coaching;
- `src/components/PracticePanel.jsx` for revision input and feedback; and
- the existing `src/components/DocumentRewriter.jsx` for real rewrite cards,
  keeping page-level orchestration in `src/pages/WorkspacePage.jsx`.

The practice endpoint should cache only identical source text, practice text,
goals/filters, model, and prompt version. It must reject empty submissions,
stale source hashes, blocks from another user, demo-only documents, and unsafe
provider output. Accepting a practice revision should use the same canonical
server mutation and revision conflict rules as accepting a generated rewrite.

### Phase 6: Extend Realtime Without Duplicating It

Keep `server/realtime/index.js`, `server/realtime/publisher.js`,
`src/services/realtime.js`, and `src/components/RealtimeProvider.jsx` as the
single Socket.IO path.

Existing committed events for profiles, subscriptions, documents, blocks,
trash, versions, and progress must continue to work. AI integration should add
safe publisher projections and events only for persisted state that another
same-user session can use:

| Committed action | Realtime result |
| --- | --- |
| New block analysis persisted | Publish sanitized analysis availability to the authorized document/user room. |
| New rewrite option persisted | Publish sanitized rewrite availability to the authorized document/user room. |
| New practice feedback persisted | Publish sanitized practice-feedback availability to the authorized document/user room. |
| Rewrite or practice revision accepted | Publish the canonical `block:updated`, `document:updated`, version, and progress results after commit, plus acceptance metadata only if the UI consumes it. |
| Cached AI result read without mutation | Return it over HTTP; do not emit a false creation event. |
| Model request started or token streamed | No Socket.IO event in this merge. Busy state remains local to the requesting browser. |

AI events must reuse authenticated user/document rooms, include event IDs and
resource IDs, and expose only allow-listed fields. They must never contain API
keys, provider request objects, raw usage billing details, prompts, session
cookies, Stripe identifiers, or data from neighboring blocks that was supplied
only as model context.

Socket behavior must be tested with two Pro sessions for the same user, a
different user, a Basic user, stale revisions, reconnect/refetch, duplicate
events, and an entitlement change from Pro to Basic.

### Phase 7: Preserve The Current Homepage And Workspace UI

Treat the rendered UI on `feature/beta/merging` as canonical. For conflicting
React and CSS files, begin with the `feature/beta/merging` component/layout and
port only the required partitioning and AI state transitions.

In particular:

- preserve the current homepage cards, header, sidebar, account/trash/version
  views, responsive layout, and subscription routing;
- preserve the current workspace structure, mobile behavior, owl animation,
  toolbar appearance, confirm modals, and CSS naming unless a new AI state
  requires a narrowly scoped class;
- keep reusable analysis, rewrite, and practice rendering in components rather
  than embedding all markup into `WorkspacePage.jsx`;
- connect AI controls to persistent block IDs and the canonical document API;
- remove period-only browser demo partitioning or route demo imports through
  the same deterministic partitioner so preview behavior does not contradict
  server uploads; and
- verify desktop and mobile behavior for long content, overflow, loading,
  errors, keyboard focus, and screen-reader labels.

The merge is not visually complete until before/after checks confirm that AI
integration has not replaced the existing homepage/workspace look and feel.

### Phase 8: Reconcile Dependencies, Tests, And Ignore Rules

Manually union dependencies. Preserve the packages already required by
`feature/beta/merging`, including Parse5, Stripe, Socket.IO client support, and
`cross-env`. Add the packages required by `feature/ai-integration`:

- `openai`;
- `zod`;
- `wink-nlp`; and
- `wink-eng-lite-web-model`.

Regenerate `package-lock.json` with npm after editing `package.json`; do not
hand-merge lockfile conflict markers. Combine scripts so server syntax checks,
unit tests, integration tests, partitioner tests, AI tests, Stripe tests, and
the production build all remain runnable.

Keep `/test/` in `.gitignore` as required. Files already tracked under that
directory remain tracked. Tests arriving from `feature/ai-integration` should
be reorganized consistently with the existing test layout rather than leaving
a mixture of colocated and centralized tests. Because ignore rules can hide a
new intended test, verify the final tracked test inventory with `git ls-files`
before committing.

### Phase 9: Synchronize Environment Configuration Safely

Real `.env` files remain local and must never be committed. Environment values
may be exchanged only through the agreed private channel. The tracked
`.env.example` should contain comments and empty/non-secret defaults, never real
credentials.

The merged environment contract is:

| Category | Variables | Notes |
| --- | --- | --- |
| Application/database | `APP_ORIGIN`, `DATABASE_URL` | Shared runtime and migration configuration. |
| Google/Auth.js | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `AUTH_SECRET` | Server-only except the public application origin. |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRODUCT_ID`, `STRIPE_PRICE_ID` | Hosted Checkout currently uses the secret key server-side; the publishable key is not consumed by browser code. |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_ANALYSIS_MODEL`, `OPENAI_REWRITE_MODEL`, `OPENAI_EMBEDDING_MODEL` | Server-only. The embedding model is reserved; local winkNLP performs current partitioning. |
| Upload | `DOCUMENT_PARTITION_MODE` | `semantic` or `character`; default `semantic`. |

For local Stripe development, use the following complete setup. The global CLI
installation is required only once on each development device.

1. Install the Stripe CLI:

   ```bash
   npm install -g @stripe/cli
   ```

2. Log the CLI into the same Stripe account and test sandbox used by the local
   Stripe keys:

   ```bash
   stripe login
   ```

3. In the first terminal, start the Express server on port 3001:

   ```bash
   npm run dev:server
   ```

4. In a second terminal, start the webhook listener and leave this terminal
   running:

   ```powershell
   stripe listen --events checkout.session.completed,invoice.paid,invoice.payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted --forward-to http://localhost:3001/api/stripe/webhook
   ```

5. Find the listener output containing `Your webhook signing secret is
   whsec_...`. Copy only the complete `whsec_...` value into the local `.env`:

   ```env
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

6. Restart the Express process after saving `.env` so the updated signing
   secret is loaded. Keep the listener terminal open while testing webhook
   events.

`STRIPE_WEBHOOK_SECRET` must match the listener forwarding events to that local
server. It is not the production webhook endpoint secret. In production, the
public HTTPS endpoint's signing secret belongs in the cloud secret manager and
changes only when the endpoint secret is deliberately rotated or replaced.

### Phase 10: Merge Documentation And API Contracts

Keep `docs/beta/architecture.md` as the concise architecture index and update it
at the end of implementation. Preserve the focused existing documents:

- `docs/beta/backend-and-realtime.md` for persistence and Socket.IO;
- `docs/beta/stripe.md` for billing, entitlement, webhook, and security
  behavior; and
- this file for integration decisions and verification.

During the final Stripe documentation pass, remove any absolute claim that a
CLI signing secret changes on every listener restart or recreation. The local
`.env` must use the secret printed for the listener actually forwarding events;
the production Dashboard/Workbench endpoint has its own separately managed
signing secret.

Bring the useful content from `feature/ai-integration` into:

- `docs/beta/file-upload.md` for upload transport, validation, extraction,
  persistence, and resolver/partitioner boundaries;
- `docs/beta/block-partitioning.md` for sentence segmentation, balancing,
  semantic scoring, live splitting, and invariants; and
- `docs/beta/ai-integration.md` for analysis, rewriting, practice, security,
  persistence, Pro enforcement, rate limits, and failure behavior.

Correct the broken `document-preprocessing.md` references in the source upload
document to point to `block-partitioning.md`. Remove statements that claim
there is no subscription enforcement, that practice is a placeholder, or that
Socket.IO is unconnected once the merged behavior is verified.

Update `src/openapi.yml` with:

- the upload `partitionMode` field and validation;
- analysis, rewrite generation, rewrite acceptance, practice feedback, and
  practice acceptance endpoints;
- authentication, Pro-entitlement, stale-source, conflict, rate-limit, and
  provider-failure responses;
- request/response schemas with no server-only fields; and
- the sanitized Socket.IO event contract for committed AI resources and
  document mutations.

Do not duplicate implementation history or session transcripts as product
documentation. Each beta document should own one topic and link to the others.

## Verification Matrix

The merge is ready only when all applicable checks pass.

| Area | Required verification |
| --- | --- |
| Upload | TXT, Markdown, and DOCX; headings/lists/quotes/tables/marks; short and oversized paragraphs; semantic and character modes; invalid extension/UTF-8/size/mode. |
| Stable identity | Existing documents retain unchanged block IDs across open/save; live splits retain the first ID; revisions reject stale writes. |
| Database | Clean migration, 005-to-006 upgrade, checksum enforcement, constraints, cache uniqueness, cascades, and rollback. |
| Entitlement | Basic receives `403` for AI/document APIs; Pro succeeds; billing APIs remain available to Basic; revoked Pro sockets lose product/document rooms. |
| Analysis | Filter validation, immediate-neighbor scope, deterministic metrics, structured output, caching, prompt versioning, provider errors, and ownership. |
| Rewrites | Three tone allow-list, one-tone generation, caching/regeneration, stale source rejection, meaning-preservation guard, and atomic acceptance. |
| Practice | Real server response, validation, persistence/cache, stale source rejection, feedback rendering, and atomic acceptance of the user's revision. |
| Realtime | Same-user second session receives sanitized committed events; other users and Basic sessions do not; reconnect/refetch and duplicate events converge. |
| UI | Homepage/workspace visual parity, desktop/mobile controls, loading/error/empty states, long-content scrolling, keyboard use, and modal behavior. |
| Security | No secret in browser bundles, API responses, Socket.IO payloads, Git diffs, logs, fixtures, or documentation. |
| Tooling | Server syntax check, unit tests, integration tests, AI/partition tests, Stripe tests, and production frontend build. |

## Final Acceptance Criteria

The integration is complete when:

1. `feature/beta/merging` contains the combined behavior without restoring the
   old static schema or router-local upload parser.
2. Structured upload semantics and sentence-aware/local-semantic partitioning
   both work without changing existing document identities unexpectedly.
3. Analysis, rewrite, and practice workflows are real, persisted, ownership
   checked, rate-limited, source-hash checked, and Pro-only.
4. Accepted generated or user-written revisions are canonical database
   mutations with versions, progress, revisions, and post-commit realtime
   publication.
5. Stripe entitlement and all existing essential CRUD realtime flows continue
   to work.
6. The homepage and workspace retain the `feature/beta/merging` UI/UX.
7. `/test/` and `.env` remain ignored, real secrets remain untracked, and the
   tracked environment example contains only safe placeholders/defaults.
8. `src/openapi.yml` and all beta documentation describe the verified final
   implementation without redundant or obsolete claims.
9. All automated and manual verification in this document is complete before
   the merge commit is pushed.

## Explicitly Deferred

The following are outside this merge unless separately approved:

- token-by-token AI streaming or cross-session AI job progress;
- background queues or durable AI job execution;
- per-user token-credit accounting beyond Pro entitlement and rate limiting;
- replacing local winkNLP partitioning with embedding API calls;
- arbitrary browser-selected OpenAI models or prompts; and
- visual redesign of the homepage, workspace, or subscription page.
