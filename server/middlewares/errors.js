export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(error, _req, res, _next) {
  const status = Number(error.statusCode ?? error.status ?? 500);
  res.status(status).json({
    error: error.message || 'Unexpected server error',
  });
}
