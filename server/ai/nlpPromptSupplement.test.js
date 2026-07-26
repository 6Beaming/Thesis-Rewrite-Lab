import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBlockLocally } from '../nlp/localPipeline.js';
import { persistedNlpSnapshot } from '../nlp/blockAggregation.js';
import { compileNlpRewriteSupplement } from './nlpPromptSupplement.js';

test('NLP rewrite supplement is deterministic and omits stale metadata', () => {
  const text = 'The teh result supports the model.';
  const analysis = analyzeBlockLocally({ text });
  const block = {
    text_content: text,
    ...Object.fromEntries(Object.entries(persistedNlpSnapshot(analysis)).map(([key, value]) => [
      key.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`),
      value,
    ])),
  };
  const first = compileNlpRewriteSupplement(block);
  const second = compileNlpRewriteSupplement(block);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.match(first.supplement, /typo|focus/iu);
  assert.equal(
    compileNlpRewriteSupplement({ ...block, text_content: `${text} changed` }).fingerprint,
    'none',
  );
});
