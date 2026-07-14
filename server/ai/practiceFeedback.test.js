import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PRACTICE_ATTEMPT_CHARS,
  PRACTICE_FEEDBACK_PROMPT_VERSION,
  normalizePracticeAttempt,
} from './practiceFeedback.js';

test('uses the comparative Practice prompt contract', () => {
  assert.equal(PRACTICE_FEEDBACK_PROMPT_VERSION, 'practice-feedback-v2');
});

test('normalizes a non-empty practice attempt', () => {
  assert.equal(normalizePracticeAttempt('  My revised sentence.  '), 'My revised sentence.');
});

test('rejects missing, empty, and oversized practice attempts', () => {
  assert.equal(normalizePracticeAttempt(undefined), null);
  assert.equal(normalizePracticeAttempt('   '), null);
  assert.equal(normalizePracticeAttempt('a'.repeat(MAX_PRACTICE_ATTEMPT_CHARS + 1)), null);
});
