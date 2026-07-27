import assert from 'node:assert/strict';
import test from 'node:test';
import { documentHasUserContent } from './documents.js';

test('an empty title and editor body have no user content', () => {
  assert.equal(documentHasUserContent({
    title: '',
    content_json: { type: 'doc', content: [] },
  }), false);
});

test('title or body text counts as user content', () => {
  assert.equal(documentHasUserContent({
    title: 'Named document',
    content_json: { type: 'doc', content: [] },
  }), true);
  assert.equal(documentHasUserContent({
    title: '',
    content_json: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Document body' }],
      }],
    },
  }), true);
});

test('whitespace-only title and body remain empty', () => {
  assert.equal(documentHasUserContent({
    title: '   ',
    content_json: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: '\n  ' }],
      }],
    },
  }), false);
});
