import { CURRENT_NLP_PIPELINE_VERSION, NLP_STATUS_VALUES } from './config.js';
import { createNlpSnapshotFingerprint } from './contracts.js';
import { hashNlpText } from './hash.js';

const VALID_STATUS = new Set(NLP_STATUS_VALUES);

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function jsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function blockNlpFields(block = {}) {
  const attrs = jsonObject(block.attrs ?? block.tiptap_node?.attrs);
  return {
    nlpStatus: VALID_STATUS.has(block.nlp_status ?? attrs.nlpStatus)
      ? (block.nlp_status ?? attrs.nlpStatus)
      : 'unknown',
    nlpReasonCodes: jsonArray(block.nlp_reason_codes ?? attrs.nlpReasonCodes),
    nlpAnalysis: jsonObject(block.nlp_analysis ?? attrs.nlpAnalysis),
    nlpTextHash: block.nlp_text_hash ?? attrs.nlpTextHash ?? null,
    nlpPipelineVersion: block.nlp_pipeline_version ?? attrs.nlpPipelineVersion ?? null,
    nlpSnapshotFingerprint: block.nlp_snapshot_fingerprint
      ?? attrs.nlpSnapshotFingerprint
      ?? null,
    semanticCoherence: block.semantic_coherence ?? attrs.semanticCoherence ?? null,
    semanticAnchor: block.semantic_anchor ?? attrs.semanticAnchor ?? null,
    nlpCheckedAt: block.nlp_checked_at ?? attrs.nlpCheckedAt ?? null,
  };
}

export function normalizePersistedBlockNlp(block = {}, {
  pipelineVersion = CURRENT_NLP_PIPELINE_VERSION,
} = {}) {
  const text = String(block.text_content ?? block.textContent ?? block.text ?? '');
  const sourceHash = hashNlpText(text);
  const fields = blockNlpFields(block);
  const current = (
    fields.nlpTextHash === sourceHash
    && fields.nlpPipelineVersion === pipelineVersion
    && fields.nlpSnapshotFingerprint
  );
  if (current) return { ...fields, current: true, sourceHash };
  return {
    nlpStatus: 'unknown',
    nlpReasonCodes: [],
    nlpAnalysis: {},
    nlpTextHash: null,
    nlpPipelineVersion: null,
    nlpSnapshotFingerprint: null,
    semanticCoherence: null,
    semanticAnchor: null,
    nlpCheckedAt: null,
    current: false,
    sourceHash,
  };
}

export function isRewriteEligibleBlock(block, {
  pipelineVersion = CURRENT_NLP_PIPELINE_VERSION,
} = {}) {
  const status = block.status ?? block.attrs?.status;
  const nlp = normalizePersistedBlockNlp(block, { pipelineVersion });
  return Boolean(
    ['processing', 'unprocessed'].includes(status)
    && ['pass', 'warning'].includes(nlp.nlpStatus)
    && nlp.current
    && Number(block.partition_generation ?? block.partitionGeneration ?? block.attrs?.partitionGeneration ?? 0) >= 0
    && !(
      status === 'processing'
      && (block.resume_status ?? block.resumeStatus ?? block.attrs?.resumeStatus) === 'skipped'
    )
  );
}

export function persistedNlpSnapshot(result, semanticProfile = 'medium') {
  return {
    nlpStatus: result.status,
    nlpReasonCodes: result.reasonCodes ?? [],
    nlpAnalysis: result,
    nlpTextHash: result.textHash,
    nlpPipelineVersion: result.pipelineVersion,
    nlpSnapshotFingerprint: createNlpSnapshotFingerprint(result, semanticProfile),
    semanticCoherence: result.semanticCoherence ?? null,
    semanticAnchor: result.semanticAnchor ?? null,
    nlpCheckedAt: new Date().toISOString(),
  };
}

export function nlpAttrs(fields) {
  return {
    nlpStatus: fields.nlpStatus ?? 'unknown',
    nlpReasonCodes: fields.nlpReasonCodes ?? [],
    nlpAnalysis: fields.nlpAnalysis ?? {},
    nlpTextHash: fields.nlpTextHash ?? null,
    nlpPipelineVersion: fields.nlpPipelineVersion ?? null,
    nlpSnapshotFingerprint: fields.nlpSnapshotFingerprint ?? null,
    semanticCoherence: fields.semanticCoherence ?? null,
    semanticAnchor: fields.semanticAnchor ?? null,
    nlpCheckedAt: fields.nlpCheckedAt ?? null,
  };
}
