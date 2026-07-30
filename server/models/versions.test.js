import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalVersionText } from './versions.js';

test('canonicalVersionText ignores block state metadata and whitespace-only differences', () => {
  const before = [
    { text_content: 'First sentence.', status: 'unprocessed' },
    { text_content: 'Second sentence.', status: 'unprocessed' },
  ];
  const after = [
    { text_content: ' First   sentence. ', status: 'processing' },
    { text_content: '\nSecond sentence.\t', status: 'processed' },
  ];

  assert.equal(canonicalVersionText(before), canonicalVersionText(after));
});

test('canonicalVersionText detects actual document wording changes', () => {
  const before = [{ text_content: 'The original wording.' }];
  const after = [{ text_content: 'The revised wording.' }];

  assert.notEqual(canonicalVersionText(before), canonicalVersionText(after));
});

test('canonicalVersionText ignores repartitioned block boundaries', () => {
  const before = [{ text_content: 'One sentence. Another sentence.' }];
  const after = [
    { text_content: 'One sentence.' },
    { text_content: 'Another sentence.' },
  ];

  assert.equal(canonicalVersionText(before), canonicalVersionText(after));
});
