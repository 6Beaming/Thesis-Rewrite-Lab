const DEFAULT_CLUSTER_OPTIONS = Object.freeze({
  targetChars: 800,
  minChars: 450,
  maxChars: 1200,
  locale: 'en',
  paragraphBreak: 'single-newline',
});

const NON_TERMINAL_ABBREVIATION = /(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|fig|eq|ref|no|inc|ltd|co|e\.g|i\.e)\.|\b[A-Z]\.|\b(?:[A-Z]\.){2,})$/i;
const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+\S/;

function normalizeOptions(options = {}) {
  const targetChars = Math.max(1, Number(options.targetChars) || DEFAULT_CLUSTER_OPTIONS.targetChars);
  const minChars = Math.min(
    targetChars,
    Math.max(1, Number(options.minChars) || DEFAULT_CLUSTER_OPTIONS.minChars),
  );
  const maxChars = Math.max(
    targetChars,
    Number(options.maxChars) || DEFAULT_CLUSTER_OPTIONS.maxChars,
  );

  return {
    targetChars,
    minChars,
    maxChars,
    locale: options.locale || DEFAULT_CLUSTER_OPTIONS.locale,
    paragraphBreak: options.paragraphBreak === 'blank-line' ? 'blank-line' : 'single-newline',
    partitionMode: options.partitionMode === 'semantic' ? 'semantic' : 'character',
    semantic: options.semantic,
  };
}

function structuralSections(text, paragraphBreak) {
  const sections = [];
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');

  if (paragraphBreak === 'single-newline') {
    for (const rawLine of lines) {
      const paragraph = rawLine.replace(/\s+/g, ' ').trim();
      if (!paragraph) continue;

      sections.push({
        text: paragraph,
        standalone: MARKDOWN_HEADING.test(rawLine),
      });
    }
    return sections;
  }

  let paragraphLines = [];

  function finishParagraph() {
    const paragraph = paragraphLines.join(' ').replace(/\s+/g, ' ').trim();
    if (paragraph) sections.push({ text: paragraph, standalone: false });
    paragraphLines = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      finishParagraph();
      continue;
    }

    if (MARKDOWN_HEADING.test(rawLine)) {
      finishParagraph();
      sections.push({ text: line, standalone: true });
      continue;
    }

    paragraphLines.push(line);
  }

  finishParagraph();
  return sections;
}

function segmentSentences(text, locale = DEFAULT_CLUSTER_OPTIONS.locale) {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  const rawSegments = Array.from(segmenter.segment(String(text ?? '')), ({ segment }) => segment.trim())
    .filter(Boolean);
  const sentences = [];

  for (const segment of rawSegments) {
    const previous = sentences.at(-1);
    if (previous && NON_TERMINAL_ABBREVIATION.test(previous)) {
      sentences[sentences.length - 1] = `${previous} ${segment}`;
    } else {
      sentences.push(segment);
    }
  }

  return sentences;
}

function clusterSentences(sentences, options) {
  const blocks = [];
  let current = [];
  let currentLength = 0;

  function finishBlock() {
    if (!current.length) return;
    blocks.push(current.join(' '));
    current = [];
    currentLength = 0;
  }

  for (const sentence of sentences) {
    const projectedLength = currentLength + (current.length ? 1 : 0) + sentence.length;
    const reachedTarget = currentLength >= options.minChars && projectedLength > options.targetChars;
    const exceedsMaximum = current.length > 0 && projectedLength > options.maxChars;

    if (reachedTarget || exceedsMaximum) finishBlock();

    current.push(sentence);
    currentLength += (current.length > 1 ? 1 : 0) + sentence.length;
  }

  finishBlock();

  const finalBlock = blocks.at(-1);
  const previousBlock = blocks.at(-2);
  if (
    blocks.length > 1
    && finalBlock.length < options.minChars
    && previousBlock.length + 1 + finalBlock.length <= options.maxChars
  ) {
    blocks.splice(-2, 2, `${previousBlock} ${finalBlock}`);
  }

  return blocks;
}

// Creates character-balanced blocks without breaking a sentence or crossing an
// original newline/Markdown heading boundary. A single sentence may exceed
// maxChars because preserving the sentence is safer than cutting it mid-thought.
function clustering(text, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const blocks = [];

  for (const section of structuralSections(text, normalizedOptions.paragraphBreak)) {
    if (section.standalone) {
      blocks.push(section.text);
      continue;
    }

    const sentences = segmentSentences(section.text, normalizedOptions.locale);
    if (normalizedOptions.partitionMode === 'semantic') {
      const { semanticClusterSentences } = require('./semanticClustering.cjs');
      blocks.push(...semanticClusterSentences(sentences, normalizedOptions));
    } else {
      blocks.push(...clusterSentences(sentences, normalizedOptions));
    }
  }

  return blocks;
}

function characterBalancedRanges(text, options = {}) {
  const value = String(text ?? '');
  const ranges = [];
  let cursor = 0;

  for (const block of clustering(value, options)) {
    const start = value.indexOf(block, cursor);
    if (start < 0) continue;
    const end = start + block.length;
    ranges.push({ text: block, start, end });
    cursor = end;
  }

  return ranges;
}

module.exports = {
  DEFAULT_CLUSTER_OPTIONS,
  characterBalancedRanges,
  clustering,
  segmentSentences,
};
