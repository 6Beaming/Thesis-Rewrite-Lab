import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  TextRun,
  UnderlineType,
} from 'docx';
import {
  academicParagraphLayout,
  academicStyleSettings,
} from '../../src/shared/academicStyleTemplates.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const A4_PAGE_WIDTH_TWIPS = 11906;
const A4_PAGE_HEIGHT_TWIPS = 16838;
const DEFAULT_STYLE = Object.freeze({
  font: 'Times New Roman',
  fontSize: '12pt',
  spacing: '2.0',
  marginTop: '1in',
  marginRight: '1in',
  marginBottom: '1in',
  marginLeft: '1in',
  pageNumber: 'Bottom center',
});
const HEADING_LEVELS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};
const ALIGNMENTS = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

export { DOCX_MIME };

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function lengthToTwips(value, fallbackInches = 0) {
  const match = /^(\d*\.?\d+)\s*(in|cm|mm|pt|px)?$/i.exec(String(value ?? '').trim());
  if (!match) return Math.round(fallbackInches * 1440);

  const amount = finiteNumber(match[1], fallbackInches);
  const unit = String(match[2] ?? 'in').toLowerCase();
  const inches = unit === 'cm'
    ? amount / 2.54
    : unit === 'mm'
      ? amount / 25.4
      : unit === 'pt'
        ? amount / 72
        : unit === 'px'
          ? amount / 96
          : amount;
  return Math.max(0, Math.round(inches * 1440));
}

function halfPoints(value, fallback = 12) {
  const match = /^(\d*\.?\d+)\s*(pt|px)?$/i.exec(String(value ?? '').trim());
  if (!match) return Math.round(fallback * 2);
  const amount = finiteNumber(match[1], fallback);
  const points = String(match[2] ?? 'pt').toLowerCase() === 'px'
    ? amount * 0.75
    : amount;
  return Math.max(2, Math.round(points * 2));
}

function normalizeHexColor(value) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  const color = match[1].toUpperCase();
  return color.length === 3
    ? color.split('').map((character) => character.repeat(2)).join('')
    : color;
}

function paragraphAlignment(value, fallback = AlignmentType.LEFT) {
  return ALIGNMENTS[String(value ?? '').toLowerCase()] ?? fallback;
}

function paragraphSpacing(value) {
  const multiplier = Math.min(3, Math.max(0.8, finiteNumber(value, 2)));
  return {
    line: Math.round(multiplier * 240),
    before: 0,
    after: 0,
  };
}

function styleSettingsForDocument(document) {
  return {
    ...DEFAULT_STYLE,
    ...academicStyleSettings(document?.academic_style, document?.style_settings),
  };
}

function runDefaultsFromAttrs(attrs = {}, inherited = {}) {
  return {
    font: attrs.fontFamily || attrs.font || inherited.font || DEFAULT_STYLE.font,
    size: attrs.fontSize || inherited.size || DEFAULT_STYLE.fontSize,
  };
}

function textRunFromNode(node, defaults) {
  const marks = new Map((node.marks ?? []).map((mark) => [mark.type, mark.attrs ?? {}]));
  const textStyle = marks.get('textStyle') ?? {};
  const color = normalizeHexColor(textStyle.color);
  const highlight = normalizeHexColor(marks.get('highlight')?.color);
  const options = {
    text: String(node.text ?? ''),
    bold: marks.has('bold'),
    italics: marks.has('italic'),
    strike: marks.has('strike'),
    font: marks.has('code')
      ? 'Courier New'
      : (textStyle.fontFamily || defaults.font),
    size: halfPoints(textStyle.fontSize || defaults.size),
  };

  if (marks.has('underline')) {
    options.underline = { type: UnderlineType.SINGLE };
  }
  if (color) options.color = color;
  if (highlight) {
    options.shading = {
      type: ShadingType.CLEAR,
      color: 'auto',
      fill: highlight,
    };
  }

  return new TextRun(options);
}

function inlineRuns(node, inherited = {}) {
  if (!node || typeof node !== 'object') return [];
  if (node.type === 'text') return [textRunFromNode(node, inherited)];
  if (node.type === 'hardBreak') {
    return [new TextRun({
      break: 1,
      font: inherited.font || DEFAULT_STYLE.font,
      size: halfPoints(inherited.size || DEFAULT_STYLE.fontSize),
    })];
  }

  const nextDefaults = node.type === 'blockSegment'
    ? runDefaultsFromAttrs(node.attrs, inherited)
    : inherited;
  if (!Array.isArray(node.content)) return [];
  return node.content.flatMap((child) => inlineRuns(child, nextDefaults));
}

function headingLevel(node) {
  if (node?.type !== 'heading') return null;
  return HEADING_LEVELS[Math.min(6, Math.max(1, finiteNumber(node.attrs?.level, 1)))]
    ?? HeadingLevel.HEADING_1;
}

function sourceTypeForNode(node) {
  if (!node || typeof node !== 'object') return 'paragraph';
  if (node.attrs?.sourceType) return node.attrs.sourceType;
  for (const child of node.content ?? []) {
    const sourceType = sourceTypeForNode(child);
    if (sourceType !== 'paragraph') return sourceType;
  }
  return 'paragraph';
}

function paragraphOptions(node, context, marker = null) {
  const attrs = {
    ...context.style,
    ...(node?.attrs ?? {}),
  };
  const level = Math.min(8, Math.max(0, finiteNumber(marker?.level, 0)));
  const heading = headingLevel(node);
  const layout = academicParagraphLayout({
    academicStyle: context.academicStyle,
    styleSettings: context.style,
    sourceType: sourceTypeForNode(node),
    isHeading: Boolean(heading),
    isListItem: Boolean(marker),
    blockquoteDepth: context.blockquoteDepth,
  });
  const options = {
    children: inlineRuns(node, runDefaultsFromAttrs(attrs)),
    alignment: paragraphAlignment(attrs.textAlign),
    spacing: {
      ...paragraphSpacing(layout.lineHeight || attrs.lineHeight || attrs.spacing),
      after: lengthToTwips(layout.entrySpacingAfter),
    },
  };

  if (!options.children.length) {
    options.children = [new TextRun('')];
  }
  if (heading) {
    options.heading = heading;
  } else if (marker?.type === 'bullet') {
    options.bullet = { level };
  } else if (marker?.type === 'numbering') {
    options.numbering = { reference: marker.reference, level };
  }

  const indent = {};
  if (!heading && !marker) {
    indent.firstLine = lengthToTwips(layout.firstLineIndent);
  }
  if (lengthToTwips(layout.leftIndent) > 0) {
    indent.left = lengthToTwips(layout.leftIndent);
  }
  if (lengthToTwips(layout.hangingIndent) > 0) {
    delete indent.firstLine;
    indent.hanging = lengthToTwips(layout.hangingIndent);
  }
  if (Object.keys(indent).length) options.indent = indent;

  return options;
}

function createParagraph(node, context, marker = null) {
  return new Paragraph(paragraphOptions(node, context, marker));
}

function numberingLevels(start) {
  return Array.from({ length: 9 }, (_value, level) => ({
    level,
    format: LevelFormat.DECIMAL,
    text: `%${level + 1}.`,
    alignment: AlignmentType.START,
    start,
    style: {
      paragraph: {
        indent: {
          left: 720 + (level * 360),
          hanging: 360,
        },
      },
    },
  }));
}

function renderList(node, state, context) {
  const ordered = node.type === 'orderedList';
  const reference = ordered ? `ordered-list-${state.numbering.length + 1}` : null;
  if (ordered) {
    state.numbering.push({
      reference,
      levels: numberingLevels(Math.max(1, finiteNumber(node.attrs?.start, 1))),
    });
  }

  const marker = ordered
    ? { type: 'numbering', reference, level: context.listDepth }
    : { type: 'bullet', level: context.listDepth };
  const output = [];

  for (const item of node.content ?? []) {
    let markerUsed = false;
    for (const child of item?.content ?? []) {
      if (child?.type === 'bulletList' || child?.type === 'orderedList') {
        output.push(...renderList(child, state, {
          ...context,
          listDepth: context.listDepth + 1,
        }));
        continue;
      }

      const childParagraphs = renderNode(child, state, context, markerUsed ? null : marker);
      if (childParagraphs.length) {
        markerUsed = true;
        output.push(...childParagraphs);
      }
    }

    if (!markerUsed) {
      output.push(createParagraph({ type: 'paragraph', content: [] }, context, marker));
    }
  }

  return output;
}

function renderNode(node, state, context, marker = null) {
  if (!node || typeof node !== 'object') return [];

  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'blockSegment') {
    return [createParagraph(node, context, marker)];
  }
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return renderList(node, state, context);
  }
  if (node.type === 'blockquote') {
    return (node.content ?? []).flatMap((child) => renderNode(child, state, {
      ...context,
      blockquoteDepth: context.blockquoteDepth + 1,
    }));
  }
  if (node.type === 'listItem') {
    return (node.content ?? []).flatMap((child) => renderNode(child, state, context, marker));
  }
  if (node.type === 'text' || node.type === 'hardBreak') {
    return [createParagraph({ type: 'paragraph', content: [node] }, context, marker)];
  }
  if (Array.isArray(node.content)) {
    return node.content.flatMap((child) => renderNode(child, state, context, marker));
  }
  return [];
}

function pageNumberParts(style) {
  const pageNumber = String(style.pageNumber ?? DEFAULT_STYLE.pageNumber).toLowerCase();
  const top = pageNumber.includes('top');
  const alignment = pageNumber.includes('right')
    ? AlignmentType.RIGHT
    : pageNumber.includes('left')
      ? AlignmentType.LEFT
      : AlignmentType.CENTER;
  const paragraph = new Paragraph({
    alignment,
    children: [
      new TextRun({
        children: [PageNumber.CURRENT],
        font: style.font,
        size: halfPoints(style.fontSize),
      }),
    ],
  });

  return top
    ? { headers: { default: new Header({ children: [paragraph] }) } }
    : { footers: { default: new Footer({ children: [paragraph] }) } };
}

export function exportFilename(title) {
  const filename = String(title ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim()
    .replace(/\.docx$/i, '')
    .replace(/[.\s]+$/g, '')
    .trim()
    .slice(0, 115);
  return `${filename || 'Untitled document'}.docx`;
}

export function contentDispositionForTitle(title) {
  const filename = exportFilename(title);
  const asciiFilename = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '_')
    .replace(/^\.+/g, '')
    .trim();
  const fallbackFilename = asciiFilename && asciiFilename.toLowerCase() !== 'docx'
    ? asciiFilename
    : 'document.docx';
  return `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function createDocumentExport(document) {
  const style = styleSettingsForDocument(document);
  const state = { numbering: [] };
  const contentNodes = document?.content_json?.content ?? [];
  const children = contentNodes.flatMap((node) => renderNode(node, state, {
    academicStyle: document?.academic_style,
    blockquoteDepth: 0,
    listDepth: 0,
    style,
  }));

  const docxDocument = new Document({
    creator: 'Thesis Rewriting Platform',
    title: document?.title || 'Untitled document',
    description: `${document?.academic_style || 'Academic'} document export`,
    styles: {
      default: {
        document: {
          run: {
            font: style.font,
            size: halfPoints(style.fontSize),
          },
          paragraph: {
            spacing: paragraphSpacing(style.spacing),
          },
        },
      },
    },
    numbering: {
      config: state.numbering,
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: A4_PAGE_WIDTH_TWIPS,
            height: A4_PAGE_HEIGHT_TWIPS,
          },
          margin: {
            top: lengthToTwips(style.marginTop, 1),
            right: lengthToTwips(style.marginRight, 1),
            bottom: lengthToTwips(style.marginBottom, 1),
            left: lengthToTwips(style.marginLeft, 1),
          },
        },
      },
      ...pageNumberParts(style),
      children: children.length ? children : [new Paragraph('')],
    }],
  });

  return Packer.toBuffer(docxDocument);
}
