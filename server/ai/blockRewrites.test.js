import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLOCK_REWRITE_PROMPT_VERSION,
  REWRITE_TONES,
  createRewritePreferenceContext,
  normalizeRewriteTone,
  rewriteOptionFromResult,
} from './blockRewrites.js';

test('accepts only the three supported rewrite tones', () => {
  for (const tone of REWRITE_TONES) assert.equal(normalizeRewriteTone(tone), tone);
  assert.equal(normalizeRewriteTone('casual'), null);
  assert.equal(normalizeRewriteTone(undefined), null);
});

test('preference snapshots produce stable cache identities and changes invalidate the cache', () => {
  const first = createRewritePreferenceContext({
    savedPreferences: {
      audienceKnowledge: 'expert',
      domainContext: 'cs_engineering',
    },
  });
  const same = createRewritePreferenceContext({
    savedPreferences: {
      domainContext: 'cs_engineering',
      audienceKnowledge: 'expert',
    },
  });
  const changed = createRewritePreferenceContext({
    savedPreferences: {
      audienceKnowledge: 'general',
      domainContext: 'cs_engineering',
    },
  });
  const disabled = createRewritePreferenceContext({
    savedPreferences: { audienceKnowledge: 'expert' },
    savedPreferencesEnabled: false,
  });

  assert.equal(first.promptVersion, same.promptVersion);
  assert.notEqual(first.promptVersion, changed.promptVersion);
  assert.match(first.promptVersion, /^block-rewrites-v1:writing-preferences-v1:/);
  assert.deepEqual(disabled.effectivePreferences, {});
  assert.equal(disabled.promptVersion, BLOCK_REWRITE_PROMPT_VERSION);
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
