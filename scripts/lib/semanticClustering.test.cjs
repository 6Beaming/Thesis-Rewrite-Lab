const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizedBagOfWords,
  semanticClusterSentences,
  semanticSimilarity,
} = require('./semanticClustering.cjs');

test('normalizes words with lemmatization and removes stop words', () => {
  const bag = normalizedBagOfWords('The cats are running with the other cats.');

  assert.equal(bag.cat, 2);
  assert.equal(bag.run, 1);
  assert.equal(bag.the, undefined);
});

test('scores related adjacent context above an unrelated topic transition', () => {
  const sentences = [
    'Household cats are common pets.',
    'These household pets often sleep indoors.',
    'Quantum physics studies particles and energy.',
    'Physics experiments measure particle energy.',
  ];

  const related = semanticSimilarity(sentences, 1, 1);
  const topicChange = semanticSimilarity(sentences, 2, 1);

  assert.ok(related > topicChange);
});

test('selects a topic transition while respecting character limits', () => {
  const sentences = [
    'Household cats are common pets that chase mice.',
    'These household pets often sleep indoors beside their owners.',
    'Quantum physics studies particles, waves, and measurable energy.',
    'Physics experiments measure particle energy under controlled conditions.',
  ];
  const options = {
    targetChars: 135,
    minChars: 40,
    maxChars: 180,
  };

  assert.deepEqual(semanticClusterSentences(sentences, options), [
    sentences.slice(0, 2).join(' '),
    sentences.slice(2).join(' '),
  ]);
});
