import { hashNlpText, sliceCodePoints, stableFingerprint } from '../nlp/hash.js';

function sentenceRanges(text) {
  const chars = Array.from(String(text ?? ''));
  const ranges = [];
  let start = 0;
  for (let index = 0; index < chars.length; index += 1) {
    if (!/[.!?]/u.test(chars[index])) continue;
    let end = index + 1;
    while (end < chars.length && /\s/u.test(chars[end])) end += 1;
    ranges.push({ startCp: start, endCp: end });
    start = end;
  }
  if (start < chars.length) ranges.push({ startCp: start, endCp: chars.length });
  return ranges;
}

export function createCitationAnchor({
  documentId,
  block,
  citationStartCp,
  citationEndCp,
  originalText,
}) {
  const ranges = sentenceRanges(block.text_content);
  const sentenceIndex = Math.max(
    0,
    ranges.findIndex((range) => (
      citationStartCp >= range.startCp && citationStartCp <= range.endCp
    )),
  );
  const sentence = ranges[sentenceIndex] ?? {
    startCp: 0,
    endCp: Array.from(block.text_content).length,
  };
  return {
    documentId,
    blockId: block.id,
    blockTextHash: hashNlpText(block.text_content),
    partitionGeneration: Number(block.partition_generation),
    sentenceIndex,
    sentenceStartCp: sentence.startCp,
    sentenceEndCp: sentence.endCp,
    citationStartCp,
    citationEndCp,
    originalText,
    contextHash: stableFingerprint({
      before: sliceCodePoints(block.text_content, Math.max(0, citationStartCp - 32), citationStartCp),
      originalText,
      after: sliceCodePoints(block.text_content, citationEndCp, citationEndCp + 32),
    }),
  };
}

export function validateCitationAnchor(block, anchor) {
  if (
    !block
    || hashNlpText(block.text_content) !== anchor.blockTextHash
    || Number(block.partition_generation) !== Number(anchor.partitionGeneration)
  ) return { ok: false, code: 'STALE_CITATION_ANCHOR' };
  const current = sliceCodePoints(
    block.text_content,
    anchor.citationStartCp,
    anchor.citationEndCp,
  );
  if (current !== anchor.originalText) {
    return { ok: false, code: 'STALE_CITATION_ANCHOR' };
  }
  return { ok: true, block };
}
