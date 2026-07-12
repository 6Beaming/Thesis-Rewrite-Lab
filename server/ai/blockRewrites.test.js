import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REWRITE_TONES,
  normalizeRewriteTone,
  rewriteOptionsFromResult,
} from './blockRewrites.js';

test('accepts only the three supported rewrite tones', () => {
  for (const tone of REWRITE_TONES) assert.equal(normalizeRewriteTone(tone), tone);
  assert.equal(normalizeRewriteTone('casual'), null);
  assert.equal(normalizeRewriteTone(undefined), null);
});

test('maps structured rewrite fields to stable tone identifiers', () => {
  const option = (rewrittenText) => ({
    rewrittenText,
    explanation: 'Explanation',
    changes: ['Change'],
    meaningPreserved: true,
    warnings: [],
  });
  const result = {
    formalAcademic: option('Formal'),
    persuasiveArgumentative: option('Persuasive'),
    accessibleConcise: option('Accessible'),
  };

  assert.deepEqual(
    rewriteOptionsFromResult(result).map(({ tone, rewrittenText }) => ({ tone, rewrittenText })),
    [
      { tone: 'formal-academic', rewrittenText: 'Formal' },
      { tone: 'persuasive-argumentative', rewrittenText: 'Persuasive' },
      { tone: 'accessible-concise', rewrittenText: 'Accessible' },
    ],
  );
  assert.deepEqual(rewriteOptionsFromResult(result, 'accessible-concise'), [{
    tone: 'accessible-concise',
    ...result.accessibleConcise,
  }]);
});
