import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor, Node } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import StarterKit from '@tiptap/starter-kit';
import {
  chooseNextUnfinishedBlock,
  convertLegacyTrackedBlocks,
  hasUnfinishedBlocks,
  insertSegmentedLineBreak,
  insertTextIntoSelectedSegment,
  isolateSelectionInTransaction,
  splitSegmentedTextBlock,
  trackedHeadingAttributes,
  trackedTextContentChanged,
} from './editorBlockCommands.js';

const BlockSegment = Node.create({
  name: 'blockSegment',
  group: 'inline',
  inline: true,
  content: '(text | hardBreak)*',
  addAttributes() {
    return {
      blockId: { default: null },
      status: { default: 'unprocessed' },
      length: { default: 0 },
      sourceType: { default: 'paragraph' },
      level: { default: null },
      fontSize: { default: '12pt' },
      lineHeight: { default: '2.0' },
      textIndent: { default: '0.5in' },
      formatOverrides: { default: [] },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-ai-block': 'true' }, 0];
  },
});

function createEditor(content) {
  return new Editor({
    extensions: [
      StarterKit.configure({ paragraph: false }),
      Paragraph,
      BlockSegment,
    ],
    content,
  });
}

test('Heading 1 uses the same tracked style and metadata as imported headings', () => {
  assert.deepEqual(
    trackedHeadingAttributes(1, { formatOverrides: ['fontFamily'] }),
    {
      sourceType: 'heading',
      level: 1,
      fontSize: '18pt',
      lineHeight: '1.15',
      textIndent: '0in',
      formatOverrides: ['fontFamily', 'textIndent', 'lineHeight', 'fontSize'],
    },
  );
});

test('Heading 1 command updates the structural node, tracked style, and bold mark together', () => {
  const text = 'Grammar and Sentence Editing Practice';
  const editor = createEditor({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'blockSegment',
        attrs: {
          blockId: 'block-1',
          status: 'processing',
          sourceType: 'paragraph',
          fontSize: '12pt',
        },
        content: [{ type: 'text', text }],
      }],
    }],
  });

  editor.commands.setTextSelection({ from: 2, to: text.length + 2 });
  const applied = editor.chain()
    .setHeading({ level: 1 })
    .updateAttributes(
      'blockSegment',
      trackedHeadingAttributes(1, editor.getAttributes('blockSegment')),
    )
    .setBold()
    .run();

  assert.equal(applied, true);
  const heading = editor.getJSON().content[0];
  const segment = heading.content[0];
  assert.equal(heading.type, 'heading');
  assert.equal(heading.attrs.level, 1);
  assert.equal(segment.attrs.sourceType, 'heading');
  assert.equal(segment.attrs.level, 1);
  assert.equal(segment.attrs.fontSize, '18pt');
  assert.equal(segment.attrs.lineHeight, '1.15');
  assert.equal(segment.attrs.textIndent, '0in');
  assert.deepEqual(segment.attrs.formatOverrides, ['textIndent', 'lineHeight', 'fontSize']);
  assert.deepEqual(segment.content[0].marks, [{ type: 'bold' }]);

  editor.destroy();
});

test('Enter command splits an inline processing block into two paragraphs', () => {
  const editor = createEditor({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'blockSegment',
        attrs: { blockId: 'block-1', status: 'processing' },
        content: [{ type: 'text', text: 'Hello world' }],
      }],
    }],
  });

  editor.commands.setTextSelection(7);
  const handled = splitSegmentedTextBlock(editor.state, editor.view.dispatch);
  const paragraphs = editor.getJSON().content;

  assert.equal(handled, true);
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0].content[0].attrs.blockId, 'block-1');
  assert.equal(paragraphs[0].content[0].attrs.length, 5);
  assert.equal(paragraphs[1].content[0].attrs.status, 'unprocessed');
  assert.notEqual(paragraphs[1].content[0].attrs.blockId, 'block-1');
  assert.equal(paragraphs[1].content[0].attrs.length, 6);
  assert.deepEqual(
    paragraphs.map((paragraph) => paragraph.content[0].content[0].text),
    ['Hello', ' world'],
  );
  assert.ok(paragraphs.every((paragraph) => paragraph.content[0].type === 'blockSegment'));

  editor.destroy();
});

test('Enter at the end creates an empty tracked block for the next paragraph', () => {
  const editor = createEditor({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'blockSegment',
        attrs: { blockId: 'block-1', status: 'processing' },
        content: [{ type: 'text', text: 'Hello world' }],
      }],
    }],
  });

  editor.commands.setTextSelection(13);
  const handled = splitSegmentedTextBlock(editor.state, editor.view.dispatch);
  const paragraphs = editor.getJSON().content;

  assert.equal(handled, true);
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[1].content[0].type, 'blockSegment');
  assert.equal(paragraphs[1].content[0].attrs.status, 'unprocessed');
  assert.notEqual(paragraphs[1].content[0].attrs.blockId, 'block-1');
  assert.equal(paragraphs[1].content[0].attrs.length, 0);
  assert.equal(editor.state.selection.from, 17);

  assert.equal(insertTextIntoSelectedSegment(editor.state, editor.view.dispatch, 'T'), true);
  assert.equal(paragraphs[1].content[0].content, undefined);
  assert.equal(editor.getJSON().content[1].content[0].content[0].text, 'T');
  assert.equal(
    editor.state.doc.resolve(editor.state.selection.from).parent.type.name,
    'blockSegment',
  );
  assert.equal(insertTextIntoSelectedSegment(editor.state, editor.view.dispatch, 'h'), true);
  assert.equal(editor.getJSON().content[1].content[0].content[0].text, 'Th');

  editor.destroy();
});

test('segmented Enter command leaves normal paragraphs to the default keymap', () => {
  const editor = createEditor({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text: 'Hello world' }],
    }],
  });

  editor.commands.setTextSelection(4);
  const handled = splitSegmentedTextBlock(editor.state, editor.view.dispatch);

  assert.equal(handled, false);
  assert.equal(editor.getJSON().content.length, 1);

  editor.destroy();
});

test('a normal Enter remains an inline line break inside the tracked block', () => {
  const editor = createEditor({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'blockSegment',
        attrs: { blockId: 'block-1', status: 'processing' },
        content: [{ type: 'text', text: 'Hello world' }],
      }],
    }],
  });

  editor.commands.setTextSelection(7);
  assert.equal(insertSegmentedLineBreak(editor.state, editor.view.dispatch), true);
  const content = editor.getJSON().content;
  assert.equal(content.length, 1);
  assert.deepEqual(content[0].content[0].content.map((node) => node.type), [
    'text',
    'hardBreak',
    'text',
  ]);
  assert.equal(content[0].content[0].attrs.blockId, 'block-1');
  editor.destroy();
});

test('a second consecutive Enter creates a hard structural boundary', () => {
  const editor = createEditor({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'blockSegment',
        attrs: { blockId: 'block-1', status: 'processing' },
        content: [{ type: 'text', text: 'Hello world' }],
      }],
    }],
  });
  editor.commands.setTextSelection(7);
  insertSegmentedLineBreak(editor.state, editor.view.dispatch);
  insertSegmentedLineBreak(editor.state, editor.view.dispatch);
  const paragraphs = editor.getJSON().content;
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0].content[0].attrs.blockId, 'block-1');
  assert.notEqual(paragraphs[1].content[0].attrs.blockId, 'block-1');
  assert.equal(paragraphs[1].content[0].attrs.status, 'processing');
  assert.equal(paragraphs[0].content[0].content[0].text, 'Hello');
  assert.equal(paragraphs[1].content[0].content[0].text, ' world');
  editor.destroy();
});

test('a partial selection is isolated before applying a list transform', () => {
  const editor = createEditor({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'blockSegment',
        attrs: { blockId: 'block-1', status: 'processing' },
        content: [{ type: 'text', text: 'Hello world' }],
      }],
    }],
  });

  editor.commands.setTextSelection({ from: 4, to: 8 });
  const applied = editor.chain()
    .command(({ state, tr }) => {
      assert.equal(isolateSelectionInTransaction(state, tr), true);
      return true;
    })
    .toggleBulletList()
    .run();

  assert.equal(applied, true);
  const content = editor.getJSON().content;
  assert.deepEqual(content.map((node) => node.type), [
    'paragraph',
    'bulletList',
    'paragraph',
  ]);
  assert.equal(content[0].content[0].content[0].text, 'He');
  assert.equal(
    content[1].content[0].content[0].content[0].content[0].text,
    'llo ',
  );
  assert.equal(content[2].content[0].content[0].text, 'world');
  editor.destroy();
});

test('converts legacy paragraph and heading blocks into block segments', () => {
  const normalized = convertLegacyTrackedBlocks({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: {
          blockId: 'legacy-paragraph',
          status: 'processing',
          lineHeight: '1.5',
        },
        content: [{ type: 'text', text: 'Legacy paragraph.' }],
      },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Legacy heading' }],
      },
      {
        type: 'paragraph',
        content: [{
          type: 'blockSegment',
          attrs: { blockId: 'current-block', status: 'processed' },
          content: [{ type: 'text', text: 'Current block.' }],
        }],
      },
    ],
  }, (index) => `generated-${index + 1}`);

  const [paragraph, heading, currentParagraph] = normalized.content;
  assert.equal(paragraph.attrs.blockId, undefined);
  assert.equal(paragraph.attrs.status, undefined);
  assert.equal(paragraph.attrs.lineHeight, '1.5');
  assert.equal(paragraph.content[0].type, 'blockSegment');
  assert.equal(paragraph.content[0].attrs.blockId, 'legacy-paragraph');
  assert.equal(paragraph.content[0].attrs.status, 'processing');
  assert.equal(paragraph.content[0].attrs.length, 17);

  assert.equal(heading.attrs.level, 2);
  assert.equal(heading.content[0].type, 'blockSegment');
  assert.equal(heading.content[0].attrs.blockId, 'generated-2');
  assert.equal(heading.content[0].attrs.paragraphIndex, 1);

  assert.equal(currentParagraph.content[0].type, 'blockSegment');
  assert.equal(currentParagraph.content[0].attrs.blockId, 'current-block');
  assert.equal(currentParagraph.content[0].attrs.status, 'processed');
});

test('next unfinished block wraps from the document end to an earlier block', () => {
  const blocks = [
    { blockId: 'block-1', status: 'processed', isEmpty: false },
    { blockId: 'block-2', status: 'skipped', isEmpty: false },
    { blockId: 'block-3', status: 'unprocessed', isEmpty: false },
    { blockId: 'block-4', status: 'processed', isEmpty: false },
    { blockId: 'block-5', status: 'processing', isEmpty: false },
  ];

  assert.equal(chooseNextUnfinishedBlock(blocks, 'block-5')?.blockId, 'block-3');
});

test('next unfinished block can return to an existing processing block', () => {
  const blocks = [
    { blockId: 'block-1', status: 'processed', isEmpty: false },
    { blockId: 'block-2', status: 'processing', isEmpty: false },
    { blockId: 'block-3', status: 'skipped', isEmpty: false },
    { blockId: 'block-4', status: 'unprocessed', isEmpty: false },
  ];

  assert.equal(chooseNextUnfinishedBlock(blocks, 'block-4')?.blockId, 'block-2');
});

test('completed documents have no unfinished block to select', () => {
  const blocks = [
    { blockId: 'block-1', status: 'processed', isEmpty: false },
    { blockId: 'block-2', status: 'skipped', isEmpty: false },
  ];

  assert.equal(hasUnfinishedBlocks(blocks), false);
  assert.equal(chooseNextUnfinishedBlock(blocks, 'block-2'), null);
});

test('partition eligibility ignores formatting and block-boundary identity changes', () => {
  const before = new Map([
    ['block-1', 'A complete sentence.'],
    ['block-2', ' Another sentence.'],
  ]);
  const formattingOnly = new Map([
    ['block-1', 'A complete sentence.'],
    ['block-2', ' Another sentence.'],
  ]);
  const reassignedBoundaries = new Map([
    ['replacement-block', 'A complete sentence. Another sentence.'],
  ]);
  const textEdit = new Map([
    ['block-1', 'A complete revised sentence.'],
    ['block-2', ' Another sentence.'],
  ]);

  assert.equal(trackedTextContentChanged(before, formattingOnly), false);
  assert.equal(trackedTextContentChanged(before, reassignedBoundaries), false);
  assert.equal(trackedTextContentChanged(before, textEdit), true);
});
