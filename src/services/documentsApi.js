import { requestJson } from './request.js';

export const MAX_DOCUMENT_UPLOAD_BYTES = Math.floor(2.5 * 1024 * 1024);
export const DOCUMENT_UPLOAD_SIZE_MESSAGE = 'Files must be 2.5 MB or smaller.';

export function validateDocumentUploadSize(file) {
  if (Number(file?.size ?? 0) > MAX_DOCUMENT_UPLOAD_BYTES) {
    const error = new Error(DOCUMENT_UPLOAD_SIZE_MESSAGE);
    error.code = 'UPLOAD_TOO_LARGE';
    throw error;
  }
}

export function listDocuments({ q = '', sort = 'most_recent' } = {}) {
  const params = new URLSearchParams({ q, sort });
  return requestJson(`/documents?${params.toString()}`);
}

export function createDocument() {
  return requestJson('/documents', { method: 'POST' });
}

export function getDocument(documentId) {
  return requestJson(`/documents/${documentId}`);
}

export function saveDocument(documentId, payload) {
  return requestJson(`/documents/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function uploadDocument(file, academicStyle = 'APA', partitionMode = 'character') {
  validateDocumentUploadSize(file);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('academicStyle', academicStyle);
  formData.append('partitionMode', partitionMode);
  return requestJson('/documents/upload', {
    method: 'POST',
    body: formData,
  });
}

export function moveToTrash(documentId) {
  return requestJson(`/documents/${documentId}`, { method: 'DELETE' });
}

export function updateDocumentBlockStatus(documentId, blockId, status) {
  return requestJson(`/documents/${documentId}/blocks/${blockId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function analyzeDocumentBlock(documentId, blockId, filters) {
  return requestJson(`/documents/${documentId}/blocks/${blockId}/analyze`, {
    method: 'POST',
    body: JSON.stringify({ filters }),
  });
}

export function generateDocumentBlockRewrites(documentId, blockId, { tone, force = false }) {
  return requestJson(`/documents/${documentId}/blocks/${blockId}/rewrites`, {
    method: 'POST',
    body: JSON.stringify({ tone, force }),
  });
}

export function getDocumentBlockRewrites(documentId, blockId, sourceTextHash = '') {
  const params = new URLSearchParams();
  if (sourceTextHash) params.set('sourceTextHash', sourceTextHash);
  const suffix = params.size ? `?${params.toString()}` : '';
  return requestJson(`/documents/${documentId}/blocks/${blockId}/rewrites${suffix}`);
}

export function prewarmDocumentBlockRewrites(documentId, blockId) {
  return requestJson(`/documents/${documentId}/blocks/${blockId}/rewrites/prewarm`, {
    method: 'POST',
  });
}

export function acceptDocumentBlockRewrite(documentId, blockId, rewriteId) {
  return requestJson(`/documents/${documentId}/blocks/${blockId}/rewrites/${rewriteId}/accept`, {
    method: 'POST',
  });
}

export function requestDocumentBlockPracticeFeedback(documentId, blockId, attemptText) {
  return requestJson(`/documents/${documentId}/blocks/${blockId}/practice-feedback`, {
    method: 'POST',
    body: JSON.stringify({ attemptText }),
  });
}
