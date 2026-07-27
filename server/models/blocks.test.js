import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  createBlockRecords,
  createContentJson,
  normalizeContentJsonBlocks,
  replaceBlocksFromContentJson,
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

test('preserves resolved headings and source-format overrides in editor JSON', () => {
  const records = createBlockRecords([
    {
      text: 'Recovered source heading',
      attrs: {
        paragraphIndex: 0,
        sourceType: 'heading',
        level: 2,
        fontSize: '18pt',
        formatOverrides: ['fontSize'],
      },
    },
    {
      text: 'Ordinary source paragraph.',
      attrs: { paragraphIndex: 1, sourceType: 'paragraph' },
    },
  ]);
  const content = createContentJson(records);

  assert.equal(content.content[0].type, 'heading');
  assert.equal(content.content[0].attrs.level, 2);
  assert.equal(content.content[0].attrs.outlineLevel, '2');
  assert.deepEqual(content.content[0].content[0].attrs.formatOverrides, ['fontSize']);
  assert.equal(content.content[1].type, 'paragraph');
  assert.equal(content.content[1].attrs.outlineLevel, 'none');
});

test('full snapshot replacement clears AI state for every Skipped block', async () => {
  const documentId = randomUUID();
  const skippedBlockId = randomUUID();
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return { rows: [] };
    },
  };

  const replaced = await replaceBlocksFromContentJson(client, documentId, {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'blockSegment',
        attrs: {
          blockId: skippedBlockId,
          status: 'skipped',
          resumeStatus: null,
          processingBaselineText: null,
        },
        content: [{ type: 'text', text: 'Skipped source.' }],
      }],
    }],
  });

  for (const table of [
    'block_rewrite_options',
    'block_analyses',
    'block_practice_attempts',
  ]) {
    const deletion = calls.find(({ sql }) => sql.startsWith(`delete from ${table}`));
    assert.deepEqual(deletion?.params, [documentId, [skippedBlockId]]);
  }
  const cancellation = calls.find(({ sql }) => (
    sql.startsWith('update block_rewrite_jobs')
    && sql.includes("safe_error_code = 'BLOCK_SKIPPED'")
  ));
  assert.deepEqual(cancellation?.params, [documentId, [skippedBlockId]]);

  const summaryUpdate = calls.find(({ sql }) => (
    sql === 'update documents set nlp_document_snapshot = $2::jsonb where id = $1'
  ));
  assert.deepEqual(summaryUpdate?.params, [
    documentId,
    JSON.stringify(replaced.nlpSummary),
  ]);
  assert.equal(replaced.nlpSummary.blockCount, 0);
});
