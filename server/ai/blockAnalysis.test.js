import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANALYSIS_FILTER_DETAILS,
  BLOCK_ANALYSIS_PROMPT_VERSION,
  analysisFilterSignature,
  computeDeterministicMetrics,
  hashBlockText,
  normalizeAnalysisFilters,
  normalizeAnalysisResult,
} from './blockAnalysis.js';

test('uses the context-sensitive block analysis prompt', () => {
  assert.equal(BLOCK_ANALYSIS_PROMPT_VERSION, 'block-analysis-v6:nlp-v1');
  assert.deepEqual(Object.keys(ANALYSIS_FILTER_DETAILS), [
    'clarity',
    'conciseness',
    'academic-style',
    'flow',
  ]);
});

test('computes stable local metrics for an academic block', () => {
  const metrics = computeDeterministicMetrics(
    'However, the method was evaluated carefully. It may improve classification.',
  );

  assert.equal(metrics.sentenceCount, 2);
  assert.equal(metrics.wordCount, 10);
  assert.equal(metrics.averageSentenceLength, 5);
  assert.equal(metrics.passiveConstructionCount, 1);
  assert.equal(metrics.hedgeCount, 1);
  assert.equal(metrics.transitionCount, 1);
});

test('normalizes filters and creates a stable cache signature', () => {
  const filters = normalizeAnalysisFilters(['flow', 'clarity', 'invalid', 'clarity']);
  assert.deepEqual(filters, ['clarity', 'flow']);
  assert.equal(analysisFilterSignature(filters), 'clarity,flow');
});

test('hashes the exact block text', () => {
  assert.equal(hashBlockText('Same text.'), hashBlockText('Same text.'));
  assert.notEqual(hashBlockText('Same text.'), hashBlockText('Same text!'));
});

test('emits an explicit checked result for every requested filter', () => {
  const result = normalizeAnalysisResult({
    summary: 'Checked.',
    results: [{
      type: 'clarity',
      status: 'issues-found',
      issues: [{ evidence: 'wordy', explanation: 'Long.', suggestion: 'Shorten.' }],
    }],
    learningGoals: [],
  }, ['clarity', 'flow']);
  assert.deepEqual(result.results.map(({ type, status }) => ({ type, status })), [
    { type: 'clarity', status: 'issues-found' },
    { type: 'flow', status: 'clear' },
  ]);
});
