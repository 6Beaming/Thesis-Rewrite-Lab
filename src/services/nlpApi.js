import { requestJson } from './request.js';

export function getNlpHealth() {
  return requestJson('/documents/nlp/health');
}

export function getNlpFeatures() {
  return requestJson('/documents/nlp/features');
}

export function getDocumentBlockNlp(documentId, blockId) {
  return requestJson(`/documents/${documentId}/blocks/${blockId}/nlp`);
}

export function checkDocumentBlockNlp(documentId, blockId, {
  text,
  sourceTextHash,
  partitionGeneration,
  sourceType = 'paragraph',
  knownTerms = [],
  signal,
}) {
  return requestJson(`/documents/${documentId}/blocks/${blockId}/nlp/check`, {
    method: 'POST',
    body: JSON.stringify({
      sourceTextHash,
      text,
      partitionGeneration,
      sourceType,
      knownTerms,
    }),
    signal,
  });
}

export function rejectDocumentBlockLanguageIssue(documentId, blockId, {
  issue,
  sourceTextHash,
  partitionGeneration,
}) {
  return requestJson(`/documents/${documentId}/blocks/${blockId}/nlp/issues/reject`, {
    method: 'POST',
    body: JSON.stringify({
      issue,
      sourceTextHash,
      partitionGeneration,
    }),
  });
}

export function requestDocumentRepartition(documentId, {
  semanticProfile,
  expectedRevision,
  expectedPartitionRevision,
  caretAbsoluteOffset = null,
  activeBlockId = null,
}) {
  return requestJson(`/documents/${documentId}/nlp/repartition`, {
    method: 'POST',
    body: JSON.stringify({
      semanticProfile,
      expectedRevision,
      expectedPartitionRevision,
      caretAbsoluteOffset,
      activeBlockId,
    }),
  });
}

export function getDocumentNlpStatus(documentId) {
  return requestJson(`/documents/${documentId}/nlp/status`);
}
