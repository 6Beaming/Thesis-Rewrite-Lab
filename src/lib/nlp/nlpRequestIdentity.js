import { hashAiSourceText } from '../aiResultIdentity.js';

export async function createBlockNlpRequestIdentity({
  documentId,
  blockId,
  text,
  partitionGeneration,
  pipelineVersion = 'document-nlp-v1',
}) {
  const sourceTextHash = await hashAiSourceText(String(text ?? ''));
  return {
    documentId,
    blockId,
    sourceTextHash,
    partitionGeneration: Number(partitionGeneration) || 0,
    pipelineVersion,
    key: [
      documentId,
      blockId,
      sourceTextHash,
      Number(partitionGeneration) || 0,
      pipelineVersion,
    ].join('|'),
  };
}

export function nlpResponseMatchesIdentity(response, visibleIdentity) {
  const identity = response?.identity;
  return Boolean(
    identity
    && visibleIdentity
    && identity.documentId === visibleIdentity.documentId
    && identity.blockId === visibleIdentity.blockId
    && identity.sourceTextHash === visibleIdentity.sourceTextHash
    && Number(identity.partitionGeneration) === Number(visibleIdentity.partitionGeneration)
    && identity.pipelineVersion === visibleIdentity.pipelineVersion
  );
}
