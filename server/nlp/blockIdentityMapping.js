import { countCodePoints } from './hash.js';

function intervalOverlap(left, right) {
  return Math.max(0, Math.min(left.endCp, right.endCp) - Math.max(left.startCp, right.startCp));
}

function oldIntervals(blocks) {
  const offsets = new Map();
  return blocks.map((block) => {
    const paragraphIndex = Number(block.attrs?.paragraphIndex ?? block.block_index ?? 0);
    const startCp = offsets.get(paragraphIndex) ?? 0;
    const endCp = startCp + countCodePoints(block.text_content);
    offsets.set(paragraphIndex, endCp);
    return { ...block, paragraphIndex, startCp, endCp };
  });
}

export function mapRepartitionedBlockIdentities(oldBlocks, candidates) {
  const old = oldIntervals(oldBlocks);
  const usedIds = new Set();
  return candidates.map((candidate) => {
    const overlapping = old
      .filter((block) => block.paragraphIndex === candidate.paragraphIndex)
      .map((block) => ({ block, overlap: intervalOverlap(block, candidate) }))
      .filter(({ overlap }) => overlap > 0)
      .sort((left, right) => (
        right.overlap - left.overlap
        || left.block.block_index - right.block.block_index
      ));
    const exact = overlapping.find(({ block }) => (
      block.startCp === candidate.startCp
      && block.endCp === candidate.endCp
      && block.text_content === candidate.text
      && !usedIds.has(block.id)
    ));
    const primary = exact?.block
      ?? overlapping.find(({ block }) => !usedIds.has(block.id))?.block
      ?? null;
    if (primary) usedIds.add(primary.id);
    const boundaryChanged = !exact;
    return {
      candidate,
      primary,
      overlapping: overlapping.map(({ block }) => block),
      preserveId: primary?.id ?? null,
      boundaryChanged,
      partitionGeneration: Math.max(
        0,
        ...overlapping.map(({ block }) => Number(block.partition_generation) || 0),
      ) + (boundaryChanged ? 1 : 0),
    };
  });
}

export function summarizeIdentityMapping(mapped) {
  const oldToNew = {};
  for (const item of mapped) {
    if (!item.preserveId) continue;
    oldToNew[item.preserveId] = item.preserveId;
  }
  return {
    preservedBlockCount: Object.keys(oldToNew).length,
    changedBoundaryCount: mapped.filter((item) => item.boundaryChanged).length,
    oldToNew,
  };
}
