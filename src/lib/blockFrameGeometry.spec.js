import assert from 'node:assert/strict';
import test from 'node:test';
import {
  frameAtPoint,
  separateAdjacentBlockRects,
} from './blockFrameGeometry.js';

test('frameAtPoint resolves the expanded area of a block frame', () => {
  const block = { blockId: 'block-a' };
  const frames = [{
    blockElement: block,
    blockId: block.blockId,
    rects: [{ left: 10, top: 20, right: 80, bottom: 44 }],
  }];

  assert.equal(frameAtPoint(frames, 12, 22)?.blockElement, block);
  assert.equal(frameAtPoint(frames, 9, 22), null);
  assert.equal(frameAtPoint(frames, 9, 22, 1.5)?.blockElement, block);
});

test('separated adjacent frames keep a stable non-block gap for pointer hits', () => {
  const frames = separateAdjacentBlockRects([
    {
      blockId: 'block-a',
      rects: [{ left: 10, top: 20, right: 60, bottom: 44 }],
    },
    {
      blockId: 'block-b',
      rects: [{ left: 58, top: 20, right: 110, bottom: 44 }],
    },
  ]);

  assert.equal(frameAtPoint(frames, 30, 30)?.blockId, 'block-a');
  assert.equal(frameAtPoint(frames, 90, 30)?.blockId, 'block-b');
  assert.equal(frameAtPoint(frames, 59, 30), null);
});
