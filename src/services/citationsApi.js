import { requestJson } from './request.js';

export function checkDocumentCitations(documentId) {
  return requestJson(`/documents/${documentId}/citations/check`, { method: 'POST' });
}

export function searchDocumentCitations(documentId, {
  query,
  author = '',
  year = '',
}) {
  return requestJson(`/documents/${documentId}/citations/search`, {
    method: 'POST',
    body: JSON.stringify({ query, author, year }),
  });
}

export function renderDocumentCitation(documentId, payload) {
  return requestJson(`/documents/${documentId}/citations/render`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function applyDocumentCitationPatch(documentId, payload) {
  return requestJson(`/documents/${documentId}/citations/apply-patch`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function convertDocumentCitationStyle(documentId, payload) {
  return requestJson(`/documents/${documentId}/citations/convert-style`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
