import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import mammoth from 'mammoth';
import { createDocumentExport } from '../../server/export/documentExport.js';
import { customStyleSettingsFromImportedBlocks } from '../shared/academicStyleTemplates.js';
import { extractDocxBlocks } from './documentResolver.js';

test('DOCX import preserves paragraph alignment and first-line indentation', async () => {
  const bodyText = 'The Big Five Theory is a widely used framework in psychology.';
  const buffer = await Packer.toBuffer(new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 22,
          },
          paragraph: {
            spacing: { line: 480 },
          },
        },
      },
      paragraphStyles: [{
        id: 'CenteredHeading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        paragraph: {
          alignment: AlignmentType.CENTER,
        },
        run: {
          bold: true,
          italics: true,
        },
      }],
    },
    sections: [{
      children: [
        new Paragraph({
          text: 'Introduction',
          style: 'CenteredHeading1',
        }),
        new Paragraph({
          children: [new TextRun(bodyText)],
          indent: { firstLine: 216 },
        }),
      ],
    }],
  }));

  const blocks = await extractDocxBlocks(buffer);
  const heading = blocks.find((block) => block.text === 'Introduction');
  const body = blocks.find((block) => block.text === bodyText);

  assert.equal(heading?.sourceType, 'heading');
  assert.equal(heading?.attrs.textAlign, 'center');
  assert.ok(heading?.attrs.formatOverrides.includes('textAlign'));
  assert.equal(heading?.attrs.fontFamily, 'Arial');
  assert.equal(heading?.attrs.fontSize, '11pt');
  assert.equal(heading?.attrs.lineHeight, '2');
  assert.equal(heading?.attrs.preserveHeadingStyle, true);
  assert.ok(heading?.attrs.formatOverrides.includes('fontFamily'));
  assert.ok(heading?.attrs.formatOverrides.includes('fontSize'));
  assert.ok(heading?.attrs.formatOverrides.includes('lineHeight'));
  assert.deepEqual(
    heading?.content[0]?.marks?.map((mark) => mark.type),
    ['bold', 'italic'],
  );
  assert.equal(body?.attrs.textIndent, '0.25in');
  assert.ok(body?.attrs.formatOverrides.includes('textIndent'));
  assert.equal(
    customStyleSettingsFromImportedBlocks(blocks, { indentation: '0.5in' }).indentation,
    '0.25in',
  );
});

test('Customized DOCX export retains an imported 0.25-inch first-line indent', async () => {
  const buffer = await createDocumentExport({
    title: 'Imported indentation fixture',
    academic_style: 'Customized',
    style_settings: {
      font: 'Times New Roman',
      fontSize: '12pt',
      spacing: '2.0',
      indentation: '0.5in',
    },
    content_json: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: {
          textIndent: '0.25in',
          formatOverrides: ['textIndent'],
        },
        content: [{
          type: 'blockSegment',
          attrs: {
            textIndent: '0.25in',
            formatOverrides: ['textIndent'],
          },
          content: [{ type: 'text', text: 'Imported paragraph.' }],
        }],
      }],
    },
  });
  const paragraphs = [];

  await mammoth.convertToHtml({ buffer }, {
    transformDocument: mammoth.transforms.paragraph((paragraph) => {
      paragraphs.push(paragraph);
      return paragraph;
    }),
  });

  assert.equal(paragraphs[0]?.indent?.firstLine, '360');
});
