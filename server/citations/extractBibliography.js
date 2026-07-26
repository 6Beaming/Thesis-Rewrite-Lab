const HEADING_PATTERN = /^(?:references|bibliography|works cited)\b\s*/iu;

function sourceType(block) {
  return block.attrs?.sourceType
    ?? block.tiptap_node?.attrs?.sourceType
    ?? null;
}

function paragraphIdentity(block) {
  const value = block.attrs?.paragraphIndex
    ?? block.tiptap_node?.attrs?.paragraphIndex;
  return Number.isInteger(Number(value))
    ? `paragraph:${Number(value)}`
    : `block:${block.id}`;
}

export function extractBibliography(blocks) {
  const headingIndex = blocks.findIndex((block) => (
    sourceType(block) === 'bibliographyHeading'
    || HEADING_PATTERN.test(String(block.text_content ?? '').trim())
  ));
  if (headingIndex < 0) return [];

  const chunks = [];
  const headingBlock = blocks[headingIndex];
  const headingRemainder = String(headingBlock.text_content ?? '')
    .replace(HEADING_PATTERN, '')
    .trimStart();
  if (headingRemainder) {
    chunks.push({
      key: paragraphIdentity(headingBlock),
      blockIds: [headingBlock.id],
      text: headingRemainder,
      partitionGeneration: Number(headingBlock.partition_generation),
    });
  }

  for (const block of blocks.slice(headingIndex + 1)) {
    const text = String(block.text_content ?? '');
    if (!text.trim()) continue;
    const key = paragraphIdentity(block);
    const previous = chunks.at(-1);
    if (previous?.key === key) {
      const separator = (
        previous.text
        && !/\s$/u.test(previous.text)
        && !/^[,.;:)\]}]/u.test(text)
      ) ? ' ' : '';
      previous.text += `${separator}${text}`;
      previous.blockIds.push(block.id);
      previous.partitionGeneration = Math.max(
        previous.partitionGeneration,
        Number(block.partition_generation),
      );
      continue;
    }
    chunks.push({
      key,
      blockIds: [block.id],
      text,
      partitionGeneration: Number(block.partition_generation),
    });
  }

  return chunks
    .map((entry) => ({
      blockId: entry.blockIds[0],
      blockIds: entry.blockIds,
      rawReferenceText: entry.text.trim(),
      partitionGeneration: entry.partitionGeneration,
      sourceType: 'bibliographyEntry',
    }))
    .filter((entry) => entry.rawReferenceText);
}
