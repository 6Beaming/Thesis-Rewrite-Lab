import { Link } from 'react-router';
import { useAuth } from '../components/AuthProvider.jsx';
import ProfileAvatar from '../components/ProfileAvatar.jsx';
import RequireSignIn from '../components/RequireSignIn.jsx';

function ProfileContent() {
  const { user, isSubmitting, error, signOut } = useAuth();

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-900">
      <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <Link
          to="/"
          className="text-sm font-semibold text-sky-700 hover:underline"
        >
          ← Dashboard
        </Link>

        <div className="mt-8 flex items-center gap-4">
          <ProfileAvatar user={user} size="size-16" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">
              {user.name || 'Your profile'}
            </h1>
            <p className="truncate text-slate-600">{user.email}</p>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={signOut}
          disabled={isSubmitting}
          className="mt-8 w-full rounded-xl border border-slate-300 px-4 py-3 font-semibold transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-wait disabled:opacity-60"
        >
          {isSubmitting ? 'Signing out…' : 'Sign out'}
        </button>
      </section>
    </main>
  );
}

// Anonymous users are redirected through Google sign-in before ProfileContent renders.
function Profile() {
  return (
    <RequireSignIn>
      <ProfileContent />
    </RequireSignIn>
  );
}

export default Profile;
