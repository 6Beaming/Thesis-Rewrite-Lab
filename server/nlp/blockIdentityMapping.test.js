import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRepartitionedBlockIdentities } from './blockIdentityMapping.js';

test('repartition mapping preserves exact block ids and bumps changed boundaries', () => {
  const old = [
    {
      id: 'a',
      block_index: 0,
      text_content: 'One. ',
      partition_generation: 2,
      attrs: { paragraphIndex: 0 },
    },
    {
      id: 'b',
      block_index: 1,
      text_content: 'Two.',
      partition_generation: 2,
      attrs: { paragraphIndex: 0 },
    },
  ];
  const exact = mapRepartitionedBlockIdentities(old, [
    { paragraphIndex: 0, startCp: 0, endCp: 5, text: 'One. ' },
    { paragraphIndex: 0, startCp: 5, endCp: 9, text: 'Two.' },
  ]);
  assert.deepEqual(exact.map((item) => item.preserveId), ['a', 'b']);
  assert.deepEqual(exact.map((item) => item.partitionGeneration), [2, 2]);

  const merged = mapRepartitionedBlockIdentities(old, [
    { paragraphIndex: 0, startCp: 0, endCp: 9, text: 'One. Two.' },
  ]);
  assert.equal(merged[0].partitionGeneration, 3);
  assert.equal(merged[0].boundaryChanged, true);
});
