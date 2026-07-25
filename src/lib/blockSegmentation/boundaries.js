const CONSECUTIVE_NEWLINES = /(?:\r?\n[^\S\r\n]*){2,}/g;

export function consecutiveNewlineBoundaries(source) {
  const value = String(source ?? '');
  const boundaries = [];
  CONSECUTIVE_NEWLINES.lastIndex = 0;
  let match = CONSECUTIVE_NEWLINES.exec(value);
  while (match) {
    boundaries.push({
      start: match.index,
      end: match.index + match[0].length,
      reason: 'hard-boundary',
    });
    match = CONSECUTIVE_NEWLINES.exec(value);
  }
  return boundaries;
}

export function sourceSections(source, hardBoundary = consecutiveNewlineBoundaries) {
  const value = String(source ?? '');
  const boundaries = hardBoundary(value);
  const sections = [];
  let cursor = 0;

  for (const boundary of boundaries) {
    if (boundary.start > cursor) {
      sections.push({
        start: cursor,
        end: boundary.start,
        followedByHardBoundary: true,
      });
    }
    cursor = Math.max(cursor, boundary.end);
  }

  if (cursor < value.length) {
    sections.push({ start: cursor, end: value.length, followedByHardBoundary: false });
  }

  return sections;
}
