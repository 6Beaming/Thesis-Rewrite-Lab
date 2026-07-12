import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';
import its from 'wink-nlp/src/its.js';
import as from 'wink-nlp/src/as.js';
import similarity from 'wink-nlp/utilities/similarity.js';
import { DEFAULT_CLUSTER_OPTIONS } from './clusteringOptions.js';

export { DEFAULT_CLUSTER_OPTIONS } from './clusteringOptions.js';

const DEFAULT_SEMANTIC_OPTIONS = Object.freeze({
  contextSentences: 2,
  balanceWeight: 0.35,
  shortTailPenalty: 0.5,
});
const NON_TERMINAL_ABBREVIATION = /(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|fig|eq|ref|no|inc|ltd|co|e\.g|i\.e)\.|\b[A-Z]\.|\b(?:[A-Z]\.){2,})$/i;
const nlp = winkNLP(model);

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
    semantic: { ...DEFAULT_SEMANTIC_OPTIONS, ...(options.semantic ?? {}) },
  };
}

export function segmentSentences(text, locale = DEFAULT_CLUSTER_OPTIONS.locale) {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  const rawSegments = Array.from(
    segmenter.segment(String(text ?? '')),
    ({ segment }) => segment.trim(),
  ).filter(Boolean);
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

function sentenceRangeLength(sentences, start, end) {
  return sentences
    .slice(start, end)
    .reduce((total, sentence, index) => total + sentence.length + (index ? 1 : 0), 0);
}

export function normalizedBagOfWords(text) {
  const doc = nlp.readDoc(text);
  return doc.tokens()
    .filter((token) => token.out(its.type) === 'word' && !token.out(its.stopWordFlag))
    .out(its.lemma, as.bow);
}

export function semanticSimilarity(sentences, boundary, contextSentences = 2) {
  const leftText = sentences
    .slice(Math.max(0, boundary - contextSentences), boundary)
    .join(' ');
  const rightText = sentences
    .slice(boundary, Math.min(sentences.length, boundary + contextSentences))
    .join(' ');
  const left = normalizedBagOfWords(leftText);
  const right = normalizedBagOfWords(rightText);

  if (!Object.keys(left).length || !Object.keys(right).length) return 1;
  return similarity.bow.cosine(left, right);
}

export function semanticClusterSentences(sentences, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const blocks = [];
  let start = 0;

  while (start < sentences.length) {
    const remainingLength = sentenceRangeLength(sentences, start, sentences.length);
    if (remainingLength <= normalizedOptions.maxChars) {
      blocks.push(sentences.slice(start).join(' '));
      break;
    }

    const candidates = [];
    for (let end = start + 1; end < sentences.length; end += 1) {
      const length = sentenceRangeLength(sentences, start, end);
      if (length > normalizedOptions.maxChars) break;
      if (length < normalizedOptions.minChars) continue;

      const tailLength = sentenceRangeLength(sentences, end, sentences.length);
      const semanticScore = semanticSimilarity(
        sentences,
        end,
        normalizedOptions.semantic.contextSentences,
      );
      const balancePenalty = Math.abs(length - normalizedOptions.targetChars)
        / normalizedOptions.targetChars
        * normalizedOptions.semantic.balanceWeight;
      const tailPenalty = tailLength < normalizedOptions.minChars
        ? normalizedOptions.semantic.shortTailPenalty
        : 0;

      candidates.push({
        end,
        length,
        score: semanticScore + balancePenalty + tailPenalty,
      });
    }

    if (!candidates.length) {
      blocks.push(sentences[start]);
      start += 1;
      continue;
    }

    candidates.sort((a, b) => a.score - b.score || a.length - b.length);
    const boundary = candidates[0].end;
    blocks.push(sentences.slice(start, boundary).join(' '));
    start = boundary;
  }

  return blocks;
}

export function semanticClustering(text, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  return semanticClusterSentences(
    segmentSentences(text, normalizedOptions.locale),
    normalizedOptions,
  );
}
