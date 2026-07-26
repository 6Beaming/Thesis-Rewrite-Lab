# Final Feature Merging Plan

Branch: `feature/final/merging`

Scope: integration of the document export module and the Support section on the homepage.

## 1. Current integration baseline

The merge must preserve the architecture documented in:

- `docs/final/existing-UI-UX-upgrades.md`;
- `docs/final/NLP-AI-MCP-cool-factors-upgrades.md`.

The current system has two synchronized document representations:

| Representation | Responsibility |
| --- | --- |
| `documents.content_json` | Canonical ordered Tiptap/ProseMirror structure and inline formatting |
| `document_blocks` | Workflow units for status, AI, language review, progress, and semantic partitioning |

Document-level formatting is stored in:

- `documents.academic_style`: APA, MLA, Chicago, or Customized;
- `documents.style_settings`: margins, font, font size, spacing, indentation, alignment defaults, and page-number position;
- structural-node and `blockSegment` attributes: effective paragraph formatting;
- inline text marks: bold, italic, underline, color, highlight, font family, font size, code, and other supported marks;
- `format_overrides`: which block properties intentionally differ from the global style.

The export module must not use `original_file` as its source. That field is only the originally uploaded file and does not contain later edits, accepted rewrites, citation changes, or template conversions.

## 2. Merge boundaries

### 2.1 Expected low-conflict extension points

The current UI already contains appropriate seams:

- `src/pages/homepageSupport.jsx` is the Support placeholder;
- `HomePage.jsx` already renders Support when `activePage === 'support'`;
- `HomeSidebar.jsx` already contains the Support navigation item;
- `DocumentMenu.jsx` already contains a disabled Export action.

Incoming work should extend these seams instead of creating a second homepage shell, document model, or routing hierarchy.

### 2.2 Likely conflict files

| File | Merge concern |
| --- | --- |
| `src/pages/HomePage.jsx` | New callbacks, notices, loading state, or Support rendering |
| `src/pages/homepageSupport.jsx` | Replacement of the placeholder |
| `src/components/DocumentMenu.jsx` | Export format menu and click propagation |
| `src/components/DocumentCard.jsx` | Passing the selected document to Export |
| `src/components/DocumentsSection.jsx` | Export callback propagation |
| `src/pages/WorkspacePage.jsx` | Optional export action and save-before-export behavior |
| `src/services/documentsApi.js` | Binary download request |
| `server/routers/documents.js` | Authenticated export endpoint |
| `src/styles/workspace.css` | Homepage, menu, modal, and responsive styles |
| `package.json` / lock file | Export dependencies; `docx` is already installed |

Resolve these files against the current branch rather than accepting one side wholesale. They also contain recent language review, template switching, revision, and responsive-layout behavior.

## 3. Data-structure alignment

### 3.1 Export source of truth

Export should load one current, owned, non-trashed document through the existing document model and construct an immutable snapshot:

```text
document ID
+ title
+ document revision
+ partition revision
+ academic style
+ normalized style settings
+ content_json
```

`content_json` determines visible order and formatting. `document_blocks` may be used for validation or legacy fallback, but it must not be concatenated as the primary export source because semantic blocks can split one paragraph into several workflow fragments.

### 3.2 Editor-only attributes

The following fields support the application but should not appear in exported files:

- block IDs and partition generations;
- Processing, Complete, Skipped, or resume status;
- AI change source and processing baselines;
- language-review status, issue payloads, hashes, and semantic anchors;
- temporary decorations or analysis highlights.

The exporter should flatten adjacent `blockSegment` nodes inside their structural parent while preserving their inline text and marks. A semantic partition boundary is not automatically a paragraph break.

### 3.3 Style normalization

The exporter and editor must share one style normalization contract:

```text
marginTop / marginRight / marginBottom / marginLeft
fontFamily
fontSize
lineHeight
textIndent
textAlign
pageNumber
```

Recommended integration change:

- extract the current normalization logic from `AcademicStylePanel.jsx` and `DocumentEditor.jsx` into a shared pure module such as `src/shared/documentStyle.js`;
- use the same defaults for the editor, saves, and export renderers;
- support legacy aliases such as `font`, `spacing`, `indentation`, and the former single `margin` value;
- let structural-node and inline values override the global default where they are explicitly stored.

No new export table is needed. Export is a read operation and should not change document revision, version history, block status, progress, or language-review state.

## 4. Backend architecture for Export

### 4.1 Proposed endpoint

```http
GET /api/documents/:id/export?format=docx|md|txt&revision=<current revision>
```

The endpoint should:

1. require the existing authenticated Pro document boundary;
2. validate the document UUID, format, and expected revision;
3. load the latest owned, non-trashed document;
4. return `409` if the requested revision is stale;
5. parse `content_json` into a neutral export AST;
6. render the requested format;
7. return a safe filename through `Content-Disposition`;
8. avoid any database mutation.

Suggested response types:

| Format | MIME type | Extension |
| --- | --- | --- |
| Word | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `.docx` |
| Markdown | `text/markdown; charset=utf-8` | `.md` |
| Plain text | `text/plain; charset=utf-8` | `.txt` |

### 4.2 Shared export AST

Do not write three unrelated recursive parsers. Parse Tiptap JSON once into a neutral structure:

```js
{
  title,
  revision,
  style,
  blocks: [
    {
      type: 'paragraph' | 'heading' | 'ordered-list' |
            'bullet-list' | 'blockquote' | 'page-break',
      level,
      attrs,
      children: [
        { type: 'text', text, marks },
        { type: 'hard-break' }
      ]
    }
  ]
}
```

The parser should explicitly handle:

- document and paragraph order;
- headings and levels;
- multiple `blockSegment` children in one paragraph;
- hard line breaks;
- bullet and ordered lists, including start/restart numbering;
- list items and nested structural children;
- blockquotes;
- page breaks;
- inline text marks;
- empty but intentional structural lines.

Unknown nodes should use a documented safe fallback: recursively preserve their text rather than silently dropping it.

Suggested backend modules:

```text
server/exports/documentAst.js
server/exports/styleNormalization.js
server/exports/renderDocx.js
server/exports/renderMarkdown.js
server/exports/renderText.js
server/exports/filename.js
```

### 4.3 DOCX rendering idea

The existing `docx` dependency can generate the Word file.

Mapping:

| Stored data | DOCX output |
| --- | --- |
| `style_settings` margins | Section page margins converted to twips |
| A4 editor page | A4 section size |
| font and font size | Document defaults, paragraph/run overrides |
| `lineHeight` | Word line-spacing value |
| `textIndent` | First-line indentation |
| `textAlign` | Paragraph alignment |
| heading level | Word heading level |
| bold/italic/underline/color/highlight | `TextRun` properties |
| hard break | Run break |
| ordered/bullet list | Word numbering configuration |
| page break | Word page break |
| page-number setting | Header/footer page-number field and alignment |

The exporter should use the effective stored paragraph attributes, not merely the selected template name. APA, MLA, Chicago, and Customized may all contain user-approved overrides.

Citation text requires no separate export pass. Template conversion already writes the selected reference and in-text citation forms into `content_json`; export should reproduce the stored document exactly.

### 4.4 Markdown rendering idea

Markdown should preserve semantic structure:

- headings become `#` through `######`;
- paragraphs remain separated by blank lines;
- ordered and bullet lists retain markers and nesting;
- blockquotes use `>`;
- bold, italic, strike, and code use Markdown delimiters;
- hard breaks use a Markdown hard-break convention;
- underline or highlight may use minimal inline HTML where plain Markdown has no equivalent;
- page breaks may use a documented HTML comment or horizontal separator.

Page margins, pagination, font family, font size, and line spacing have no portable Markdown equivalent. They should not be represented by misleading syntax. The content and semantic formatting remain correct even though page-layout fidelity is specific to DOCX.

Delimiter escaping must prevent source text from being accidentally reinterpreted as Markdown syntax.

### 4.5 Plain-text rendering idea

TXT export should:

- emit UTF-8;
- preserve text order;
- keep paragraph separation and hard breaks;
- retain readable list prefixes and numbering;
- keep heading text without visual mark syntax;
- represent page breaks as form-feed or a documented blank-line boundary;
- strip all editor-only metadata and inline styling.

Plain text promises content fidelity, not visual formatting fidelity.

### 4.6 Filename and error safety

The filename should be derived from the document title, with:

- path separators and control characters removed;
- reserved Windows names avoided;
- repeated whitespace normalized;
- a bounded length;
- fallback to `Untitled document`;
- an RFC-compatible UTF-8 `filename*` value.

Generation errors should return a safe JSON error before response streaming begins. Logs may include the document ID, revision, format, correlation ID, duration, and output size, but not the full document content.

## 5. Frontend integration for Export

### 5.1 Homepage document menu

Replace the disabled Export action with an accessible submenu or small modal offering:

- Word document (`.docx`);
- Markdown (`.md`);
- Plain text (`.txt`).

Event propagation must remain stopped so choosing Export does not open the document card. Track loading by document ID and format rather than disabling every document card.

The callback path should remain explicit:

```text
DocumentMenu
-> DocumentCard
-> DocumentsSection
-> HomePage
-> documentsApi
```

### 5.2 Binary client

`requestJson` assumes every response is JSON, so it should not be reused unchanged for downloads. Add a small authenticated `requestDownload` helper that:

- uses same-origin credentials;
- handles a JSON error response before reading the success body;
- reads the success response as a `Blob`;
- extracts the server filename;
- creates and clicks a temporary object URL;
- revokes the URL afterward.

### 5.3 Workspace export

If Export is also available inside the editor:

1. detect dirty editor state;
2. save the current `content_json`, style, and title through the existing serialized save flow;
3. export the returned revision;
4. show an error instead of exporting an older stored revision when saving fails.

Homepage exports already operate on stored documents and therefore do not require a save.

## 6. Support subpage alignment

### 6.1 Existing homepage architecture

Support is currently a homepage section, not a separate application shell:

```text
HomeSidebar support button
-> HomePage activePage = support
-> HomepageSupport
-> existing HomeShell header/sidebar/layout
```

The incoming feature should replace the placeholder content in `homepageSupport.jsx`. It should not duplicate `HomeShell`, create a second sidebar, or add document/workspace state.

A standalone `/support` route is unnecessary unless deep-linking is an explicit requirement. If deep-linking is added later, it should render the same component and preserve the existing authentication/subscription policy.

### 6.2 Data and backend requirements

Static help content, FAQs, troubleshooting, privacy explanations, and contact links need no database changes.

If the feature includes a contact form, it requires a separate reviewed design:

- authenticated user identity filled by the server;
- bounded subject/category/message fields;
- server-side validation and rate limiting;
- safe storage or an approved email provider;
- no document text attached by default;
- a privacy notice and delivery/failure feedback.

Support data must not be stored in `documents`, `document_blocks`, AI caches, or citation-result tables.

### 6.3 UI consistency

The Support section should reuse:

- `.home-main-inner` width and spacing;
- existing homepage card backgrounds, borders, radii, and shadows;
- existing button, focus, and notice styles;
- the homepage typography scale;
- the mobile sidebar and header behavior;
- accessible heading order.

Recommended content layout:

- one page title and short introduction;
- searchable or grouped FAQ cards;
- expandable questions using native `details`/`summary` where suitable;
- task-based links such as upload, editing, language review, citations, export, versions, and billing;
- a compact contact/help card;
- no workspace blackboard/card styling inside the homepage.

All interactive controls need visible keyboard focus, meaningful labels, and adequate touch targets. Support content should collapse to one column at the existing homepage breakpoint.

## 7. Merge order

1. Rebase or merge each incoming branch onto `feature/final/merging`.
2. Merge the Support component and styles first because it is largely isolated.
3. Merge the export parser and format renderers with unit tests.
4. Add the authenticated export route and binary client helper.
5. Connect homepage document-menu Export.
6. Connect optional workspace Export only through save-before-export.
7. Reconcile shared CSS and API changes manually.
8. Run the complete verification matrix before merging this branch onward.

No migration should be added unless the incoming implementation introduces persisted support requests. Current-document export itself requires no schema migration.

## 8. Required verification

### 8.1 Export tests

- ownership, authentication, trash state, invalid format, and stale revision;
- safe filenames and correct MIME/Content-Disposition headers;
- paragraphs containing several semantic `blockSegment` nodes export as one paragraph;
- headings, lists, blockquotes, hard breaks, and page breaks;
- Unicode, emoji, punctuation, links, and inline marks;
- APA, MLA, Chicago, and Customized settings;
- local paragraph and inline format overrides;
- bibliography and in-text citations remain unchanged;
- DOCX page margins, spacing, indentation, page numbering, and numbering XML;
- Markdown delimiter escaping and stable output;
- TXT UTF-8 content and readable list markers;
- no language-review, AI, or block-status metadata in output;
- export does not change revision, versions, progress, or realtime state.

### 8.2 Support tests

- sidebar selection and active styling;
- header actions hidden consistently with the current Support behavior;
- desktop and mobile layout;
- keyboard navigation and focus visibility;
- FAQ expansion and link behavior;
- no dependency on a selected document;
- no failure when realtime document data is unavailable.

### 8.3 Repository checks

```bash
npm run check:server
npm run test:ai
npm run test:unit
npm run build
```

Run database integration tests when the configured PostgreSQL test databases are available:

```bash
npm run test:integration
```

## 9. Merge acceptance rules

The combined feature is ready only when:

1. Export uses current persisted `content_json`, never the original upload.
2. Workflow block boundaries do not create false paragraph breaks.
3. DOCX reproduces effective page, paragraph, and inline formatting.
4. Markdown and TXT document their intentional layout limitations.
5. Export requires ownership and cannot export stale or trashed content.
6. Export is read-only and creates no version or document mutation.
7. Workspace export saves dirty state before download.
8. Support remains inside the shared homepage shell.
9. Support introduces no document-schema coupling.
10. Existing language review, AI, citation, template switching, saving, responsive layout, and realtime behavior continue to pass.

