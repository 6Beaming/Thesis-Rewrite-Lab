import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PRACTICE_ATTEMPT_CHARS,
  PRACTICE_FEEDBACK_PROMPT_VERSION,
  findPracticeGuidanceConflicts,
  normalizePracticeAttempt,
  practiceGuidanceFromAnalysis,
} from './practiceFeedback.js';

test('uses the comparative Practice prompt contract', () => {
  assert.equal(PRACTICE_FEEDBACK_PROMPT_VERSION, 'practice-feedback-v3');
});

test('normalizes a non-empty practice attempt', () => {
  assert.equal(normalizePracticeAttempt('  My revised sentence.  '), 'My revised sentence.');
});

test('rejects missing, empty, and oversized practice attempts', () => {
  assert.equal(normalizePracticeAttempt(undefined), null);
  assert.equal(normalizePracticeAttempt('   '), null);
  assert.equal(normalizePracticeAttempt('a'.repeat(MAX_PRACTICE_ATTEMPT_CHARS + 1)), null);
});

test('passes prior block issues and learning goals into Practice guidance', () => {
  const guidance = practiceGuidanceFromAnalysis({
    id: 'analysis-1',
    promptVersion: 'block-analysis-v2',
    filters: ['passive'],
    ai: {
      issues: [{ type: 'passive', evidence: 'can be found' }],
      learningGoals: ['Use a concrete actor when changing to active voice.'],
    },
  });

  assert.deepEqual(guidance, {
    analysisId: 'analysis-1',
    promptVersion: 'block-analysis-v2',
    filters: ['passive'],
    issues: [{ type: 'passive', evidence: 'can be found' }],
    learningGoals: ['Use a concrete actor when changing to active voice.'],
  });
  assert.equal(practiceGuidanceFromAnalysis(null), null);
});

test('rejects a suggested phrase that restores wording flagged by analysis', () => {
  const analysis = {
    id: 'analysis-1',
    promptVersion: 'block-analysis-v2',
    filters: ['passive'],
    ai: {
      issues: [{ type: 'passive', evidence: 'can also be found' }],
      learningGoals: [],
    },
  };

  assert.deepEqual(findPracticeGuidanceConflicts({
    hints: [{ suggestedPhrase: 'Most theses can also be found' }],
  }, analysis), [{
    suggestedPhrase: 'Most theses can also be found',
    flaggedEvidence: 'can also be found',
  }]);
  assert.deepEqual(findPracticeGuidanceConflicts({
    hints: [{ suggestedPhrase: 'Institutional repositories provide access to most theses' }],
  }, analysis), []);
});
