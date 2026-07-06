import { requestJson } from './request.js';

export function listTrash() {
  return requestJson('/trash');
}

export function restoreDocument(documentId) {
  return requestJson(`/trash/${documentId}/restore`, { method: 'POST' });
}

export function deleteForever(documentId) {
  return requestJson(`/trash/${documentId}`, { method: 'DELETE' });
}
