import { DOCUMENT_UPLOAD_SIZE_MESSAGE } from './upload.js';

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(error, _req, res, _next) {
  let status = Number(error.statusCode ?? error.status ?? 500);
  if (error.code === 'LIMIT_FILE_SIZE') status = 413;
  if (status < 400 || status > 599) status = 500;
  if (status >= 500) {
    console.error('Request failed:', JSON.stringify({
      name: error instanceof Error ? error.name : 'UnknownError',
      code: error.publicCode ?? null,
      correlationId: error.correlationId ?? null,
    }));
  }
  const body = {
    error: error.code === 'LIMIT_FILE_SIZE'
      ? DOCUMENT_UPLOAD_SIZE_MESSAGE
      : (error.publicCode
        ? error.message
        : (status >= 500 ? 'Internal server error' : (error.message || 'Request failed'))),
  };
  if (error.publicCode) body.code = error.publicCode;
  if (error.correlationId) body.correlationId = error.correlationId;
  res.status(status).json(body);
}
