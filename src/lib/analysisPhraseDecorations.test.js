import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor, Node } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import StarterKit from '@tiptap/starter-kit';
import {
  buildAnalysisPhraseDecorations,
  findAnalysisPhraseRanges,
} from './analysisPhraseDecorations.js';

const BlockSegment = Node.create({
  name: 'blockSegment',
  group: 'inline',
  inline: true,
  content: 'text*',
  addAttributes() {
    return {
      blockId: { default: null },
      status: { default: 'unprocessed' },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-ai-block': 'true' }, 0];
  },
});

function createEditor(statuses = {}) {
  return new Editor({
    extensions: [
      StarterKit.configure({ paragraph: false }),
      Paragraph,
      BlockSegment,
    ],
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{
            type: 'blockSegment',
            attrs: { blockId: 'block-1', status: statuses['block-1'] },
            content: [{ type: 'text', text: 'The vague phrase appears twice: vague phrase.' }],
          }],
        },
        {
          type: 'paragraph',
          content: [{
            type: 'blockSegment',
            attrs: { blockId: 'block-2', status: statuses['block-2'] },
            content: [{ type: 'text', text: 'This block is concise.' }],
          }],
        },
      ],
    },
  });
}

test('finds every exact evidence phrase and removes wrapping quotation marks', () => {
  const ranges = findAnalysisPhraseRanges(
    'The vague phrase appears twice: vague phrase.',
    [{ evidence: '“vague phrase”', severity: 'medium' }],
  );

  assert.deepEqual(ranges.map(({ from, to }) => ({ from, to })), [
    { from: 4, to: 16 },
    { from: 32, to: 44 },
  ]);
});

test('decorates matching issue evidence in every analyzed block', () => {
  const editor = createEditor();
  const decorationSet = buildAnalysisPhraseDecorations(editor.state, [
    {
      blockId: 'block-1',
      sourceText: 'The vague phrase appears twice: vague phrase.',
      issues: [{ evidence: 'vague phrase', severity: 'high', suggestion: 'Use a precise term.' }],
    },
    {
      blockId: 'block-2',
      sourceText: 'This block is concise.',
      issues: [{ evidence: 'is concise', severity: 'low' }],
    },
  ]);
  const decorations = decorationSet.find();

  assert.equal(decorations.length, 3);
  assert.deepEqual(
    decorations.map((decoration) => editor.state.doc.textBetween(decoration.from, decoration.to)),
    ['vague phrase', 'vague phrase', 'is concise'],
  );
  assert.ok(decorations.every((decoration) => decoration.type.attrs.class === 'analysis-phrase-issue'));

  editor.destroy();
});

test('does not decorate an edited block whose text no longer matches its analysis', () => {
  const editor = createEditor();
  const decorationSet = buildAnalysisPhraseDecorations(editor.state, [{
    blockId: 'block-1',
    sourceText: 'An older version of this block.',
    issues: [{ evidence: 'older version', severity: 'medium' }],
  }]);

  assert.equal(decorationSet.find().length, 0);

  editor.destroy();
});

test('does not decorate skipped or processed blocks', () => {
  const editor = createEditor({
    'block-1': 'skipped',
    'block-2': 'processed',
  });
  const decorationSet = buildAnalysisPhraseDecorations(editor.state, [
    {
      blockId: 'block-1',
      sourceText: 'The vague phrase appears twice: vague phrase.',
      issues: [{ evidence: 'vague phrase', severity: 'high' }],
    },
    {
      blockId: 'block-2',
      sourceText: 'This block is concise.',
      issues: [{ evidence: 'is concise', severity: 'low' }],
    },
  ]);

  assert.equal(decorationSet.find().length, 0);

  editor.destroy();
});
