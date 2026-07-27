import { requestJson } from './request.js';
import { DEFAULT_UPLOAD_ACADEMIC_STYLE } from '../shared/academicStyleTemplates.js';

export { DEFAULT_UPLOAD_ACADEMIC_STYLE };

export const MAX_DOCUMENT_UPLOAD_BYTES = Math.floor(2.5 * 1024 * 1024);
export const DOCUMENT_UPLOAD_SIZE_MESSAGE = 'Files must be 2.5 MB or smaller.';
export const DOCUMENT_UPLOAD_TYPE_MESSAGE =
  'File type is not supported. Please upload a .txt, .md, or .docx file.';

const DOCUMENT_UPLOAD_EXTENSIONS = ['.txt', '.md', '.docx'];

export function validateDocumentUploadType(file) {
  const lowerName = String(file?.name ?? '').toLowerCase();
  const supported = DOCUMENT_UPLOAD_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
  if (!supported) {
    const error = new Error(DOCUMENT_UPLOAD_TYPE_MESSAGE);
    error.code = 'UNSUPPORTED_FILE_TYPE';
    throw error;
  }
}

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

export function discardEmptyDocument(documentId, { keepalive = false } = {}) {
  return requestJson(`/documents/${documentId}/discard-empty`, {
    method: 'DELETE',
    keepalive,
  });
}

export function uploadDocument(
  file,
  academicStyle = DEFAULT_UPLOAD_ACADEMIC_STYLE,
  partitionMode = 'character',
  semanticProfile = 'medium',
) {
  validateDocumentUploadType(file);
  validateDocumentUploadSize(file);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('academicStyle', academicStyle);
  formData.append('partitionMode', partitionMode);
  formData.append('semanticProfile', semanticProfile);
  return requestJson('/documents/upload', {
    method: 'POST',
    body: formData,
  });
}

export function moveToTrash(documentId) {
  return requestJson(`/documents/${documentId}`, { method: 'DELETE' });
}

function filenameFromContentDisposition(value) {
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(String(value ?? ''));
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // Fall back to the ASCII filename below.
    }
  }

  const quotedMatch = /filename="([^"]+)"/i.exec(String(value ?? ''));
  return quotedMatch?.[1] || 'document.docx';
}

export async function downloadDocument(documentId) {
  const response = await fetch(`/api/documents/${documentId}/export`, {
    headers: {
      Accept: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  });

  if (!response.ok) {
    let data = null;
    try {
      data = await response.json();
    } catch {
      // Use the status fallback when an upstream server returns a non-JSON error.
    }

    const error = new Error(data?.error || `Export failed with ${response.status}`);
    error.status = response.status;
    error.code = data?.code ?? null;
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('app:auth-expired'));
    }
    if (
      response.status === 403
      && data?.code === 'SUBSCRIPTION_REQUIRED'
      && typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new CustomEvent('app:subscription-required', { detail: data }));
    }
    throw error;
  }

  const blob = await response.blob();
  const filename = filenameFromContentDisposition(response.headers.get('content-disposition'));
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  return { blob, filename };
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

export function generateDocumentBlockRewrites(documentId, blockId, {
  tone,
  force = false,
  useSavedPreferences,
  preferenceOverrides,
}) {
  return requestJson(`/documents/${documentId}/blocks/${blockId}/rewrites`, {
    method: 'POST',
    body: JSON.stringify({
      tone,
      force,
      ...(typeof useSavedPreferences === 'boolean' ? { useSavedPreferences } : {}),
      ...(preferenceOverrides ? { preferenceOverrides } : {}),
    }),
  });
}

export function repartitionDocument(documentId, { semanticProfile, expectedRevision }) {
  return requestJson(`/documents/${documentId}/nlp/repartition`, {
    method: 'POST',
    body: JSON.stringify({ semanticProfile, expectedRevision }),
  });
}

export function getDocumentNlpJob(documentId, jobId) {
  return requestJson(`/documents/${documentId}/nlp/jobs/${jobId}`);
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
