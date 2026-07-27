const STRUCTURAL_PROPERTIES = Object.freeze([
  'fontFamily',
  'fontSize',
  'lineHeight',
  'textIndent',
  'textAlign',
]);
const ACADEMIC_TEMPLATE_NAMES = new Set(['APA', 'MLA', 'Chicago']);

function globalFormat(style = {}) {
  return {
    fontFamily: style.fontFamily || style.font || 'Times New Roman',
    fontSize: style.fontSize || '12pt',
    lineHeight: style.lineHeight || style.spacing || '2.0',
    textIndent: style.textIndent || style.indentation || '0.5in',
    textAlign: style.textAlign || 'left',
    color: null,
  };
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  node.content?.forEach((child) => walk(child, visit));
}

export function auditDocumentFormatting(contentJson, style = {}) {
  const expected = globalFormat(style);
  const differences = [];

  walk(contentJson, (node) => {
    if (node.type !== 'blockSegment') return;
    const blockId = node.attrs?.blockId ?? null;
    const properties = new Set();
    for (const property of STRUCTURAL_PROPERTIES) {
      const actual = node.attrs?.[property] ?? expected[property];
      if (String(actual) !== String(expected[property])) properties.add(property);
    }
    walk({ content: node.content }, (child) => {
      if (child.type !== 'text') return;
      const textStyle = child.marks?.find((mark) => mark.type === 'textStyle')?.attrs ?? {};
      if (textStyle.fontFamily && textStyle.fontFamily !== expected.fontFamily) properties.add('fontFamily');
      if (textStyle.fontSize && textStyle.fontSize !== expected.fontSize) properties.add('fontSize');
      if (textStyle.color) properties.add('color');
    });
    if (properties.size) {
      differences.push({ blockId, properties: [...properties].sort() });
    }
  });

  return {
    hasDifferences: differences.length > 0,
    differences,
    expected,
  };
}

export function matchingAcademicTemplate(contentJson, styleName, style = {}) {
  if (!ACADEMIC_TEMPLATE_NAMES.has(styleName)) return null;
  return auditDocumentFormatting(contentJson, style).hasDifferences ? null : styleName;
}

export { STRUCTURAL_PROPERTIES };
