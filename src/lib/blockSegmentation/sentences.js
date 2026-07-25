const NON_TERMINAL_ABBREVIATION = /(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|fig|eq|ref|no|inc|ltd|co|e\.g|i\.e)\.|\b[A-Z]\.|\b(?:[A-Z]\.){2,})$/i;

function trimmedRange(value, start, end) {
  let nextStart = start;
  let nextEnd = end;
  while (nextStart < nextEnd && /\s/u.test(value[nextStart])) nextStart += 1;
  while (nextEnd > nextStart && /\s/u.test(value[nextEnd - 1])) nextEnd -= 1;
  return { start: nextStart, end: nextEnd };
}

export function sentenceRanges(source, {
  start = 0,
  end = String(source ?? '').length,
  locale = 'en',
} = {}) {
  const value = String(source ?? '');
  const section = value.slice(start, end);
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  const ranges = [];

  for (const item of segmenter.segment(section)) {
    const rawStart = start + item.index;
    const trimmed = trimmedRange(value, rawStart, rawStart + item.segment.length);
    if (trimmed.start === trimmed.end) continue;

    const previous = ranges.at(-1);
    if (previous && NON_TERMINAL_ABBREVIATION.test(value.slice(previous.start, previous.end))) {
      previous.end = trimmed.end;
      previous.text = value.slice(previous.start, previous.end);
      continue;
    }

    ranges.push({
      start: trimmed.start,
      end: trimmed.end,
      text: value.slice(trimmed.start, trimmed.end),
    });
  }

  // Make sentence ranges lossless inside the section. Inter-sentence
  // whitespace belongs to the following sentence, so adjacent block slices
  // can be concatenated to reproduce the source exactly.
  if (ranges.length) {
    ranges[0].start = start;
    for (let index = 1; index < ranges.length; index += 1) {
      ranges[index].start = ranges[index - 1].end;
    }
    ranges[ranges.length - 1].end = end;
    ranges.forEach((range) => {
      range.text = value.slice(range.start, range.end);
    });
  }

  return ranges;
}
