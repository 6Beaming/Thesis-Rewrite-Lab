import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REWRITE_TONES,
  normalizeRewriteTone,
  rewriteOptionFromResult,
} from './blockRewrites.js';

test('accepts only the three supported rewrite tones', () => {
  for (const tone of REWRITE_TONES) assert.equal(normalizeRewriteTone(tone), tone);
  assert.equal(normalizeRewriteTone('casual'), null);
  assert.equal(normalizeRewriteTone(undefined), null);
});

test('adds the requested stable tone identifier to a structured rewrite', () => {
  const result = {
    rewrittenText: 'Accessible',
    explanation: 'Explanation',
    changes: ['Change'],
    meaningPreserved: true,
    warnings: [],
  };

  assert.deepEqual(rewriteOptionFromResult(result, 'accessible-concise'), {
    tone: 'accessible-concise',
    ...result,
  });
});
