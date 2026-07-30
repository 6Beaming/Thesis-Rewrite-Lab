const MAX_DIFF_TOKENS = 1200;

function tokenize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().split(/(\s+)/).filter(Boolean);
}

function pushSegment(segments, type, value) {
  if (!value) return;
  const previous = segments.at(-1);
  if (previous?.type === type) previous.text += value;
  else segments.push({ type, text: value });
}

function diffText(previousText, nextText) {
  const previous = tokenize(previousText);
  const next = tokenize(nextText);
  if (!previous.length && !next.length) return [];
  if (previous.length + next.length > MAX_DIFF_TOKENS) {
    return [{ type: 'removed', text: previous.join(' ') }, { type: 'added', text: next.join(' ') }];
  }
  const table = Array.from({ length: previous.length + 1 }, () => Array(next.length + 1).fill(0));
  for (let i = previous.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      table[i][j] = previous[i] === next[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const segments = [];
  let i = 0;
  let j = 0;
  while (i < previous.length && j < next.length) {
    if (previous[i] === next[j]) {
      pushSegment(segments, 'same', next[j]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      pushSegment(segments, 'removed', previous[i++]);
    } else {
      pushSegment(segments, 'added', next[j++]);
    }
  }
  while (i < previous.length) pushSegment(segments, 'removed', previous[i++]);
  while (j < next.length) pushSegment(segments, 'added', next[j++]);
  return segments;
}

export function diffLogicalBlocks(previousBlocks, nextBlocks) {
  const previousById = new Map(previousBlocks.map((block) => [block.id, block]));
  const nextById = new Map(nextBlocks.map((block) => [block.id, block]));
  const ids = [
    ...previousBlocks.map((block) => block.id),
    ...nextBlocks.map((block) => block.id).filter((id) => !previousById.has(id)),
  ];
  const oldView = [];
  const newView = [];
  ids.forEach((id) => {
    const previous = previousById.get(id);
    const next = nextById.get(id);
    if (!previous) return pushSegment(newView, 'added', `${next.text}\n`);
    if (!next) return pushSegment(oldView, 'removed', `${previous.text}\n`);
    diffText(previous.text, next.text).forEach((segment) => {
      if (segment.type !== 'added') pushSegment(oldView, segment.type, segment.text);
      if (segment.type !== 'removed') pushSegment(newView, segment.type, segment.text);
    });
    pushSegment(oldView, 'same', '\n');
    pushSegment(newView, 'same', '\n');
    return undefined;
  });
  return { oldView, newView };
}

export function historicalDocumentVersions(versions = []) {
  return [...versions]
    .sort((left, right) => Number(right.version_number) - Number(left.version_number))
    .filter((version, index) => !(index === 0 && version.is_current === true));
}
