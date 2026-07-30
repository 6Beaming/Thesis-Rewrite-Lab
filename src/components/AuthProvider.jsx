// AuthProvider is imported once by main.jsx to create the shared authentication context.
// When the app starts, it:
// 1. Calls getSession() to check whether the browser has a valid login cookie.
// 2. Stores the returned session in React state.
// 3. Exposes authentication information to every child component.
// Components access it with: const { user, signIn, signOut } = useAuth();
import { createContext, useContext, useEffect, useState } from 'react';
import {
  GOOGLE_OAUTH_PENDING_KEY,
  getSession,
  signInWithGoogle,
  signOut as submitSignOut,
} from '../services/auth.js';

const AuthContext = createContext(null);

function oauthIsPending() {
  return window.sessionStorage.getItem(GOOGLE_OAUTH_PENDING_KEY) === '1';
}

function clearOAuthPending() {
  window.sessionStorage.removeItem(GOOGLE_OAUTH_PENDING_KEY);
}

function resetOAuthEntrance() {
  clearOAuthPending();
  window.location.replace(`${window.location.origin}/`);
}

const authErrorMessages = {
  AccessDenied: 'Google could not verify this account.',
  Configuration: 'Authentication is temporarily unavailable.',
  OAuthAccountNotLinked: 'This email is already linked to another account.',
  OAuthCallbackError: 'Google sign-in could not be completed.',
  OAuthSignin: 'Google sign-in could not be started.',
};

function getInitialAuthError() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('error');
  if (code) return authErrorMessages[code] || 'Authentication could not be completed.';
  const reason = params.get('reason');
  const reasonMessages = {
    'subscription-required': 'A Pro subscription is required to enter the workspace.',
    'checkout-cancelled': 'Checkout was cancelled. Sign in again when you are ready to subscribe.',
    'payment-failed': 'Your payment was not completed. Sign in again to try Checkout.',
  };
  return reasonMessages[reason] || '';
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(getInitialAuthError);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('error')) {
      resetOAuthEntrance();
      return undefined;
    }

    function handlePageShow(event) {
      if (event.persisted && oauthIsPending()) {
        clearOAuthPending();
        window.location.reload();
      }
    }

    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    getSession({ signal: controller.signal })
      .then((nextSession) => {
        setSession(nextSession);
        if (nextSession?.user) {
          clearOAuthPending();
        } else if (oauthIsPending()) {
          clearOAuthPending();
          window.location.reload();
        }
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setError('Could not check your session. Please try again.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    function handleExpiredSession() {
      setSession(null);
      setError('Your session expired. Sign in with Google again.');
    }

    window.addEventListener('app:auth-expired', handleExpiredSession);
    return () => window.removeEventListener('app:auth-expired', handleExpiredSession);
  }, []);

  async function runAuthAction(action) {
    setError('');
    setIsSubmitting(true);

    try {
      await action();
    } catch {
      clearOAuthPending();
      setError('Authentication could not be started. Please try again.');
      setIsSubmitting(false);
    }
  }

  function signIn(returnTo = `${window.location.origin}/`) {
    return runAuthAction(() => signInWithGoogle(returnTo));
  }

  function signOut(returnTo = `${window.location.origin}/`) {
    return runAuthAction(() => submitSignOut(returnTo));
  }

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        isLoading,
        isSubmitting,
        error,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
