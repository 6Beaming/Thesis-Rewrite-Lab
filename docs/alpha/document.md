# Document Runtime Model

Last updated: 2026-07-06

This document describes the current frontend runtime model for document editing in the alpha branch. It reflects the code that exists today in:

- [src/components/DocumentEditor.jsx](/C:/Users/yyfxh/OneDrive/Desktop/project-thesis-rewriter/src/components/DocumentEditor.jsx)
- [src/pages/WorkspacePage.jsx](/C:/Users/yyfxh/OneDrive/Desktop/project-thesis-rewriter/src/pages/WorkspacePage.jsx)
- [src/services/documentsApi.js](/C:/Users/yyfxh/OneDrive/Desktop/project-thesis-rewriter/src/services/documentsApi.js)

This is the actual model now, not the intended future database schema.

## Overview

The current document system is maintained in three overlapping layers:

1. `TipTap editor state`
2. `workspaceDraft` React state in `WorkspacePage`
3. `selectedDocument` React state in `WorkspacePage`

Of these three, the practical runtime source of truth inside the workspace is:

- `workspaceDraft` for normalized block order, status, and current processing target
- TipTap for the live editable DOM/content

`selectedDocument` is mostly a derived document-shaped snapshot used by the rest of the page and by backend save/load APIs.

## Main Runtime States

### 1. `selectedDocument`

`selectedDocument` is the document-shaped object used by the workspace page and other page-level features.

Current effective shape:

```js
{
  id: string,
  title: string,
  academic_style: string,
  style_settings: {
    margin?: string,
    font?: string,
    fontFamily?: string,
    spacing?: string,
    lineHeight?: string,
    indentation?: string,
    textIndent?: string,
    fontSize?: string,
    pageNumber?: string,
  },
  content_json: TipTapDocJson,
  blocks: RuntimeBlock[],
  current_processing_block_id: string | null,
  snippet?: string,
  secondarySnippet?: string,
  completed_chars?: number,
  total_chars?: number,
  completed_rate?: number,
  created_at?: string,
  updated_at?: string,
}
```

Important note:

- `selectedDocument.blocks` usually excludes empty blocks, because `documentFromWorkspaceDraft()` filters `draft.blocks` with `!block.isEmpty`.

### 2. `workspaceDraft`

`workspaceDraft` is the most important document-specific runtime structure in the workspace. It is the normalized frontend model produced after editor changes, rewrite replacements, manual status changes, upload fallback generation, and document load.

Current shape:

```js
{
  contentJson: TipTapDocJson,
  blocks: RuntimeBlock[],
  currentProcessingBlockId: string | null,
  revision: number,
}
```

Semantics:

- `contentJson` is the full TipTap JSON after normalization.
- `blocks` is the frontend block inventory in document order.
- `currentProcessingBlockId` is the single block that should be highlighted as `processing`.
- `revision` is currently `Date.now()` and works like a cheap version stamp for rerender/sync, not a durable version.

### 3. `activeEditorBlock`

This tracks the block currently under the cursor/selection.

```js
{
  blockId: string | null,
  status: 'unprocessed' | 'processing' | 'processed' | 'skipped',
}
```

It is updated from TipTap selection changes and is used as a hint when deciding which block rewrite actions should apply to.

### 4. `editorContent`

`editorContent` is a cached copy of the latest content JSON held separately in workspace state.

```js
TipTapDocJson | null
```

It is not the main source of truth. It is used as a fallback when the editor ref cannot return a snapshot and the page still needs to compute the next document state.

## Block Model

Each tracked paragraph/heading is converted into a runtime block.

Current effective block shape:

```js
{
  id: string,
  blockId: string,
  document_id: string,
  block_index: number,
  order: number,
  node_type: 'paragraph' | 'heading',
  text: string,
  text_content: string,
  status: 'unprocessed' | 'processing' | 'processed' | 'skipped',
  isEmpty: boolean,
  length: number,
  char_length: number,
  attrs: {
    blockId: string,
    status: 'unprocessed' | 'processing' | 'processed' | 'skipped',
    length: number,
    lineHeight: string,
    textIndent: string,
    textAlign: string,
    fontFamily: string,
    fontSize: string,
    ...otherNodeAttrs
  },
  tiptap_node: TipTapNodeJson | null,
  contentIndex: number | null,
}
```

Important rules:

- Only `paragraph` and `heading` are treated as tracked text blocks.
- Lists, quotes, and other structures are not represented as first-class rewrite-status blocks unless they are realized as tracked paragraph/heading nodes during traversal.
- Empty tracked blocks remain in `workspaceDraft.blocks`, but they are excluded from many status decisions and from persisted `selectedDocument.blocks`.

## TipTap Node Attributes Used For Status Maintenance

Tracked text blocks carry document metadata directly in node attrs.

Current attrs added to paragraph/heading nodes:

```js
{
  blockId: string | null,
  status: 'unprocessed' | 'processing' | 'processed' | 'skipped',
  lineHeight: string,
  textIndent: string,
  textAlign: string,
  fontFamily: string,
  fontSize: string,
  length: number,
}
```

Rendered DOM gets:

```html
<p
  class="doc-block doc-block--processing"
  data-block-id="..."
  data-status="processing"
  style="line-height: ...; text-indent: ...; text-align: ...; font-family: ...; font-size: ..."
>
```

This is why block highlighting and scroll-to-processing can work directly against DOM selectors.

## Status Vocabulary

There are four statuses:

- `unprocessed`
- `processing`
- `processed`
- `skipped`

`normalizeBlockStatus()` forces unknown values back to `unprocessed`.

## Single-Processing Invariant

The editor tries to maintain this invariant:

- At most one non-empty tracked block may be `processing`.

This is enforced in two places:

1. `reconcileEditorBlocks()` inside `DocumentEditor`
2. `normalizeWorkspaceDraft()` inside `WorkspacePage`

Both passes correct invalid states by:

- demoting extra `processing` blocks to `unprocessed`
- preventing empty blocks from remaining `processing`
- promoting the first non-empty `unprocessed` block to `processing` when no valid processing block exists

Because both layers normalize, the system is resilient, but it also means the same mutation can be corrected twice in separate passes.

## How a Document Is Built

### Load / open

When a document enters the workspace:

1. `openWorkspace(document)` hydrates it
2. style settings are resolved
3. `draftFromDocument()` creates a normalized `workspaceDraft`
4. `selectedDocument` is rebuilt from the draft
5. the editor is reloaded with `editorReloadKey`

### Fallback generation

If a document does not yet have usable `content_json` or `blocks`, the page can synthesize them from:

- `fallbackWorkspaceContent()`
- uploaded plain text via `contentFromPlainText()`
- local demo documents in `localStorage`

## How Blocks Are Collected

There are two block collectors.

### In `DocumentEditor`

`collectTrackedBlocks(state)` traverses the live ProseMirror document and returns tracked paragraph/heading nodes in visual document order.

This is the editor-facing collector used to:

- create editor snapshots
- inspect current selection block
- normalize duplicate/missing block ids
- detect empty blocks

### In `WorkspacePage`

`extractRuntimeBlocksFromContent(document, contentJson, styleSettings)` traverses JSON content and reconstructs `RuntimeBlock[]`.

This is the page-facing collector used when:

- a document comes from backend or demo storage
- content needs to be re-normalized outside the live editor ref
- a fallback content mutation is computed from raw JSON

## Change Flow For Manual Editing

Manual typing flows like this:

1. TipTap content changes
2. `DocumentEditor.onUpdate()` fires
3. `reconcileEditorBlocks()` normalizes block ids and statuses
4. `createEditorSnapshot()` returns:
   - `contentJson`
   - `blocks`
   - `currentProcessingBlockId`
5. `onChange()` sends that payload to `WorkspacePage.handleEditorChange()`
6. `normalizeWorkspaceContent()` rebuilds:
   - normalized `workspaceDraft`
   - derived `selectedDocument`
7. page marks `workspaceDirty = true`

## Change Flow For Rewrite Replacement

Rewrite replacement flows differently:

1. user clicks a rewriting card
2. `handleRewriteCardClick()` runs magic animation, then calls `applyRewriteCard(card)`
3. `applyRewriteCard()` calls `applyStatusToCurrentProcessingBlock('processed', replacementText)`
4. that calls `documentEditorRef.current.applyCurrentBlockStatus(...)`
5. `DocumentEditor.applyCurrentBlockStatus()` mutates the live editor transaction:
   - marks target block `processed`
   - replaces target text with placeholder response
   - promotes the next non-empty `unprocessed` block to `processing`
   - moves selection near the next processing block when available
6. returned snapshot is normalized again in `WorkspacePage`
7. `workspaceDraft`, `selectedDocument`, `editorContent`, and `activeEditorBlock` are updated
8. rewrite cards are locked briefly, then reset for the next block or replaced by the congratulations card

## Change Flow For Status Dropdown / Disable

Manual status actions use the same editor imperative API.

### Dropdown

`EditorToolbar` calls `onBlockStatusChange(status)`.

That reaches:

- `DocumentEditor.setSelectedBlockStatus()`
- `DocumentEditor.applyCurrentBlockStatus({ status })`
- `WorkspacePage.handleEditorBlockStatusChange(...)`

### Disable current block

`disableCurrentRewriteBlock()` calls:

```js
applyStatusToCurrentProcessingBlock('skipped')
```

That marks the current processing block as `skipped`, advances processing to the next available block, and refreshes the rewriting cards.

## How `applyCurrentBlockStatus()` Works

This method in `DocumentEditor` is the key imperative mutation API for the workspace.

Inputs:

```js
{
  status,
  replacementText = null,
  targetBlockId = null
}
```

Selection strategy:

1. explicit `targetBlockId`
2. current selected non-empty `processing` or `unprocessed` block
3. first non-empty `processing` block
4. first non-empty `unprocessed` block

Status logic:

- `processing`
  - target becomes `processing`
  - all other `processing` blocks become `unprocessed`

- `processed` or `skipped`
  - target becomes that status
  - next non-empty `unprocessed` block becomes `processing`
  - old `processing` block is demoted if needed
  - optional `replacementText` overwrites target text content

- any other allowed status
  - target status is set directly

The function then returns a fresh snapshot built from the editor state.

## Edited-Block Reset Logic

The current rule is:

- if a previously `processed` or `skipped` block is manually edited, it becomes `unprocessed`

This rule is implemented in `reconcileEditorBlocks()` by comparing the previous paragraph text snapshot with the current node text.

Important exceptions:

- the reset is suppressed during rewrite/status application transactions
- the reset is also skipped for history transactions detected by `isHistoryTransaction(transaction)`

This is why:

- normal typing can reopen a completed block
- undo/redo of prior operations does not immediately re-mark restored processed blocks as `unprocessed`

## Undo / Redo Behavior

Current design:

- text replacements from rewrite application are done through editor transactions, so they enter TipTap history
- normalization-only metadata passes set `tr.setMeta('addToHistory', false)`, so cleanup does not spam undo history
- `Ctrl+Z` / `Ctrl+Y` and toolbar undo/redo go through TipTap history

Current practical result:

- manual edits and rewrite replacements both live in the same editor history stack
- block status cleanup is partly synchronized with history and partly recomputed after history steps
- this is much better than the earlier purely ad hoc approach, but it is still frontend reconciliation, not a durable event log

## Why `workspaceDraft` Exists

`workspaceDraft` is the page-level normalization layer that keeps document behavior stable when:

- the editor changes rapidly
- the page needs to save without re-reading raw DOM
- the page needs a document-shaped object for APIs and cards
- the app falls back from real backend data to local/demo content

It is effectively the bridge between:

- raw editor JSON
- backend request payloads
- homepage/workspace UI summaries

## Current Maintenance Rules

The current system tries to maintain these rules at all times:

1. every tracked non-empty block has a unique `blockId`
2. every tracked block has one of the four allowed statuses
3. only one non-empty block should be `processing`
4. if no valid processing block exists, the first non-empty `unprocessed` block becomes `processing`
5. editing a completed/skipped block reopens it as `unprocessed`, except during rewrite/status transactions and history transactions
6. rewrite application both changes text and changes status in one logical action
7. empty tracked blocks should not remain `processing`

## Current Weak Spots

Even after the refactor, the following limitations still exist because the system is maintained by live frontend normalization rather than a durable operation model:

- `workspaceDraft`, TipTap state, and `selectedDocument` are synchronized repeatedly, not truly unified
- empty paragraphs can still participate awkwardly in transient states before normalization settles them
- block ordering is based on traversal order of the current document tree, so unusual list/quote structures may not behave like a sentence/block system
- backend block-status API currently receives only `{ status }`; rewrite replacement text itself is not sent as a standalone block mutation API
- the runtime model is block-oriented, but the editor remains fully free-form, so arbitrary structure edits can produce edge cases

## Backend Relationship

For current workspace behavior:

- real save uses `saveDocument(documentId, payload)`
- block status sync uses `updateDocumentBlockStatus(documentId, blockId, status)`
- upload uses `uploadDocument(file, academicStyle)`

But the actual replacement-and-status orchestration still happens first on the frontend. The backend currently receives the resulting document save payload and some status patches; it is not the primary runtime authority for rewrite progression.

## Minimal Example

This is a simplified example of the current frontend runtime view:

```js
workspaceDraft = {
  contentJson: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: {
          blockId: 'doc-1-block-1',
          status: 'processed',
          lineHeight: '2.0',
          textIndent: '0.5in',
          textAlign: 'left',
          fontFamily: 'Times New Roman',
          fontSize: '12pt',
          length: 41,
        },
        content: [{ type: 'text', text: 'This is placeholder response of Rewriting Card 1.' }],
      },
      {
        type: 'paragraph',
        attrs: {
          blockId: 'doc-1-block-2',
          status: 'processing',
          lineHeight: '2.0',
          textIndent: '0.5in',
          textAlign: 'left',
          fontFamily: 'Times New Roman',
          fontSize: '12pt',
          length: 18,
        },
        content: [{ type: 'text', text: 'This is second line.' }],
      },
    ],
  },
  blocks: [
    {
      id: 'doc-1-block-1',
      blockId: 'doc-1-block-1',
      order: 0,
      node_type: 'paragraph',
      text: 'This is placeholder response of Rewriting Card 1.',
      status: 'processed',
      isEmpty: false,
      length: 48,
      char_length: 48,
      attrs: { ... }
    },
    {
      id: 'doc-1-block-2',
      blockId: 'doc-1-block-2',
      order: 1,
      node_type: 'paragraph',
      text: 'This is second line.',
      status: 'processing',
      isEmpty: false,
      length: 20,
      char_length: 20,
      attrs: { ... }
    },
  ],
  currentProcessingBlockId: 'doc-1-block-2',
  revision: 1751760000000,
}
```

## Practical Summary

Right now the document system is best understood like this:

- TipTap owns the live editable content
- `DocumentEditor` owns block-level normalization rules close to the editor
- `WorkspacePage` owns the canonical workspace draft and rewrite workflow state
- `selectedDocument` is the derived document object used for saving, listing, history, and page UI

That architecture is much more stable than the earlier loose local state, but it is still a frontend-first state machine rather than a database-first document model.
