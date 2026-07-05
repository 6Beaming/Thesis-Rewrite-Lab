import { useEffect, useMemo, useRef, useState } from 'react';
import blackboardUrl from '../assets/blackboard.png';
import OwlContainer from '../components/OwlContainer.jsx';

const TEST_EMAIL = 'test@example.com';
const TEST_PASSWORD = '123456';
const TEST_DELAY_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default function WorkspacePage() {
  const [view, setView] = useState('auth');
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('error');
  const [showForgot, setShowForgot] = useState(false);
  const [errorKey, setErrorKey] = useState(0);
  const submitButtonRef = useRef(null);
  const submitLockedRef = useRef(false);
  const owlAnimatorRef = useRef(null);
  const magicTargets = useMemo(() => [submitButtonRef], []);

  useEffect(() => {
    if (!message || messageTone === 'loading') {
      return undefined;
    }

    const timer = setTimeout(() => {
      setMessage('');
      setMessageTone('error');
      setShowForgot(false);
    }, 5000);

    return () => {
      clearTimeout(timer);
    };
  }, [message, messageTone]);

  async function triggerButtonMagic() {
    const animator = owlAnimatorRef.current;
    const target = submitButtonRef.current;
    if (!animator || !target) {
      return;
    }
    await animator.useMagic(target, { effect: 'button-burst' });
  }

  function showError(nextMessage, options = {}) {
    setMessage(nextMessage);
    setMessageTone('error');
    setShowForgot(Boolean(options.showForgot));
    setErrorKey((value) => value + 1);
  }

  async function placeholderTest(event) {
    event.preventDefault();
    if (loading || submitLockedRef.current) {
      return;
    }

    submitLockedRef.current = true;
    try {
      if (mode === 'signup') {
        setShowForgot(false);
        await triggerButtonMagic();
        setMessage('Sign Up is not available yet.');
        setMessageTone('success');
        return;
      }

      const submittedEmail = email.trim().toLowerCase();
      const submittedPassword = password;
      const loginRequest = sleep(TEST_DELAY_MS);

      await triggerButtonMagic();

      setShowForgot(false);
      setMessage('Loading...');
      setMessageTone('loading');
      setLoading(true);

      await loginRequest;

      if (submittedEmail !== TEST_EMAIL) {
        showError('Account not found.');
        setLoading(false);
        return;
      }

      if (submittedPassword !== TEST_PASSWORD) {
        showError('Incorrect Password!', { showForgot: true });
        setLoading(false);
        return;
      }

      setLoading(false);
      setMessage('Login Success!');
      setMessageTone('success');
      await sleep(900);
      setView('home');
    } finally {
      submitLockedRef.current = false;
    }
  }

  function switchMode(nextMode) {
    if (loading || mode === nextMode) {
      return;
    }
    setMode(nextMode);
    setMessage('');
    setMessageTone('error');
    setShowForgot(false);
  }

  function handleResetPassword() {
    if (loading) {
      return;
    }

    if (email.trim().toLowerCase() === TEST_EMAIL) {
      setShowForgot(false);
      setMessage('Reset link ready for test@example.com.');
      setMessageTone('success');
    } else {
      showError('Enter test@example.com first.');
    }
  }

  if (view === 'home') {
    return <main className="homepage-dummy" aria-label="Homepage" />;
  }

  const isLogin = mode === 'login';
  const isError = messageTone === 'error' && Boolean(message) && !loading;

  return (
    <main
      className="auth-page"
      style={{ backgroundImage: `url(${blackboardUrl})` }}
    >
      <section className="auth-board-content" aria-label="Authentication">
        <form className="chalk-auth-form" onSubmit={placeholderTest}>
          <div className="chalk-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              className={`chalk-tab${isLogin ? ' is-active' : ''}`}
              aria-selected={isLogin}
              role="tab"
              onClick={() => switchMode('login')}
            >
              Login
            </button>
            <button
              type="button"
              className={`chalk-tab${!isLogin ? ' is-active' : ''}`}
              aria-selected={!isLogin}
              role="tab"
              onClick={() => switchMode('signup')}
            >
              Sign Up
            </button>
          </div>

          <input
            className="chalk-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            aria-label="Email"
            autoComplete="email"
            disabled={loading}
          />

          <input
            className="chalk-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            aria-label="Password"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            disabled={loading}
          />

          {message ? (
            <div className={`chalk-message chalk-message--${messageTone}`} role={isError ? 'alert' : 'status'}>
              {message}
            </div>
          ) : null}

          {isLogin && showForgot ? (
            <button type="button" className="chalk-forgot" onClick={handleResetPassword}>
              Forget Password?
            </button>
          ) : null}

          <button ref={submitButtonRef} type="submit" className="chalk-submit" disabled={loading}>
            {isLogin ? 'Login' : 'Sign Up'}
          </button>
        </form>
      </section>

      <section className="auth-owl-region" aria-label="Owl assistant">
        <div className="auth-owl-shell">
          <OwlContainer
            variant="desktop"
            standby="head-rotate"
            onAnimatorReady={(animator) => {
              owlAnimatorRef.current = animator;
            }}
            animation={{
              loading,
              error: isError,
              errorKey,
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
