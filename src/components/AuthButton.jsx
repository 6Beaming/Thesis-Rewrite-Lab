import { Link } from 'react-router';
import { useAuth } from './AuthProvider.jsx';
import ProfileAvatar from './ProfileAvatar.jsx';

function GoogleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-6 shrink-0"
      viewBox="0 0 48 48"
    >
      <path
        fill="#FFC107"
        d="M43.6 20H42v-.1H24v8h11.3A12 12 0 1 1 32 15.1l5.7-5.7A20 20 0 1 0 44 24c0-1.3-.1-2.7-.4-4"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8A12 12 0 0 1 32 15.1l5.7-5.7A20 20 0 0 0 6.3 14.7"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.1-5.2A12 12 0 0 1 12.4 27l-6.5 5A20 20 0 0 0 24 44"
      />
      <path
        fill="#1976D2"
        d="M43.6 20H24v8h11.3a12 12 0 0 1-4.3 5.6l6.1 5.2C41.3 34.7 44 29.4 44 24c0-1.3-.1-2.7-.4-4"
      />
    </svg>
  );
}

function AuthButton() {
  const { user, isLoading, isSubmitting, error, signIn } = useAuth();

  return (
    <div className="text-center">
      {user ? (
        <Link
          to="/profile"
          aria-label="Open profile"
          className="inline-flex rounded-full shadow-sm transition hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-600"
        >
          <ProfileAvatar user={user} size="size-14" />
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => signIn()}
          disabled={isLoading || isSubmitting}
          className="inline-flex cursor-pointer items-center gap-3 rounded-md border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-600 disabled:cursor-wait disabled:opacity-60"
        >
          <GoogleIcon />
          {isLoading
            ? 'Checking session…'
            : isSubmitting
              ? 'Redirecting…'
              : 'Sign in with Google'}
        </button>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

export default AuthButton;
