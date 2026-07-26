import { normalizeBlockNlpSnapshot } from './blockNlpSnapshot.js';

export function nlpFreshnessLabel(snapshotValue) {
  const snapshot = normalizeBlockNlpSnapshot(snapshotValue);
  if (!snapshot.checkedAt) return 'Not reviewed';
  if (snapshot.status === 'unknown') return 'Review again';
  return snapshot.degraded ? 'Basic review complete' : 'Current';
}

export function nlpRewriteEligibilityLabel(snapshotValue) {
  const snapshot = normalizeBlockNlpSnapshot(snapshotValue);
  if (snapshot.status === 'unknown') return 'Waiting for writing review';
  if (snapshot.status === 'blocked') return 'Rewrite paused until writing issues are resolved';
  if (snapshot.status === 'skipped') return 'Skipped from automatic rewriting';
  return 'Ready for rewriting';
}

export function followingBlockNlpStatuses(blocks = [], activeBlockId, limit = 6) {
  const start = blocks.findIndex((block) => block.id === activeBlockId);
  if (start < 0) return [];
  return blocks.slice(start + 1, start + 1 + limit).map((block) => ({
    id: block.id,
    index: Number(block.block_index) + 1,
    status: normalizeBlockNlpSnapshot(block).status,
  }));
}
