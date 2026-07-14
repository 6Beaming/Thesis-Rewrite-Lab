import { useEffect, useRef } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from './AuthProvider.jsx';
import { useRealtime } from './RealtimeProvider.jsx';

function LoadingEntitlement() {
  return (
    <main className="subscription-loading-screen" role="status">
      Checking your Pro subscription…
    </main>
  );
}

export default function RequirePro({ children }) {
  const { user, isLoading, signOut } = useAuth();
  const { state } = useRealtime();
  const signOutStartedRef = useRef(false);
  const subscription = state.subscription;
  const waiting = isLoading || (user && (!subscription || state.subscriptionLoading));

  useEffect(() => {
    if (
      !user
      || waiting
      || subscription?.accessState === 'payment_failed'
      || subscription?.hasProAccess
      || signOutStartedRef.current
    ) {
      return;
    }
    signOutStartedRef.current = true;
    signOut(new URL('/?reason=subscription-required', window.location.origin).href);
  }, [signOut, subscription?.accessState, subscription?.hasProAccess, user, waiting]);

  if (waiting) return <LoadingEntitlement />;
  if (subscription?.hasProAccess) return children;
  if (subscription?.accessState === 'payment_failed') {
    return <Navigate to="/subscription" replace />;
  }
  return <LoadingEntitlement />;
}
