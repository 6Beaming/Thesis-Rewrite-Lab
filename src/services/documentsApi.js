import { requestJson } from './request.js';

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

export function uploadDocument(file, academicStyle = 'APA', partitionMode = 'semantic') {
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

export function generateDocumentBlockRewrites(documentId, blockId, { tone = null, force = false } = {}) {
  return requestJson(`/documents/${documentId}/blocks/${blockId}/rewrites`, {
    method: 'POST',
    body: JSON.stringify({ tone, force }),
  });
}

export function acceptDocumentBlockRewrite(documentId, blockId, rewriteId) {
  return requestJson(`/documents/${documentId}/blocks/${blockId}/rewrites/${rewriteId}/accept`, {
    method: 'POST',
  });
}
