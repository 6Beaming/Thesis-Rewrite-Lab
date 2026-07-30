export const DEFAULT_CUSTOM_STYLE = Object.freeze({
  marginPreset: 'Normal',
  marginTop: '1in',
  marginRight: '1in',
  marginBottom: '1in',
  marginLeft: '1in',
  font: 'Times New Roman',
  spacing: '2.0',
  indentation: '0.5in',
  pageNumber: 'Bottom center',
});

export const DEFAULT_UPLOAD_ACADEMIC_STYLE = 'Customized';

const DOUBLE_SPACED_REFERENCE_LIST = Object.freeze({
  lineHeight: '2.0',
  hangingIndent: '0.5in',
  entrySpacingAfter: '0in',
});

const APA_HEADING_STYLES = Object.freeze({
  1: Object.freeze({ textAlign: 'center', fontWeight: 'bold', fontStyle: 'normal' }),
  2: Object.freeze({ textAlign: 'left', fontWeight: 'bold', fontStyle: 'normal' }),
  3: Object.freeze({ textAlign: 'left', fontWeight: 'bold', fontStyle: 'italic' }),
});

const MLA_HEADING_STYLES = Object.freeze({
  1: Object.freeze({ textAlign: 'left', fontWeight: 'bold', fontStyle: 'normal' }),
  2: Object.freeze({ textAlign: 'left', fontWeight: 'normal', fontStyle: 'italic' }),
  3: Object.freeze({ textAlign: 'center', fontWeight: 'bold', fontStyle: 'normal' }),
});

const CHICAGO_HEADING_STYLES = Object.freeze({
  1: Object.freeze({ textAlign: 'center', fontWeight: 'bold', fontStyle: 'normal' }),
  2: Object.freeze({ textAlign: 'center', fontWeight: 'normal', fontStyle: 'normal' }),
  3: Object.freeze({ textAlign: 'left', fontWeight: 'bold', fontStyle: 'normal' }),
});

export const TEMPLATE_STYLE_SETTINGS = Object.freeze({
  APA: Object.freeze({
    ...DEFAULT_CUSTOM_STYLE,
    pageNumber: 'Top right',
    headingStyles: APA_HEADING_STYLES,
    referenceList: DOUBLE_SPACED_REFERENCE_LIST,
  }),
  MLA: Object.freeze({
    ...DEFAULT_CUSTOM_STYLE,
    pageNumber: 'Top right',
    headingStyles: MLA_HEADING_STYLES,
    blockQuote: Object.freeze({
      lineHeight: '2.0',
      leftIndent: '0.5in',
      firstLineIndent: '0in',
    }),
    referenceList: DOUBLE_SPACED_REFERENCE_LIST,
  }),
  Chicago: Object.freeze({
    ...DEFAULT_CUSTOM_STYLE,
    spacing: '2.0',
    headingStyles: CHICAGO_HEADING_STYLES,
    bibliography: Object.freeze({
      lineHeight: '1.0',
      hangingIndent: '0.5in',
      entrySpacingAfter: '12pt',
    }),
    footnote: Object.freeze({
      lineHeight: '1.0',
      firstLineIndent: '0.5in',
      entrySpacingAfter: '0in',
    }),
  }),
});

const ACADEMIC_STYLES = new Set(Object.keys(TEMPLATE_STYLE_SETTINGS));
const CUSTOM_INDENTATION_VALUES = new Set(['0in', '0.25in', '0.5in']);

function formatOverrideNames(value) {
  return new Set(Array.isArray(value) ? value : Object.keys(value ?? {}));
}

export function customStyleSettingsFromImportedBlocks(blocks = [], storedSettings = {}) {
  const paragraphIndentations = new Map();

  blocks.forEach((block, index) => {
    const attrs = {
      ...(block?.tiptap_node?.attrs ?? {}),
      ...(block?.attrs ?? {}),
    };
    const sourceType = attrs.sourceType ?? block?.sourceType ?? 'paragraph';
    if (sourceType !== 'paragraph') return;

    const overrides = formatOverrideNames(
      attrs.formatOverrides ?? block?.format_overrides,
    );
    const textIndent = String(attrs.textIndent ?? '').trim();
    if (!overrides.has('textIndent') || !CUSTOM_INDENTATION_VALUES.has(textIndent)) return;

    const paragraphKey = Number.isInteger(attrs.paragraphIndex)
      ? `paragraph-${attrs.paragraphIndex}`
      : `block-${index}`;
    if (!paragraphIndentations.has(paragraphKey)) {
      paragraphIndentations.set(paragraphKey, textIndent);
    }
  });

  const indentationCounts = new Map();
  paragraphIndentations.forEach((indentation) => {
    indentationCounts.set(indentation, (indentationCounts.get(indentation) ?? 0) + 1);
  });
  const indentation = [...paragraphIndentations.values()].reduce(
    (mostCommon, candidate) => (
      (indentationCounts.get(candidate) ?? 0) > (indentationCounts.get(mostCommon) ?? 0)
        ? candidate
        : mostCommon
    ),
    null,
  );

  return {
    ...DEFAULT_CUSTOM_STYLE,
    ...storedSettings,
    ...(indentation ? { indentation } : {}),
  };
}

export function academicStyleSettings(styleName, storedSettings = {}) {
  const template = TEMPLATE_STYLE_SETTINGS[styleName];
  if (!template) return { ...DEFAULT_CUSTOM_STYLE, ...storedSettings };
  return { ...storedSettings, ...template };
}

export function academicHeadingStyle({
  academicStyle,
  level,
  styleSettings = {},
} = {}) {
  const template = TEMPLATE_STYLE_SETTINGS[academicStyle];
  const headingStyle = template?.headingStyles?.[Number(level)];
  if (!headingStyle) return null;

  const effectiveStyle = academicStyleSettings(academicStyle, styleSettings);
  return {
    ...headingStyle,
    fontFamily: effectiveStyle.fontFamily || effectiveStyle.font || 'Times New Roman',
    fontSize: effectiveStyle.fontSize || '12pt',
  };
}

export function academicParagraphLayout({
  academicStyle,
  styleSettings = {},
  sourceType = 'paragraph',
  isHeading = false,
  isListItem = false,
  blockquoteDepth = 0,
} = {}) {
  const isTemplate = ACADEMIC_STYLES.has(academicStyle);
  const effectiveStyle = isTemplate
    ? academicStyleSettings(academicStyle, styleSettings)
    : styleSettings;
  const base = {
    lineHeight: isTemplate
      ? effectiveStyle.spacing
      : (effectiveStyle.spacing || effectiveStyle.lineHeight || '2.0'),
    firstLineIndent: isHeading || isListItem ? '0in' : (
      effectiveStyle.indentation || effectiveStyle.textIndent || '0.5in'
    ),
    leftIndent: blockquoteDepth ? `${blockquoteDepth * 0.5}in` : '0in',
    hangingIndent: '0in',
    entrySpacingAfter: '0in',
  };

  if (!isTemplate) return base;
  if (sourceType === 'bibliographyHeading') {
    return { ...base, firstLineIndent: '0in' };
  }
  if (sourceType === 'bibliographyEntry') {
    const referenceLayout = academicStyle === 'Chicago'
      ? effectiveStyle.bibliography
      : effectiveStyle.referenceList;
    return {
      ...base,
      lineHeight: referenceLayout?.lineHeight || base.lineHeight,
      firstLineIndent: '0in',
      leftIndent: referenceLayout?.hangingIndent || '0.5in',
      hangingIndent: referenceLayout?.hangingIndent || '0.5in',
      entrySpacingAfter: referenceLayout?.entrySpacingAfter || '0in',
    };
  }
  if (academicStyle === 'MLA' && (sourceType === 'blockquote' || blockquoteDepth)) {
    const blockQuote = effectiveStyle.blockQuote ?? {};
    return {
      ...base,
      lineHeight: blockQuote.lineHeight || '2.0',
      firstLineIndent: blockQuote.firstLineIndent || '0in',
      leftIndent: blockQuote.leftIndent || '0.5in',
    };
  }
  if (
    academicStyle === 'Chicago'
    && (sourceType === 'footnote' || sourceType === 'endnote')
  ) {
    const footnote = effectiveStyle.footnote ?? {};
    return {
      ...base,
      lineHeight: footnote.lineHeight || '1.0',
      firstLineIndent: footnote.firstLineIndent || '0.5in',
      entrySpacingAfter: footnote.entrySpacingAfter || '0in',
    };
  }

  return base;
}
