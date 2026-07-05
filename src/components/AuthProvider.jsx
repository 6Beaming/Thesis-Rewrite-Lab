// AuthProvider is imported once by main.jsx to create the shared authentication context.
// When the app starts, it:
// 1. Calls getSession() to check whether the browser has a valid login cookie.
// 2. Stores the returned session in React state.
// 3. Exposes authentication information to every child component.
// Components access it with: const { user, signIn, signOut } = useAuth();
import { createContext, useContext, useEffect, useState } from 'react';
import {
  getSession,
  signInWithGoogle,
  signOut as submitSignOut,
} from '../services/auth.js';

const AuthContext = createContext(null);

const authErrorMessages = {
  AccessDenied: 'Google could not verify this account.',
  Configuration: 'Authentication is temporarily unavailable.',
  OAuthAccountNotLinked: 'This email is already linked to another account.',
  OAuthCallbackError: 'Google sign-in could not be completed.',
  OAuthSignin: 'Google sign-in could not be started.',
};

function getInitialAuthError() {
  const code = new URLSearchParams(window.location.search).get('error');
  return code
    ? authErrorMessages[code] || 'Authentication could not be completed.'
    : '';
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(getInitialAuthError);

  useEffect(() => {
    const controller = new AbortController();

    getSession({ signal: controller.signal })
      .then(setSession)
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

  async function runAuthAction(action) {
    setError('');
    setIsSubmitting(true);

    try {
      await action();
    } catch {
      setError('Authentication could not be started. Please try again.');
      setIsSubmitting(false);
    }
  }

  function signIn(returnTo = `${window.location.origin}/`) {
    return runAuthAction(() => signInWithGoogle(returnTo));
  }

  function signOut() {
    return runAuthAction(() => submitSignOut(`${window.location.origin}/`));
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
