import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDocumentNlpSummary,
  scopeDocumentNlpSummary,
  visibleDocumentNlpSummary,
} from './documentNlpSummary.js';

test('normalizes a persisted document NLP summary', () => {
  assert.deepEqual(normalizeDocumentNlpSummary({
    blockCount: 6,
    passCount: 2,
    warningCount: 1,
    blockedCount: 1,
    skippedCount: 1,
    unknownCount: 1,
    warningIssueCount: 3,
    blockingIssueCount: 1,
    checkedAt: '2026-07-27T00:00:00.000Z',
  }), {
    blockCount: 6,
    passCount: 2,
    warningCount: 1,
    blockedCount: 1,
    skippedCount: 1,
    unknownCount: 1,
    warningIssueCount: 3,
    blockingIssueCount: 1,
    checkedAt: '2026-07-27T00:00:00.000Z',
  });
});

test('derives unknown blocks for an older summary that omitted them', () => {
  assert.equal(normalizeDocumentNlpSummary({
    blockCount: 5,
    passCount: 2,
    warningCount: 1,
    blockedCount: 0,
    skippedCount: 1,
  }).unknownCount, 1);
});

test('rejects values that cannot identify a document summary', () => {
  assert.equal(normalizeDocumentNlpSummary(null), null);
  assert.equal(normalizeDocumentNlpSummary([]), null);
});

test('never exposes a summary under a different document id', () => {
  const state = scopeDocumentNlpSummary('document-a', {
    blockCount: 1,
    passCount: 1,
  });
  assert.equal(visibleDocumentNlpSummary(state, 'document-b'), null);
  assert.equal(visibleDocumentNlpSummary(state, 'document-a').passCount, 1);
});
