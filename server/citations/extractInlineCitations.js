import { createCitationAnchor } from './citationAnchors.js';

const YEAR_PATTERN = /(?:19|20)\d{2}[a-z]?/iu;
const NUMERIC_CITATION = /\[\d+(?:\s*[-,]\s*\d+)*\]/gu;
const PARENTHETICAL = /\(([^()]*(?:19|20)\d{2}[a-z]?[^()]*)\)/gu;
const NARRATIVE = /([\p{Lu}][\p{L}'’-]*?(?:\s+et al\.)?)\s*\(((?:19|20)\d{2}[a-z]?)\)/gu;

function authorKey(label) {
  const primaryAuthor = String(label ?? '')
    .replace(/\bet al\.$/iu, '')
    .trim()
    .split(/\s+(?:&|and)\s+/iu)[0]
    .split(',')[0];
  return primaryAuthor
    .match(/[\p{L}'’-]+$/u)?.[0]
    ?.toLocaleLowerCase('en') ?? '';
}

function parentheticalParts(value) {
  const source = String(value ?? '');
  const parts = [];
  const separator = /\s*;\s*|\s*,\s*(?:as\s+cited\s+in|cited\s+by|qtd\.\s+in|quoted\s+in)\s+/giu;
  let cursor = 0;
  const appendPart = (start, end) => {
    const raw = source.slice(start, end);
    const leading = raw.match(/^\s*/u)?.[0].length ?? 0;
    const trailing = raw.match(/\s*$/u)?.[0].length ?? 0;
    const partStart = start + leading;
    const partEnd = Math.max(partStart, end - trailing);
    const partText = source.slice(partStart, partEnd);
    if (!partText) return;
    const yearMatch = partText.match(YEAR_PATTERN);
    if (!yearMatch) return;
    const authorLabel = partText
      .slice(0, yearMatch.index)
      .replace(/[,\s]+$/u, '')
      .trim();
    const key = authorKey(authorLabel);
    if (!key) return;
    parts.push({
      authorLabel,
      authorKey: key,
      year: yearMatch[0].toLocaleLowerCase('en'),
      partText,
      partStart,
      partEnd,
    });
  };
  for (const match of source.matchAll(separator)) {
    appendPart(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  appendPart(cursor, source.length);
  return parts;
}

function bibliographyAwareParts(value, references) {
  const source = String(value ?? '');
  const parts = [];
  let cursor = 0;
  const appendPart = (start, end) => {
    const candidate = source.slice(start, end);
    const trimmed = candidate.trim();
    const label = trimmed
      .replace(/\s+(?:p{1,2}\.\s*)?\d+(?:\s*[-–]\s*\d+)?$/iu, '')
      .trim();
    const key = authorKey(label);
    const reference = references.find((entry) => entry.authorKey === key);
    if (!reference) return;
    const leading = candidate.indexOf(trimmed);
    parts.push({
      authorLabel: label,
      authorKey: key,
      year: String(reference.parsed?.metadata?.year ?? '').toLocaleLowerCase('en'),
      partText: trimmed,
      partStart: start + Math.max(0, leading),
      partEnd: end,
    });
  };
  const separator = /\s*;\s*|\s*,\s*(?:as\s+cited\s+in|cited\s+by|qtd\.\s+in|quoted\s+in)\s+/giu;
  for (const match of source.matchAll(separator)) {
    appendPart(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  appendPart(cursor, source.length);
  return parts;
}

function anchoredCitation(documentId, block, match, details = {}) {
  const startCp = Array.from(block.text_content.slice(0, match.index)).length;
  const endCp = startCp + Array.from(match[0]).length;
  return {
    text: match[0],
    displayText: details.displayText ?? match[0],
    kind: details.kind ?? 'author-year',
    authorKey: details.authorKey ?? null,
    authorLabel: details.authorLabel ?? null,
    year: details.year ?? null,
    replaceable: details.replaceable ?? true,
    presentation: details.presentation ?? null,
    partText: details.partText ?? match[0],
    partStart: Number(details.partStart) || 0,
    partEnd: Number.isInteger(details.partEnd) ? details.partEnd : match[0].length,
    anchor: createCitationAnchor({
      documentId,
      block,
      citationStartCp: startCp,
      citationEndCp: endCp,
      originalText: match[0],
    }),
  };
}

export function extractInlineCitations(documentId, blocks, { references = [] } = {}) {
  return blocks.flatMap((block) => {
    const text = String(block.text_content ?? '');
    const citations = [];
    const occupied = [];

    for (const match of text.matchAll(PARENTHETICAL)) {
      const parts = parentheticalParts(match[1]);
      if (!parts.length) continue;
      occupied.push([match.index, match.index + match[0].length]);
      for (const part of parts) {
        citations.push(anchoredCitation(documentId, block, match, {
          ...part,
          displayText: `${part.authorLabel}, ${part.year}`,
          presentation: 'parenthetical',
          replaceable: parts.length === 1,
        }));
      }
    }

    for (const match of text.matchAll(NARRATIVE)) {
      if (occupied.some(([start, end]) => match.index >= start && match.index < end)) continue;
      const label = match[1].trim();
      citations.push(anchoredCitation(documentId, block, match, {
        authorLabel: label,
        authorKey: authorKey(label),
        year: match[2].toLocaleLowerCase('en'),
        partText: match[0],
        partStart: 0,
        partEnd: match[0].length,
        presentation: 'narrative',
      }));
    }

    for (const match of text.matchAll(/\(([^()]+)\)/gu)) {
      if (occupied.some(([start, end]) => match.index >= start && match.index < end)) continue;
      const parts = bibliographyAwareParts(match[1], references);
      if (!parts.length) continue;
      occupied.push([match.index, match.index + match[0].length]);
      for (const part of parts) {
        citations.push(anchoredCitation(documentId, block, match, {
          ...part,
          displayText: part.partText,
          kind: 'author-page',
          presentation: 'parenthetical',
          replaceable: parts.length === 1,
        }));
      }
    }

    for (const match of text.matchAll(NUMERIC_CITATION)) {
      citations.push(anchoredCitation(documentId, block, match, {
        kind: 'numeric',
        displayText: match[0],
      }));
    }
    return citations;
  });
}
