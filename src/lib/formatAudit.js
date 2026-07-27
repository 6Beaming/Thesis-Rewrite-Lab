const STRUCTURAL_PROPERTIES = Object.freeze([
  'fontFamily',
  'fontSize',
  'lineHeight',
  'textIndent',
  'textAlign',
]);

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

function declaredOverrides(node) {
  const value = node?.attrs?.formatOverrides;
  return new Set(
    Array.isArray(value)
      ? value
      : Object.keys(value ?? {}),
  );
}

export function auditDocumentFormatting(contentJson, style = {}) {
  const expected = globalFormat(style);
  const differences = [];

  walk(contentJson, (node) => {
    if (node.type !== 'blockSegment') return;
    const blockId = node.attrs?.blockId ?? null;
    const properties = new Set();
    const overrides = declaredOverrides(node);
    for (const property of STRUCTURAL_PROPERTIES) {
      const actual = node.attrs?.[property] ?? expected[property];
      if (
        !overrides.has(property)
        && String(actual) !== String(expected[property])
      ) {
        properties.add(property);
      }
    }
    walk({ content: node.content }, (child) => {
      if (child.type !== 'text') return;
      const textStyle = child.marks?.find((mark) => mark.type === 'textStyle')?.attrs ?? {};
      if (
        !overrides.has('fontFamily')
        && textStyle.fontFamily
        && textStyle.fontFamily !== expected.fontFamily
      ) {
        properties.add('fontFamily');
      }
      if (
        !overrides.has('fontSize')
        && textStyle.fontSize
        && textStyle.fontSize !== expected.fontSize
      ) {
        properties.add('fontSize');
      }
      if (!overrides.has('color') && textStyle.color) properties.add('color');
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

export { STRUCTURAL_PROPERTIES };
