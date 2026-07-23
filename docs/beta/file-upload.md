# File Upload Flow

This document explains how a selected file travels from the React interface to
Express and PostgreSQL. The algorithms that divide extracted text into
sentence-aware, character-balanced, and semantic blocks are documented in
[`document-preprocessing.md`](./document-preprocessing.md).

No OpenAI API call occurs during file upload.

## End-to-End Flow

```text
User selects .txt, .md, or .docx
    -> React receives a browser File object
    -> FormData sends file, academic style, and partition mode
    -> POST /api/documents/upload
    -> session authentication
    -> Multer validates and buffers the file in memory
    -> format-specific extraction
    -> block partitioning
    -> UUID, status, length, and paragraph metadata creation
    -> TipTap content_json creation
    -> one PostgreSQL transaction stores document and blocks
    -> progress is calculated
    -> Initial import version is recorded
    -> complete document is returned to React
    -> React opens DocumentEditor
```

The normal upload path requires the local Express API and PostgreSQL database.

## 1. Browser File Selection

The file inputs in `HeaderActions.jsx` and `WorkspacePage.jsx` accept:

- `.txt`
- `.md`
- `.docx`

The older binary `.doc` format is explicitly rejected. After a selection, the
input value is cleared so the user can select the same file again later.

Both the home page and workspace call `uploadDocument()` from
`src/services/documentsApi.js`. It creates `FormData` containing:

| Field | Meaning |
| --- | --- |
| `file` | The browser `File` object and its bytes. |
| `academicStyle` | The current template, with APA as the normal default. |
| `partitionMode` | `semantic` by default or `character` when explicitly selected. |

`requestJson()` sends the form to `POST /api/documents/upload`. It does not set
`Content-Type` manually because the browser must generate the multipart
boundary.

## 2. Authentication and Upload Validation

`server/routers/index.js` loads the Auth.js session and runs `requireAuth` before
mounting the document router. Every stored upload is therefore associated with
the signed-in user.

`server/middlewares/upload.js` uses Multer memory storage:

- the maximum file size is 15 MiB;
- bytes are exposed through `req.file.buffer`; and
- no temporary disk file is created before parsing.

The document router effectively supports only `.txt`, `.md`, and `.docx`.
Missing files, unsupported types, legacy `.doc`, and invalid partition modes
produce request errors.

The accepted partition modes are `semantic` and `character`. If the form omits
the field, Express reads `DOCUMENT_PARTITION_MODE`; if it is also absent, the
mode defaults to `semantic`.

## 3. Format-Specific Extraction

### Plain text (`.txt`)

The UTF-8 buffer is converted directly to text. Every non-empty newline is
treated as a structural paragraph boundary.

### Markdown (`.md`)

The UTF-8 buffer is converted to text using Markdown paragraph rules: a blank
line separates paragraphs, one newline remains inside the same paragraph, and
Markdown headings form standalone sections.

### Word (`.docx`)

Mammoth first converts the Word buffer to HTML. `server/routers/documents.js`
recognizes:

- block tags: `p`, `div`, `li`, `h1`, `h2`, and `h3`;
- marks: bold, italic, underline, and code; and
- `br` as a soft line break inside the current block.

Heading and list elements receive basic font-size or indentation attributes.
After partitioning calculates text ranges, the router slices the formatted text
nodes at the same offsets so supported marks stay attached to their text.

If the HTML conversion produces no usable blocks, Mammoth extracts raw text and
the normal paragraph-aware partitioner handles it.

## 4. Calling the Partitioner

Text and Markdown uploads call `clusteringWithMetadata()`. Word uploads call
`characterBalancedRanges()` so formatting can be sliced with the same offsets.

The partitioner returns ordered block text and paragraph metadata. Its sentence,
character, and winkNLP behavior is described in
[`document-preprocessing.md`](./document-preprocessing.md).

## 5. Creating Editor Blocks

`createBlockRecords()` in `server/models/blocks.js` gives each imported block:

- a UUID;
- a sequential index;
- its text and supported TipTap content;
- its character length;
- paragraph and style attributes; and
- a processing status.

The first imported block starts as `processing`; subsequent blocks start as
`unprocessed`.

`createContentJson()` groups adjacent blocks sharing a `paragraphIndex` inside
one TipTap paragraph. This preserves source paragraphs even when a long
paragraph contains multiple processing blocks.

## 6. PostgreSQL Transaction

`createDocumentWithBlocks()` in `server/models/documents.js` performs the import
inside one database transaction:

1. insert the `documents` row and TipTap `content_json`;
2. store the original filename, MIME type, and original file bytes;
3. insert the `document_blocks` rows;
4. calculate total characters, completed characters, and completion rate; and
5. create the `Initial import` version.

If any step fails, the transaction rolls back the document and blocks together.
On success, the model reloads the complete document for the signed-in user.

## 7. Returning to the Frontend

The route returns:

```json
{
  "document": "complete document record with blocks and content_json"
}
```

The home page or workspace passes that document to `openWorkspace()`, and
`DocumentEditor` renders its TipTap content and tracked block statuses.

## Offline Demo Fallback

When the Express upload fails, `.txt` and `.md` may be opened as browser-local
demo documents. These records are not written to PostgreSQL.

The fallback currently does not match the main upload pipeline:

- `HomePage.jsx` still uses temporary period-only `split('.')` logic;
- `WorkspacePage.jsx` uses a simpler period-based sentence expression;
- paragraph and formatting preservation are limited; and
- `.docx` has no browser-only fallback because Mammoth runs on the server.

Use the running Express and PostgreSQL path when testing real upload and
partitioning behavior. Aligning or removing the demo fallback remains a
follow-up task.

## Related Files

| File | Responsibility |
| --- | --- |
| `src/components/HeaderActions.jsx` | Home-page file picker. |
| `src/pages/HomePage.jsx` | Starts home uploads and implements the local demo fallback. |
| `src/pages/WorkspacePage.jsx` | Starts workspace uploads and opens returned documents. |
| `src/services/documentsApi.js` | Builds upload `FormData`. |
| `src/services/request.js` | Sends multipart requests without overriding the boundary. |
| `server/routers/index.js` | Requires authentication before document routes. |
| `server/middlewares/upload.js` | Provides Multer memory storage and the 15 MiB limit. |
| `server/routers/documents.js` | Validates, extracts, partitions, and starts document creation. |
| `server/models/blocks.js` | Creates tracked blocks and TipTap JSON. |
| `server/models/documents.js` | Stores the import transactionally and returns the complete document. |
| `scripts/process-upload.cjs` | Provides an equivalent CLI import path for fixtures and local testing. |
