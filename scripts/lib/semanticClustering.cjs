const winkNLP = require('wink-nlp');
const model = require('wink-eng-lite-web-model');
const its = require('wink-nlp/src/its.js');
const as = require('wink-nlp/src/as.js');
const similarity = require('wink-nlp/utilities/similarity.js');

const nlp = winkNLP(model);
const DEFAULT_SEMANTIC_OPTIONS = Object.freeze({
  contextSentences: 2,
  balanceWeight: 0.35,
  shortTailPenalty: 0.5,
});

function sentenceRangeLength(sentences, start, end) {
  return sentences
    .slice(start, end)
    .reduce((total, sentence, index) => total + sentence.length + (index ? 1 : 0), 0);
}

function normalizedBagOfWords(text) {
  const doc = nlp.readDoc(text);
  return doc.tokens()
    .filter((token) => token.out(its.type) === 'word' && !token.out(its.stopWordFlag))
    .out(its.lemma, as.bow);
}

function semanticSimilarity(sentences, boundary, contextSentences) {
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

// Finds low-similarity topic transitions near the requested character target.
// It never changes sentence order or cuts a sentence to satisfy a size limit.
function semanticClusterSentences(sentences, options) {
  const semanticOptions = {
    ...DEFAULT_SEMANTIC_OPTIONS,
    ...(options.semantic ?? {}),
  };
  const blocks = [];
  let start = 0;

  while (start < sentences.length) {
    const remainingLength = sentenceRangeLength(sentences, start, sentences.length);
    if (remainingLength <= options.maxChars) {
      blocks.push(sentences.slice(start).join(' '));
      break;
    }

    const candidates = [];
    for (let end = start + 1; end < sentences.length; end += 1) {
      const length = sentenceRangeLength(sentences, start, end);
      if (length > options.maxChars) break;
      if (length < options.minChars) continue;

      const tailLength = sentenceRangeLength(sentences, end, sentences.length);
      const semanticScore = semanticSimilarity(
        sentences,
        end,
        semanticOptions.contextSentences,
      );
      const balancePenalty = Math.abs(length - options.targetChars) / options.targetChars
        * semanticOptions.balanceWeight;
      const tailPenalty = tailLength < options.minChars
        ? semanticOptions.shortTailPenalty
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

module.exports = {
  DEFAULT_SEMANTIC_OPTIONS,
  normalizedBagOfWords,
  semanticClusterSentences,
  semanticSimilarity,
};
