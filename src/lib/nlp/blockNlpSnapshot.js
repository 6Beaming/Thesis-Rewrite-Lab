const NLP_STATUSES = new Set(['unknown', 'pass', 'warning', 'blocked', 'skipped']);

export function normalizeBlockNlpSnapshot(value = {}) {
  const attrs = value.attrs ?? value.tiptap_node?.attrs ?? {};
  const directSnapshot = NLP_STATUSES.has(value.status)
    && (
      Object.hasOwn(value, 'sentenceCount')
      || Array.isArray(value.sentences)
      || Array.isArray(value.issues)
      || Object.hasOwn(value, 'textHash')
    )
    ? value
    : null;
  const nlp = value.nlp
    ?? value.nlpAnalysis
    ?? value.nlp_analysis
    ?? attrs.nlpAnalysis
    ?? directSnapshot
    ?? {};
  const statusCandidate = value.nlpStatus
    ?? value.nlp_status
    ?? attrs.nlpStatus
    ?? nlp.status;
  const status = NLP_STATUSES.has(statusCandidate) ? statusCandidate : 'unknown';
  return {
    status,
    reasonCodes: value.nlpReasonCodes
      ?? value.nlp_reason_codes
      ?? attrs.nlpReasonCodes
      ?? nlp.reasonCodes
      ?? [],
    sentenceCount: Number(nlp.sentenceCount) || 0,
    sentences: Array.isArray(nlp.sentences) ? nlp.sentences : [],
    issues: Array.isArray(nlp.issues) ? nlp.issues : [],
    issueCounts: nlp.issueCounts ?? { warning: 0, blocking: 0 },
    semanticCoherence: value.semanticCoherence
      ?? value.semantic_coherence
      ?? attrs.semanticCoherence
      ?? nlp.semanticCoherence
      ?? null,
    semanticAnchor: value.semanticAnchor
      ?? value.semantic_anchor
      ?? attrs.semanticAnchor
      ?? nlp.semanticAnchor
      ?? null,
    rewriteEligible: Boolean(nlp.rewriteEligible ?? ['pass', 'warning'].includes(status)),
    textHash: value.nlpTextHash
      ?? value.nlp_text_hash
      ?? attrs.nlpTextHash
      ?? nlp.textHash
      ?? null,
    pipelineVersion: value.nlpPipelineVersion
      ?? value.nlp_pipeline_version
      ?? attrs.nlpPipelineVersion
      ?? nlp.pipelineVersion
      ?? null,
    snapshotFingerprint: value.nlpSnapshotFingerprint
      ?? value.nlp_snapshot_fingerprint
      ?? attrs.nlpSnapshotFingerprint
      ?? null,
    checkedAt: value.nlpCheckedAt
      ?? value.nlp_checked_at
      ?? attrs.nlpCheckedAt
      ?? null,
    degraded: Boolean(nlp.degraded),
    analysisWarnings: Array.isArray(nlp.analysisWarnings) ? nlp.analysisWarnings : [],
    rejectedIssues: Array.isArray(nlp.rejectedIssues) ? nlp.rejectedIssues : [],
  };
}

export function invalidateBlockNlpAttrs(attrs = {}) {
  return {
    ...attrs,
    nlpStatus: 'unknown',
    nlpReasonCodes: [],
    nlpAnalysis: {},
    nlpTextHash: null,
    nlpPipelineVersion: null,
    nlpSnapshotFingerprint: null,
    semanticCoherence: null,
    semanticAnchor: null,
    nlpCheckedAt: null,
  };
}

export function applyBlockNlpAttrs(attrs = {}, response = {}) {
  const nlp = response.nlp ?? response;
  return {
    ...attrs,
    nlpStatus: nlp.status ?? 'unknown',
    nlpReasonCodes: nlp.reasonCodes ?? [],
    nlpAnalysis: nlp,
    nlpTextHash: nlp.textHash ?? response.identity?.sourceTextHash ?? null,
    nlpPipelineVersion: nlp.pipelineVersion ?? response.identity?.pipelineVersion ?? null,
    nlpSnapshotFingerprint: response.identity?.nlpSnapshotFingerprint ?? null,
    semanticCoherence: nlp.semanticCoherence ?? null,
    semanticAnchor: nlp.semanticAnchor ?? null,
    nlpCheckedAt: response.block?.nlp_checked_at ?? new Date().toISOString(),
  };
}
