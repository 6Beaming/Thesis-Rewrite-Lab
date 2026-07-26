function marksKey(marks = []) {
  return JSON.stringify(marks);
}

function appendText(content, text, marks = []) {
  if (!text) return;
  const previous = content.at(-1);
  if (previous?.type === 'text' && marksKey(previous.marks) === marksKey(marks)) {
    previous.text += text;
    return;
  }
  const node = { type: 'text', text };
  if (marks.length) node.marks = marks.map((mark) => ({ ...mark }));
  content.push(node);
}

export function textFromInlineContent(content = []) {
  return content.map((node) => (
    node.type === 'hardBreak' ? '\n' : node.text ?? ''
  )).join('');
}

export function inlineContentFromText(text) {
  const content = [];
  for (const part of String(text ?? '').split(/(\n)/).filter(Boolean)) {
    if (part === '\n') content.push({ type: 'hardBreak' });
    else appendText(content, part);
  }
  return content;
}

export function concatInlineContent(left = [], right = [], separator = ' ') {
  const content = left.map((node) => ({
    ...node,
    ...(node.marks ? { marks: node.marks.map((mark) => ({ ...mark })) } : {}),
  }));
  if (separator === '\n') {
    if (content.at(-1)?.type !== 'hardBreak') content.push({ type: 'hardBreak' });
  } else {
    appendText(content, separator);
  }
  for (const node of right) {
    if (node.type === 'hardBreak') {
      content.push({ ...node });
    } else {
      appendText(content, node.text ?? '', node.marks ?? []);
    }
  }
  return content;
}

export function sliceInlineContent(content = [], start = 0, end = Number.POSITIVE_INFINITY) {
  const result = [];
  let offset = 0;
  for (const node of content) {
    const value = node.type === 'hardBreak' ? '\n' : node.text ?? '';
    const nodeEnd = offset + value.length;
    const sliceStart = Math.max(start, offset);
    const sliceEnd = Math.min(end, nodeEnd);
    if (sliceStart < sliceEnd) {
      if (node.type === 'hardBreak') {
        result.push({ ...node });
      } else {
        appendText(
          result,
          value.slice(sliceStart - offset, sliceEnd - offset),
          node.marks ?? [],
        );
      }
    }
    offset = nodeEnd;
    if (offset >= end) break;
  }
  return result;
}

/**
 * Rebuild whitespace while retaining the marks attached to every non-whitespace
 * source character. Cleanup rules are only allowed to change whitespace, so a
 * character-order mismatch deliberately falls back to unmarked text.
 */
export function remapWhitespacePreservingMarks(sourceContent = [], transformedText = '') {
  const sourceCharacters = [];
  for (const node of sourceContent) {
    const value = node.type === 'hardBreak' ? '\n' : node.text ?? '';
    const marks = node.type === 'text' ? node.marks ?? [] : [];
    for (const character of value) {
      if (!/\s/u.test(character)) sourceCharacters.push({ character, marks });
    }
  }

  const transformedCharacters = Array.from(String(transformedText));
  const transformedNonWhitespace = transformedCharacters.filter((character) => !/\s/u.test(character));
  const sourceSignature = sourceCharacters.map(({ character }) => character).join('');
  if (sourceSignature !== transformedNonWhitespace.join('')) {
    return inlineContentFromText(transformedText);
  }

  const content = [];
  let sourceIndex = 0;
  for (const character of transformedCharacters) {
    if (character === '\n') {
      content.push({ type: 'hardBreak' });
      continue;
    }
    if (/\s/u.test(character)) {
      appendText(content, character);
      continue;
    }
    const source = sourceCharacters[sourceIndex];
    sourceIndex += 1;
    appendText(content, character, source?.marks ?? []);
  }
  return content;
}

