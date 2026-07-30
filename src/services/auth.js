async function readJson(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || 'Authentication request failed');
  }

  return data;
}

export const GOOGLE_OAUTH_PENDING_KEY = 'project-thesis-rewriter:google-oauth-pending:v1';

export async function getSession({ signal } = {}) {
  const response = await fetch('/auth/session', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });

  return readJson(response);
}

function getSafeCallbackUrl(returnTo) {
  const callbackUrl = new URL(returnTo || '/', window.location.origin);
  return callbackUrl.origin === window.location.origin
    ? callbackUrl.href
    : `${window.location.origin}/`;
}

async function submitAuthAction(action, returnTo, { trackGoogleOAuth = false } = {}) {
  const csrfResponse = await fetch('/auth/csrf', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const { csrfToken } = await readJson(csrfResponse);

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;

  const fields = {
    csrfToken,
    callbackUrl: getSafeCallbackUrl(returnTo),
  };

  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  });

  document.body.append(form);
  if (trackGoogleOAuth) {
    window.sessionStorage.setItem(GOOGLE_OAUTH_PENDING_KEY, '1');
  }
  form.submit();
}

export function signInWithGoogle(returnTo) {
  return submitAuthAction('/auth/signin/google', returnTo, { trackGoogleOAuth: true });
}

export function signOut(returnTo) {
  return submitAuthAction('/auth/signout', returnTo);
}
