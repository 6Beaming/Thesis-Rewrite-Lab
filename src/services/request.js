export async function requestJson(path, options = {}) {
  const { headers: optionHeaders, ...requestOptions } = options;
  const method = String(requestOptions.method ?? 'GET').toUpperCase();
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const mutationId = optionHeaders?.['X-Mutation-Id']
    ?? optionHeaders?.['x-mutation-id']
    ?? (isMutation ? globalThis.crypto?.randomUUID?.() : null);
  const response = await fetch(`/api${path}`, {
    headers: {
      ...(requestOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(mutationId ? { 'X-Mutation-Id': mutationId } : {}),
      ...optionHeaders,
    },
    ...requestOptions,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.error || `Request failed with ${response.status}`);
    error.status = response.status;
    error.code = data?.code ?? null;
    error.correlationId = data?.correlationId ?? response.headers.get('x-correlation-id');
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

  return data;
}
