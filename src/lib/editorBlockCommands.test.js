import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor, Node } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import StarterKit from '@tiptap/starter-kit';
import { splitSegmentedTextBlock } from './editorBlockCommands.js';

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
  assert.deepEqual(
    paragraphs.map((paragraph) => paragraph.content[0].content[0].text),
    ['Hello', ' world'],
  );
  assert.ok(paragraphs.every((paragraph) => paragraph.content[0].type === 'blockSegment'));

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
