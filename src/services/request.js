export async function requestJson(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    ...options,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with ${response.status}`);
  }

  return data;
}
