import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DOCUMENT_UPLOAD_TYPE_MESSAGE,
  validateDocumentUploadType,
} from './documentsApi.js';

test('document upload type validation accepts supported extensions case-insensitively', () => {
  for (const name of ['notes.txt', 'draft.MD', 'thesis.DocX']) {
    assert.doesNotThrow(() => validateDocumentUploadType({ name }));
  }
});

test('document upload type validation rejects unsupported extensions with a clear message', () => {
  for (const name of ['notes.pdf', 'scan.png', 'thesis.doc', 'no-extension']) {
    assert.throws(
      () => validateDocumentUploadType({ name }),
      (error) => {
        assert.equal(error.code, 'UNSUPPORTED_FILE_TYPE');
        assert.equal(error.message, DOCUMENT_UPLOAD_TYPE_MESSAGE);
        return true;
      },
    );
  }
});
