export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(error, _req, res, _next) {
  let status = Number(error.statusCode ?? error.status ?? 500);
  if (error.code === 'LIMIT_FILE_SIZE') status = 413;
  if (status < 400 || status > 599) status = 500;
  if (status >= 500) {
    console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
  }
  const body = {
    error: status >= 500 ? 'Internal server error' : (error.message || 'Request failed'),
  };
  if (status < 500 && error.publicCode) body.code = error.publicCode;
  res.status(status).json(body);
}
