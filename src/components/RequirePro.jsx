import { useEffect, useRef } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from './AuthProvider.jsx';
import { useRealtime } from './RealtimeProvider.jsx';
import LoadingScreen from './LoadingScreen.jsx';

export default function RequirePro({ children }) {
  const { user, isLoading, signOut } = useAuth();
  const { state } = useRealtime();
  const signOutStartedRef = useRef(false);
  const subscription = state.subscription;
  const waiting = isLoading || (user && !subscription);

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

  if (waiting) return <LoadingScreen />;
  if (subscription?.hasProAccess) return children;
  if (subscription?.accessState === 'payment_failed') {
    return <Navigate to="/subscription" replace />;
  }
  return <LoadingScreen />;
}
