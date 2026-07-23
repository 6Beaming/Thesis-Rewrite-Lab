import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizedBagOfWords,
  semanticClustering,
  segmentSentences,
} from './clustering.js';

test('browser clustering keeps abbreviations and complete sentences together', () => {
  assert.deepEqual(
    segmentSentences('Dr. Chen measured 3.5 samples. The study continued.'),
    ['Dr. Chen measured 3.5 samples.', 'The study continued.'],
  );
});

test('browser clustering uses winkNLP lemmas and stop-word removal', () => {
  const bag = normalizedBagOfWords('The cats are running and studies were completed.');
  assert.equal(bag.cat, 1);
  assert.equal(bag.run, 1);
  assert.equal(bag.study, 1);
  assert.equal(bag.the, undefined);
});

test('browser clustering creates sentence-aware character-balanced blocks', () => {
  const text = [
    'Cats chase mice around the quiet barn.',
    'Felines hunt small rodents every evening.',
    'The telescope records distant galaxies.',
    'Astronomers compare the collected starlight.',
  ].join(' ');
  const blocks = semanticClustering(text, { targetChars: 80, minChars: 55, maxChars: 110 });

  assert.equal(blocks.length, 2);
  assert.ok(blocks.every((block) => /[.!?]$/.test(block)));
  assert.equal(blocks.join(' '), text);
});
