import { Decoration, DecorationSet } from '@tiptap/pm/view';

const SEVERITY_RANK = Object.freeze({ low: 1, medium: 2, high: 3 });
const FINISHED_BLOCK_STATUSES = new Set(['processed', 'skipped']);
const QUOTE_PAIRS = Object.freeze([
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
]);

function evidencePhrase(evidence) {
  const value = String(evidence ?? '').trim();
  const quotePair = QUOTE_PAIRS.find(([opening, closing]) => (
    value.length > 1 && value.startsWith(opening) && value.endsWith(closing)
  ));
  return quotePair ? value.slice(1, -1).trim() : value;
}

function occurrenceOffsets(text, phrase) {
  const offsets = [];
  let searchFrom = 0;

  while (searchFrom <= text.length - phrase.length) {
    const offset = text.indexOf(phrase, searchFrom);
    if (offset < 0) break;
    offsets.push(offset);
    searchFrom = offset + phrase.length;
  }

  if (offsets.length) return offsets;

  const lowerText = text.toLocaleLowerCase('en');
  const lowerPhrase = phrase.toLocaleLowerCase('en');
  searchFrom = 0;
  while (searchFrom <= lowerText.length - lowerPhrase.length) {
    const offset = lowerText.indexOf(lowerPhrase, searchFrom);
    if (offset < 0) break;
    offsets.push(offset);
    searchFrom = offset + lowerPhrase.length;
  }
  return offsets;
}

export function findAnalysisPhraseRanges(text, issues) {
  const sourceText = String(text ?? '');
  const rangesByPosition = new Map();

  for (const issue of Array.isArray(issues) ? issues : []) {
    const phrase = evidencePhrase(issue?.evidence);
    if (!phrase) continue;

    for (const from of occurrenceOffsets(sourceText, phrase)) {
      const to = from + phrase.length;
      const key = `${from}:${to}`;
      const existing = rangesByPosition.get(key);
      if (!existing || (SEVERITY_RANK[issue?.severity] ?? 0) > (SEVERITY_RANK[existing.issue?.severity] ?? 0)) {
        rangesByPosition.set(key, { from, to, issue });
      }
    }
  }

  return [...rangesByPosition.values()].sort((left, right) => (
    left.from - right.from || left.to - right.to
  ));
}

function documentRangeForTextRange(node, nodePosition, from, to) {
  let textOffset = 0;
  let documentFrom = null;
  let documentTo = null;

  node.descendants((child, relativePosition) => {
    if (!child.isText) return;

    const nextTextOffset = textOffset + child.text.length;
    if (documentFrom === null && from >= textOffset && from < nextTextOffset) {
      documentFrom = nodePosition + 1 + relativePosition + (from - textOffset);
    }
    if (documentTo === null && to > textOffset && to <= nextTextOffset) {
      documentTo = nodePosition + 1 + relativePosition + (to - textOffset);
    }
    textOffset = nextTextOffset;
  });

  return documentFrom !== null && documentTo !== null && documentFrom < documentTo
    ? { from: documentFrom, to: documentTo }
    : null;
}

export function buildAnalysisPhraseDecorations(state, highlights) {
  const highlightsByBlockId = new Map(
    (Array.isArray(highlights) ? highlights : [])
      .filter((highlight) => highlight?.blockId)
      .map((highlight) => [highlight.blockId, highlight]),
  );
  const decorations = [];

  state.doc.descendants((node, position) => {
    if (node.type.name !== 'blockSegment' || !node.attrs?.blockId) return;
    if (FINISHED_BLOCK_STATUSES.has(node.attrs.status)) return;

    const highlight = highlightsByBlockId.get(node.attrs.blockId);
    const blockText = node.textContent ?? '';
    if (!highlight || blockText !== highlight.sourceText) return;

    for (const range of findAnalysisPhraseRanges(blockText, highlight.issues)) {
      const documentRange = documentRangeForTextRange(node, position, range.from, range.to);
      if (!documentRange) continue;

      const severity = ['low', 'medium', 'high'].includes(range.issue?.severity)
        ? range.issue.severity
        : 'medium';
      decorations.push(Decoration.inline(documentRange.from, documentRange.to, {
        class: 'analysis-phrase-issue',
        'data-analysis-severity': severity,
        title: range.issue?.suggestion || range.issue?.explanation || 'This phrase may need improvement.',
      }));
    }
  });

  return DecorationSet.create(state.doc, decorations);
}
