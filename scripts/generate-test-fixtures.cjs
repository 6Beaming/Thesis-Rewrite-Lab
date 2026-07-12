const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const {
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
} = require('docx');

// Temporary local fixture generator for upload/editor/trash/version testing.
// Outputs are intentionally written under local/test-fixtures/ and should not be committed.
const outputDir = path.join(process.cwd(), 'local', 'test-fixtures');

const markdownFixture = `# Assignment 2: article 2

This is a placeholder academic paragraph for upload testing. It should become one processing block first. It includes several sentences so clustering can split it.

The second paragraph discusses cognitive behavioral therapy in plain language. It is intentionally verbose enough to behave like a real paper body. The editor should allow arbitrary inline edits.

## Practice Section

This paragraph is used to test rewriting card responses. Card one should eventually display a placeholder success response. Card two should eventually display Network Problems.

The next sentences give the document more body. A processed block should appear green. A processing block should appear pale yellow. An unprocessed block should appear pale red. A skipped block should have no highlight.

## Page Two Placeholder

This section stands in for a second page. It helps test vertical scrolling in the A4 paper editor. It also gives version history enough text for previews and difference views.

The final paragraph is for trash and restore testing. Move this document to trash, restore it, delete it forever, and confirm the homepage document list changes accordingly.
`;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makeProfilePng(width = 128, height = 128) {
  const rows = [];
  const centerX = width / 2;
  const centerY = height / 2;

  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.hypot(dx, dy);
      const eyeLeft = Math.hypot(x - 44, y - 54);
      const eyeRight = Math.hypot(x - 84, y - 54);
      const beak = Math.abs(x - 64) + Math.abs(y - 78);

      let color = [247, 236, 205, 255];
      if (dist < 56) color = [101, 101, 96, 255];
      if (dist < 47) color = [246, 236, 216, 255];
      if (eyeLeft < 17 || eyeRight < 17) color = [255, 255, 248, 255];
      if (eyeLeft < 8 || eyeRight < 8) color = [22, 34, 38, 255];
      if (beak < 14 && y > 66 && y < 92) color = [247, 164, 41, 255];
      if (dist > 59) color = [238, 247, 237, 255];

      row[offset] = color[0];
      row[offset + 1] = color[1];
      row[offset + 2] = color[2];
      row[offset + 3] = color[3];
    }
    rows.push(row);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeDocx() {
  const paragraphs = [
    new Paragraph({
      text: 'Assignment 2: article 2',
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'This is a generated DOCX fixture for local upload testing. ', size: 24, font: 'Times New Roman' }),
        new TextRun({ text: 'It includes bold formatting, ', bold: true, size: 24, font: 'Times New Roman' }),
        new TextRun({ text: 'italic emphasis, ', italics: true, size: 24, font: 'Times New Roman' }),
        new TextRun({ text: 'and enough sentence boundaries for clustering.', size: 24, font: 'Times New Roman' }),
      ],
      spacing: { line: 480, after: 240 },
    }),
    new Paragraph({
      text: 'The document editor should open this text as editable paper content. Processing status should start on the first block. Subsequent blocks should remain unprocessed until scripts or UI actions update them.',
      spacing: { line: 480, after: 240 },
    }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      text: 'Page Two Placeholder',
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      text: 'This second page exists to test scrolling, version previews, restore workflows, and document difference views. The content is plain enough to make failures obvious during local checks.',
      spacing: { line: 480, after: 240 },
    }),
    new Paragraph({
      text: 'Rewriting Card 1 should eventually return a placeholder success response. Rewriting Card 2 should eventually return Network Problems. Practicing should sleep before rendering its placeholder response.',
      spacing: { line: 480, after: 240 },
    }),
  ];

  return new Document({
    sections: [{ children: paragraphs }],
  });
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'profile-picture.png'), makeProfilePng());
  await fs.writeFile(path.join(outputDir, 'test.md'), markdownFixture);
  const docxBuffer = await Packer.toBuffer(makeDocx());
  await fs.writeFile(path.join(outputDir, 'test.docx'), docxBuffer);
  console.log(`Generated fixtures in ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
