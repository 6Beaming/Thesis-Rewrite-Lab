import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBlockRecords,
  createContentJson,
  normalizeContentJsonBlocks,
} from './blocks.js';

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

test('stores legacy paragraph blocks as block segments', () => {
  const normalized = normalizeContentJsonBlocks({
    type: 'doc',
    content: [{
      type: 'paragraph',
      attrs: {
        blockId: 'legacy-client-id',
        status: 'processing',
        lineHeight: '1.5',
      },
      content: [{ type: 'text', text: 'Legacy paragraph.' }],
    }],
  });

  const paragraph = normalized.contentJson.content[0];
  const blockSegment = paragraph.content[0];
  assert.equal(paragraph.type, 'paragraph');
  assert.equal(paragraph.attrs.blockId, undefined);
  assert.equal(paragraph.attrs.status, undefined);
  assert.equal(blockSegment.type, 'blockSegment');
  assert.equal(blockSegment.attrs.status, 'processing');
  assert.equal(normalized.blockEntries[0].tiptapNode.type, 'blockSegment');
});
