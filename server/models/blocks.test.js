import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlockRecords, createContentJson } from './blocks.js';

test('keeps multiple AI blocks inside their original paragraph', () => {
  const records = createBlockRecords([
    { text: 'First semantic block.', attrs: { paragraphIndex: 0 } },
    { text: 'Second semantic block.', attrs: { paragraphIndex: 0 } },
    { text: 'A different paragraph.', attrs: { paragraphIndex: 1 } },
  ]);
  const content = createContentJson(records);

  assert.equal(content.content.length, 2);
  assert.deepEqual(content.content[0].content.map((node) => node.type), [
    'blockSegment',
    'text',
    'blockSegment',
  ]);
  assert.equal(content.content[0].content[1].text, ' ');
  assert.equal(content.content[0].content[0].attrs.status, 'processing');
  assert.equal(content.content[0].content[2].attrs.status, 'unprocessed');
  assert.equal(content.content[1].content[0].type, 'blockSegment');
});
