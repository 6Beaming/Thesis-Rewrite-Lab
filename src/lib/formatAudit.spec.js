import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditDocumentFormatting,
  matchingAcademicTemplate,
} from './formatAudit.js';

const apaStyle = {
  font: 'Times New Roman',
  fontSize: '12pt',
  spacing: '2.0',
  indentation: '0.5in',
  textAlign: 'left',
};

function contentWithAttrs(attrs = {}) {
  return {
    type: 'doc',
    content: [{
      type: 'blockSegment',
      attrs: {
        blockId: 'block-1',
        fontFamily: 'Times New Roman',
        fontSize: '12pt',
        lineHeight: '2.0',
        textIndent: '0.5in',
        textAlign: 'left',
        ...attrs,
      },
      content: [{ type: 'text', text: 'Example' }],
    }],
  };
}

test('matchingAcademicTemplate keeps a compliant template selected', () => {
  assert.equal(matchingAcademicTemplate(contentWithAttrs(), 'APA', apaStyle), 'APA');
});

test('matchingAcademicTemplate deselects a template when local formatting differs', () => {
  const content = contentWithAttrs({ fontSize: '18pt' });

  assert.equal(auditDocumentFormatting(content, apaStyle).hasDifferences, true);
  assert.equal(matchingAcademicTemplate(content, 'APA', apaStyle), null);
});

test('matchingAcademicTemplate does not select a card for customized formatting', () => {
  assert.equal(matchingAcademicTemplate(contentWithAttrs(), 'Customized', apaStyle), null);
});
