import { requestJson } from './request.js';

export function listVersions(documentId) {
  return requestJson(`/documents/${documentId}/versions`);
}

export function getVersion(documentId, versionId) {
  return requestJson(`/documents/${documentId}/versions/${versionId}`);
}

export function revertVersion(documentId, versionId) {
  return requestJson(`/documents/${documentId}/revert`, {
    method: 'POST',
    body: JSON.stringify({ versionId }),
  });
}
