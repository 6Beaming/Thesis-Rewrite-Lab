const COUNT_FIELDS = [
  'passCount',
  'warningCount',
  'blockedCount',
  'skippedCount',
  'unknownCount',
  'warningIssueCount',
  'blockingIssueCount',
];

function count(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
}

export function normalizeDocumentNlpSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const normalized = Object.fromEntries(
    COUNT_FIELDS.map((field) => [field, count(value[field])]),
  );
  const classifiedCount = (
    normalized.passCount
    + normalized.warningCount
    + normalized.blockedCount
    + normalized.skippedCount
  );
  const hasUnknownCount = Object.hasOwn(value, 'unknownCount');
  normalized.blockCount = Math.max(
    count(value.blockCount),
    classifiedCount + (hasUnknownCount ? normalized.unknownCount : 0),
  );
  if (!hasUnknownCount) {
    normalized.unknownCount = Math.max(0, normalized.blockCount - classifiedCount);
  }

  return {
    ...normalized,
    checkedAt: value.checkedAt ?? null,
  };
}

export function scopeDocumentNlpSummary(documentId, value) {
  return {
    documentId: documentId ?? null,
    summary: documentId ? normalizeDocumentNlpSummary(value) : null,
  };
}

export function visibleDocumentNlpSummary(state, documentId) {
  if (!documentId || state?.documentId !== documentId) return null;
  return state.summary ?? null;
}
