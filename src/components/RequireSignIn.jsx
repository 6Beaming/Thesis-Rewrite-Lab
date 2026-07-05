import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuth } from './AuthProvider.jsx';

function RequireSignIn({ children }) {
  const { user, isLoading, error, signIn } = useAuth();
  const location = useLocation();
  const signInStarted = useRef(false);

  useEffect(() => {
    if (isLoading || user || signInStarted.current) return;

    signInStarted.current = true;
    const returnTo = new URL(
      `${location.pathname}${location.search}${location.hash}`,
      window.location.origin,
    ).href;
    signIn(returnTo);
  }, [isLoading, location, signIn, user]);

  if (user) return children;

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6 text-slate-900">
      <div className="text-center">
        <p>{isLoading ? 'Checking your session…' : 'Redirecting to sign in…'}</p>
        {error && (
          <>
            <p role="alert" className="mt-3 text-sm text-rose-700">
              {error}
            </p>
            <Link
              to="/"
              className="mt-4 inline-block text-sm font-semibold text-sky-700 hover:underline"
            >
              Return to dashboard
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export default RequireSignIn;
