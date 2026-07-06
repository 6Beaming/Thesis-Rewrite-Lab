import { useMemo, useRef, useState } from 'react';
import blackboardUrl from '../assets/blackboard.png';
import OwlContainer from './OwlContainer.jsx';
import { useAuth } from './AuthProvider.jsx';

function RequireSignIn({ children }) {
  const { user, isLoading, isSubmitting, error, signIn } = useAuth();
  const [localMessage, setLocalMessage] = useState('');
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const buttonRef = useRef(null);
  const animatorRef = useRef(null);
  const magicTargets = useMemo(() => [buttonRef], []);

  if (user) return children;

  const busy = isLoading || isSubmitting || localSubmitting;
  const message = error
    || localMessage
    || (isLoading ? 'Checking your session...' : 'Sign in with Google to continue.');
  const messageTone = error ? 'error' : busy ? 'loading' : 'success';

  async function handleSignIn(event) {
    event.preventDefault();
    if (busy) return;

    setLocalSubmitting(true);
    setLocalMessage('Opening Google sign in...');

    try {
      if (animatorRef.current && buttonRef.current) {
        await animatorRef.current.useMagic(buttonRef.current, { effect: 'button-burst' });
      }
      await signIn(new URL('/', window.location.origin).href);
    } catch {
      setLocalMessage('Google sign in could not be started.');
      setLocalSubmitting(false);
    }
  }

  function handleButtonHover() {
    animatorRef.current?.showWand();
  }

  return (
    <main
      className="auth-page"
      style={{ backgroundImage: `url(${blackboardUrl})` }}
    >
      <section className="auth-board-content" aria-label="Authentication">
        <form className="chalk-auth-form chalk-auth-form--oauth" onSubmit={handleSignIn}>
          <div className="chalk-tabs" role="tablist" aria-label="Authentication mode">
            <button type="button" className="chalk-tab is-active" aria-selected="true" role="tab">
              Login
            </button>
            <button type="button" className="chalk-tab" aria-selected="false" role="tab">
              Sign Up
            </button>
          </div>

          <div
            className={`chalk-message chalk-message--${messageTone}`}
            role={error ? 'alert' : 'status'}
          >
            {message}
          </div>

          <button
            ref={buttonRef}
            type="submit"
            className="chalk-submit"
            disabled={busy}
            onPointerEnter={handleButtonHover}
            onFocus={handleButtonHover}
          >
            {busy ? 'Loading...' : 'Sign in with Google'}
          </button>
        </form>
      </section>

      <section className="auth-owl-region" aria-label="Owl assistant">
        <div className="auth-owl-shell">
          <OwlContainer
            variant="desktop"
            standby="head-rotate"
            onAnimatorReady={(animator) => {
              animatorRef.current = animator;
            }}
            animation={{
              loading: busy,
              error: Boolean(error),
              errorKey: error,
              magicTargets,
              magicClick: false,
              trackPointer: true,
            }}
          />
        </div>
      </section>
    </main>
  );
}

export default RequireSignIn;
