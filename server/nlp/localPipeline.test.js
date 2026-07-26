import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBlockLocally, partitionDocumentLocally } from './localPipeline.js';

test('local NLP partitioning preserves every source code point contiguously', () => {
  const text = 'First claim is supported. However, the second claim changes focus. Figure 2';
  const result = partitionDocumentLocally({
    structuralBlocks: [{ text, sourceType: 'paragraph' }],
    semanticProfile: 'high',
  });
  assert.equal(result.candidates.map((candidate) => candidate.text).join(''), text);
  assert.equal(result.semanticProfile, 'high');
  assert.ok(result.candidates.every((candidate) => (
    candidate.nlpAnalysis.textHash.length === 64
  )));
});

test('local NLP never marks a blocking diagnostic as rewrite eligible', () => {
  const result = analyzeBlockLocally({ text: 'This sentence has an unmatched ( delimiter.' });
  assert.equal(result.status, 'blocked');
  assert.equal(result.rewriteEligible, false);
  assert.ok(result.issues.some((issue) => issue.severity === 'blocking'));
});

test('live-style analysis reports obvious spelling and missing ending punctuation', () => {
  const result = analyzeBlockLocally({
    text: 'The study was sucessful becuase the evidence was clear',
    sourceType: 'paragraph',
  });

  assert.equal(result.status, 'warning');
  assert.deepEqual(
    result.issues.map((item) => item.code).sort(),
    ['MISSING_END_PUNCTUATION', 'SPELLING_TYPO', 'SPELLING_TYPO'],
  );
});

test('titles, bibliography entries, and low-information test lines are isolated and skipped', () => {
  const result = partitionDocumentLocally({
    structuralBlocks: [
      {
        text: 'Assignment 2: article 2 (cognitive behavioral therapy)',
        sourceType: 'heading',
      },
      { text: 'This is a new line.', sourceType: 'paragraph' },
      { text: 'Hello world!', sourceType: 'paragraph' },
      {
        text: 'Bress, J. N. (2024). A complete title. Journal, 7(8), 22-31.',
        sourceType: 'bibliographyEntry',
      },
    ],
  });

  assert.equal(result.candidates.length, 4);
  assert.ok(result.candidates.every((candidate) => candidate.initialStatus === 'skipped'));
  assert.equal(
    result.candidates.at(-1).text,
    'Bress, J. N. (2024). A complete title. Journal, 7(8), 22-31.',
  );
  assert.ok(result.candidates[1].reasonCodes.includes('LOW_INFORMATION_SENTENCE'));
});
