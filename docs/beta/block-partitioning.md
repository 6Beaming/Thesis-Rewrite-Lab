# Sentence-Aware and Semantic Block Partitioning

This document is the source of truth for how the application creates processing
blocks from uploaded documents and live editor input. Its main topics are:

- sentence-aware boundaries;
- character-balanced block sizes;
- local semantic boundary selection with winkNLP;
- paragraph preservation; and
- differences between upload-time and live-editor partitioning.

This pipeline is not generative AI. It does not call OpenAI, consume OpenAI
tokens, or create OpenAI charges. File transport, validation, extraction, and
database persistence are documented separately in
[`file-upload.md`](./file-upload.md). Model-driven workflows are documented in
[`ai-integration.md`](./ai-integration.md).

## Partitioning Pipeline

```text
Structural paragraph
    -> sentence segmentation
    -> abbreviation and decimal repair
    -> valid sentence-boundary candidates
    -> character-limit filtering
    -> optional winkNLP similarity scoring
    -> selected boundary near the character target
    -> one or more ordered processing blocks
```

Partitioning never crosses a structural paragraph boundary and never changes
sentence order.

## 1. Structural Paragraphs Come First

The partitioner receives one or more structural sections before it evaluates
sentence or topic boundaries. The source determines those sections:

| Source | Paragraph rule |
| --- | --- |
| `.txt` upload | Every non-empty newline begins a new paragraph. Repeated newlines do not create empty paragraphs. |
| `.md` upload | A blank line begins a paragraph. One newline wraps text inside the same paragraph. Markdown headings are standalone sections. |
| `.docx` upload | Word paragraph, heading, list, and container elements define sections. A soft `br` stays inside its section. |
| Live editor | Each TipTap paragraph created with Enter is a structural boundary. |

This ordering matters: character balance and semantic similarity may choose a
boundary inside a long paragraph, but they cannot join two source paragraphs or
move text between them.

## 2. Sentence-Aware Segmentation

The old approach of `split('.')` is not used by the main partitioning pipeline.
The server implementation in `scripts/lib/clustering.cjs` and browser
implementation in `src/lib/clustering.js` use `Intl.Segmenter` with sentence
granularity.

This recognizes sentence endings such as:

- periods;
- question marks; and
- exclamation marks.

A repair step avoids treating these periods as reliable sentence endings:

- common titles and abbreviations, such as `Dr.`, `Prof.`, `e.g.`, and `i.e.`;
- initials and initial groups; and
- decimal values such as `3.5`.

The result is an ordered list of complete sentences. All later size and
semantic decisions operate on boundaries between those sentences.

## 3. Character-Balanced Block Creation

The current defaults are:

| Setting | Value | Meaning |
| --- | ---: | --- |
| Target | 800 characters | Preferred block size. |
| Minimum | 450 characters | Lower balancing goal when structure permits it. |
| Maximum | 1,200 characters | Upper limit when a complete sentence permits it. |

The character-only algorithm builds a block in sentence order:

1. add the next complete sentence;
2. calculate the projected block length, including separating spaces;
3. finish the current block when it has reached the minimum and adding another
   sentence would move it past the target;
4. also finish before adding a sentence that would exceed the maximum; and
5. continue from the next sentence.

Afterward, an undersized final block is merged into the previous block only when
the merged result stays at or below the maximum.

### What the minimum and maximum mean

The limits are balancing rules, not permission to damage structure:

- a short source paragraph can produce a block below 450 characters;
- a final block can remain below 450 when merging would exceed 1,200;
- paragraph boundaries always take priority; and
- one sentence longer than 1,200 characters remains intact rather than being
  cut mid-sentence.

The algorithm therefore aims for blocks close to 800 characters while keeping
the author's paragraph and sentence structure valid.

## 4. Semantic Separation with winkNLP

Semantic mode uses the same paragraphs, sentence candidates, and hard character
rules. winkNLP only helps choose which valid sentence boundary is best when
several boundaries are available.

For each candidate boundary, the partitioner compares a small group of adjacent
sentences on the left and right.

### Text normalization

winkNLP transforms the context into comparable word-frequency representations:

1. **Tokenization** separates words and punctuation.
2. **Lemmatization** reduces related forms to a shared base form.

   ```text
   cats    -> cat
   running -> run
   studies -> study
   ```

3. **Stop-word removal** removes frequent terms that usually provide little
   topic information, including `the`, `is`, `of`, `and`, and `to`.
4. **Bag-of-words creation** counts the remaining lemmas.
5. **Cosine similarity** compares the bags on both sides of the boundary.

A similarity score nearer `1` means both sides use similar vocabulary. A score
nearer `0` suggests a stronger topic transition.

### Boundary scoring

Similarity is not the only criterion. Each candidate receives this combined
score:

```text
boundary score
    = adjacent-context similarity
    + distance-from-target penalty
    + undersized-final-block penalty
```

The partitioner chooses the lowest-scoring valid candidate. This favors a topic
change near 800 characters without creating an invalid or very small tail.

Semantic mode remains deterministic for the same text, options, JavaScript
runtime, and winkNLP model. It does not generate new content or infer a new
document order.

## 5. Character Mode Versus Semantic Mode

| Behavior | `character` | `semantic` |
| --- | --- | --- |
| Uses structural paragraphs | Yes | Yes |
| Uses complete sentence boundaries | Yes | Yes |
| Targets 800 characters | Yes | Yes |
| Enforces min/max when possible | Yes | Yes |
| Scores adjacent topics | No | Yes, with local winkNLP |
| Calls an external API | No | No |

`semantic` is the current default. `character` remains the simpler fallback.
The upload API accepts either mode through the `partitionMode` form field and
falls back to `DOCUMENT_PARTITION_MODE`, then `semantic`, when no mode is sent.

## 6. How Uploaded Files Are Partitioned

After the server extracts supported text and paragraph metadata, it calls
`clusteringWithMetadata()` for plain text and Markdown content. Each result
contains:

```text
text
paragraphIndex
blockIndexInParagraph
```

For `.docx`, the server uses `characterBalancedRanges()` so it can apply the
same calculated offsets to formatted TipTap text nodes. Supported bold, italic,
underline, and code marks remain attached to the corresponding text after a
split.

Upload partitioning processes the complete extracted document immediately. A
long paragraph can therefore be divided into several balanced blocks during the
initial import. The upload and persistence mechanics surrounding this call are
explained in [`file-upload.md`](./file-upload.md).

## 7. How Live Editor Input Is Partitioned

`DocumentEditor.jsx` applies the browser ESM implementation to text typed or
pasted after the document has opened.

The live path differs from initial upload intentionally:

1. the editor waits 450 milliseconds after typing stops;
2. it inspects existing tracked blocks rather than repartitioning the entire
   document;
3. it runs only when a block exceeds the 1,200-character maximum;
4. it lazily loads winkNLP and the English model only when partitioning is
   needed; and
5. it replaces that oversized block with the resulting inline block segments.

This avoids moving stable boundaries after every keystroke. It also keeps the
large winkNLP model out of the initial editor bundle.

When a live block is divided:

- the first resulting portion keeps the original block ID and status;
- additional portions receive new IDs and start as `unprocessed`;
- text typed at an inline boundary is first absorbed into a neighboring tracked
  block;
- a dedicated segmented-block Enter command creates a paragraph boundary that
  partitioning cannot cross, while normal paragraphs keep TipTap's default
  Enter behavior; and
- the structural partition transaction does not add a separate undo step.

The new structure becomes part of the next normal document save.

## 8. Paragraphs and Processing Blocks

A structural paragraph and a processing block are separate concepts. One long
paragraph may contain multiple blocks without gaining visible line breaks:

```text
TipTap paragraph
  -> inline blockSegment A
  -> separating space
  -> inline blockSegment B
```

`paragraphIndex` associates blocks with their source paragraph.
`createContentJson()` groups adjacent imported blocks with the same paragraph
index into one TipTap paragraph. Each `blockSegment` keeps its own UUID, status,
character length, and selection boundary.

This is why a block boundary can be visible in the editor without behaving like
a newline.

## 9. Important Edge Cases

- Empty input produces no clustering results; document creation supplies its
  own starter-text fallback.
- Repeated newlines do not create empty blocks.
- An oversized single sentence is kept intact.
- A paragraph shorter than the minimum is not merged across a paragraph
  boundary.
- Markdown single newlines do not create paragraph boundaries.
- Text entered between inline blocks is attached to a neighboring tracked block
  before length checks run.
- Live partitioning does not continually merge or rebalance every existing
  block; it splits only newly oversized blocks.

## Related Files

| File | Responsibility |
| --- | --- |
| `scripts/lib/clustering.cjs` | Server and CLI sentence-aware character balancing and structural metadata. |
| `scripts/lib/semanticClustering.cjs` | Server and CLI winkNLP boundary scoring. |
| `src/lib/clusteringOptions.js` | Lightweight browser target, minimum, and maximum defaults. |
| `src/lib/clustering.js` | Browser sentence segmentation and winkNLP semantic scoring. |
| `server/routers/documents.js` | Passes extracted upload content into the partitioners and preserves `.docx` mark ranges. |
| `server/models/blocks.js` | Creates block records and paragraph-preserving TipTap JSON. |
| `src/components/DocumentEditor.jsx` | Tracks and partitions oversized live input. |
| `scripts/process-upload.cjs` | Applies the server-style partitioning flow to CLI imports. |

## Verification

| Test file | Coverage |
| --- | --- |
| `scripts/lib/clustering.test.cjs` | Punctuation, abbreviations, decimals, paragraph rules, balancing, and oversized sentences. |
| `scripts/lib/semanticClustering.test.cjs` | Lemmas, stop words, similarity scoring, and semantic boundary choice. |
| `src/lib/clustering.test.js` | Browser sentence handling and semantic character balancing. |
| `src/lib/editorBlockCommands.test.js` | Enter splitting for inline processing blocks without intercepting normal paragraphs. |
| `server/models/blocks.test.js` | Multiple processing blocks remaining inside one structural paragraph. |

## Change Log

### 2026-07-12

- Refocused this document on block-partitioning behavior.
- Compared upload-time full-document partitioning with live-editor incremental
  partitioning.
- Moved file transport, extraction, validation, and persistence details to
  `file-upload.md`.
