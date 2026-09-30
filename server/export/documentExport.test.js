import assert from 'node:assert/strict';
import test from 'node:test';
import mammoth from 'mammoth';
import {
  academicHeadingStyle,
  academicParagraphLayout,
  academicStyleSettings,
  TEMPLATE_STYLE_SETTINGS,
} from '../../src/shared/academicStyleTemplates.js';
import {
  contentDispositionForTitle,
  createDocumentExport,
  exportFilename,
} from './documentExport.js';

test('exportFilename creates a safe DOCX filename', () => {
  assert.equal(exportFilename('  Thesis: results/analysis?  '), 'Thesis results analysis.docx');
  assert.equal(exportFilename('Final draft.docx'), 'Final draft.docx');
  assert.equal(exportFilename(''), 'Untitled document.docx');
  assert.match(
    contentDispositionForTitle('Résumé draft'),
    /filename\*=UTF-8''R%C3%A9sum%C3%A9%20draft\.docx/,
  );
  assert.match(contentDispositionForTitle('论文'), /filename="document\.docx"/);
});

test('academic templates enforce their required page and semantic paragraph layouts', () => {
  const canonicalChicago = academicStyleSettings('Chicago', {
    spacing: '1.5',
    marginTop: '0.5in',
  });
  assert.equal(canonicalChicago.spacing, '2.0');
  assert.equal(canonicalChicago.marginTop, '1in');

  for (const styleName of ['APA', 'MLA', 'Chicago']) {
    const style = TEMPLATE_STYLE_SETTINGS[styleName];
    assert.equal(style.spacing, '2.0');
    assert.equal(style.marginTop, '1in');
    assert.equal(style.marginRight, '1in');
    assert.equal(style.marginBottom, '1in');
    assert.equal(style.marginLeft, '1in');

    const body = academicParagraphLayout({
      academicStyle: styleName,
      styleSettings: style,
    });
    assert.equal(body.lineHeight, '2.0');
    assert.equal(body.firstLineIndent, '0.5in');
  }

  const apaReference = academicParagraphLayout({
    academicStyle: 'APA',
    styleSettings: TEMPLATE_STYLE_SETTINGS.APA,
    sourceType: 'bibliographyEntry',
  });
  assert.deepEqual(
    {
      lineHeight: apaReference.lineHeight,
      hangingIndent: apaReference.hangingIndent,
      entrySpacingAfter: apaReference.entrySpacingAfter,
    },
    { lineHeight: '2.0', hangingIndent: '0.5in', entrySpacingAfter: '0in' },
  );

  const mlaQuote = academicParagraphLayout({
    academicStyle: 'MLA',
    styleSettings: TEMPLATE_STYLE_SETTINGS.MLA,
    sourceType: 'blockquote',
  });
  assert.deepEqual(
    {
      lineHeight: mlaQuote.lineHeight,
      leftIndent: mlaQuote.leftIndent,
      firstLineIndent: mlaQuote.firstLineIndent,
    },
    { lineHeight: '2.0', leftIndent: '0.5in', firstLineIndent: '0in' },
  );

  const mlaWorksCited = academicParagraphLayout({
    academicStyle: 'MLA',
    styleSettings: TEMPLATE_STYLE_SETTINGS.MLA,
    sourceType: 'bibliographyEntry',
  });
  assert.equal(mlaWorksCited.hangingIndent, '0.5in');
  assert.equal(mlaWorksCited.lineHeight, '2.0');

  const chicagoBibliography = academicParagraphLayout({
    academicStyle: 'Chicago',
    styleSettings: TEMPLATE_STYLE_SETTINGS.Chicago,
    sourceType: 'bibliographyEntry',
  });
  assert.deepEqual(
    {
      lineHeight: chicagoBibliography.lineHeight,
      hangingIndent: chicagoBibliography.hangingIndent,
      entrySpacingAfter: chicagoBibliography.entrySpacingAfter,
    },
    { lineHeight: '1.0', hangingIndent: '0.5in', entrySpacingAfter: '12pt' },
  );

  const chicagoFootnote = academicParagraphLayout({
    academicStyle: 'Chicago',
    styleSettings: TEMPLATE_STYLE_SETTINGS.Chicago,
    sourceType: 'footnote',
  });
  assert.equal(chicagoFootnote.lineHeight, '1.0');
  assert.equal(chicagoFootnote.firstLineIndent, '0.5in');
});

test('academic templates define three body-sized heading levels without changing Customized', () => {
  const expected = {
    APA: [
      ['center', 'bold', 'normal'],
      ['left', 'bold', 'normal'],
      ['left', 'bold', 'italic'],
    ],
    MLA: [
      ['left', 'bold', 'normal'],
      ['left', 'normal', 'italic'],
      ['center', 'bold', 'normal'],
    ],
    Chicago: [
      ['center', 'bold', 'normal'],
      ['center', 'normal', 'normal'],
      ['left', 'bold', 'normal'],
    ],
  };

  for (const [academicStyle, headingLevels] of Object.entries(expected)) {
    headingLevels.forEach(([textAlign, fontWeight, fontStyle], index) => {
      const style = academicHeadingStyle({
        academicStyle,
        level: index + 1,
        styleSettings: { fontSize: '11pt' },
      });
      assert.deepEqual(
        {
          textAlign: style.textAlign,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          fontSize: style.fontSize,
        },
        { textAlign, fontWeight, fontStyle, fontSize: '11pt' },
      );
    });
  }

  assert.equal(academicHeadingStyle({
    academicStyle: 'Customized',
    level: 1,
    styleSettings: { fontSize: '12pt' },
  }), null);
});

test('createDocumentExport preserves document text and common rich-text structure', async () => {
  const buffer = await createDocumentExport({
    title: 'Export fixture',
    academic_style: 'APA',
    style_settings: {
      font: 'Times New Roman',
      fontSize: '12pt',
      spacing: '2.0',
      marginTop: '1in',
      marginRight: '1in',
      marginBottom: '1in',
      marginLeft: '1in',
      pageNumber: 'Bottom center',
    },
    content_json: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{
            type: 'blockSegment',
            attrs: { fontFamily: 'Times New Roman', fontSize: '18pt' },
            content: [{ type: 'text', text: 'Introduction' }],
          }],
        },
        {
          type: 'paragraph',
          attrs: { lineHeight: '2.0', textIndent: '0.5in' },
          content: [{
            type: 'blockSegment',
            content: [
              { type: 'text', text: 'An ' },
              { type: 'text', text: 'important', marks: [{ type: 'bold' }] },
              { type: 'text', text: ' result.' },
            ],
          }],
        },
        {
          type: 'bulletList',
          content: [{
            type: 'listItem',
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: 'First finding' }],
            }],
          }],
        },
      ],
    },
  });

  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const paragraphs = [];
  const html = await mammoth.convertToHtml({ buffer }, {
    transformDocument: mammoth.transforms.paragraph((paragraph) => {
      paragraphs.push(paragraph);
      return paragraph;
    }),
  });
  const exportedHeading = paragraphs.find((paragraph) => paragraph.styleId === 'Heading1');
  const exportedHeadingRun = exportedHeading?.children.find((child) => child.type === 'run');
  assert.equal(exportedHeading?.alignment, 'center');
  assert.equal(exportedHeadingRun?.font, 'Times New Roman');
  assert.equal(exportedHeadingRun?.fontSize, 12);
  assert.equal(exportedHeadingRun?.isBold, true);
  assert.equal(exportedHeadingRun?.isItalic, false);
  assert.match(html.value, /<h1><strong>Introduction<\/strong><\/h1>/);
  assert.match(html.value, /<strong>important<\/strong>/);
  assert.match(html.value, /First finding/);
});
