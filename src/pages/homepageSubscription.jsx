import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../components/AuthProvider.jsx';
import { useRealtime } from '../components/RealtimeProvider.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import {
  cancelSubscription,
  createCheckoutSession,
  createCustomerPortal,
  resumeSubscription,
} from '../services/subscriptionApi.js';

function CheckIcon() {
  return (
    <svg className="subscription-check" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.25 2.25 4.75-5" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="subscription-warning" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9 9 6 6m0-6-6 6" />
    </svg>
  );
}

function formatPrice(price) {
  if (!price?.currency || !Number.isFinite(Number(price.amount))) return 'your configured monthly price';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: price.currency,
    minimumFractionDigits: 2,
  }).format(Number(price.amount));
}

function formatPeriodEnd(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return 'the end of your current billing period';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'long',
  }).format(date);
}

const BENEFITS = [
  'Rewrite full sentences with a click',
  'Instant citations in APA, MLA, Chicago',
  'Customized format with a rich text editor',
  'Unlimited AI rewriting tutorial',
  'Unlimited personalized suggestions',
  'Write fluently in English',
];

const REFERENCE_MONTHLY_PRICE = '$10.00';

export default function HomepageSubscription() {
  const { signOut } = useAuth();
  const { state, applySubscription, refreshSubscription } = useRealtime();
  const navigate = useNavigate();
  const location = useLocation();
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('pro');
  const [dialog, setDialog] = useState(null);
  const subscription = state.subscription;
  const checkoutState = useMemo(
    () => new URLSearchParams(location.search).get('checkout'),
    [location.search],
  );
  const checkoutSessionId = useMemo(
    () => new URLSearchParams(location.search).get('session_id'),
    [location.search],
  );
  const entry = useMemo(
    () => new URLSearchParams(location.search).get('entry'),
    [location.search],
  );
  const displayPrice = formatPrice(subscription?.price);
  const isLoading = state.subscriptionLoading || !subscription;
  const isPro = Boolean(subscription?.hasProAccess);
  const isPaymentFailed = subscription?.accessState === 'payment_failed';
  const isProcessing = subscription?.accessState === 'processing';
  const isBasicSelected = !isPro && selectedPlan === 'basic';
  const isProSelected = selectedPlan === 'pro';
  const periodEnd = formatPeriodEnd(subscription?.currentPeriodEnd);

  useEffect(() => {
    document.documentElement.classList.add('subscription-page-active');
    document.body.classList.add('subscription-page-active');
    return () => {
      document.documentElement.classList.remove('subscription-page-active');
      document.body.classList.remove('subscription-page-active');
    };
  }, []);

  useEffect(() => {
    if (checkoutState !== 'cancelled') return undefined;
    setNotice('Checkout was cancelled. You have been signed out.');
    const timer = window.setTimeout(() => {
      signOut(new URL('/?reason=checkout-cancelled', window.location.origin).href);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [checkoutState, signOut]);

  useEffect(() => {
    if (checkoutState !== 'success' || isPro || isPaymentFailed) return undefined;
    let cancelled = false;
    let attempts = 0;
    let timer;

    const refresh = async () => {
      attempts += 1;
      try {
        const next = await refreshSubscription({ checkoutSessionId });
        if (cancelled) return;
        if (next?.hasProAccess) {
          navigate('/', { replace: true });
          return;
        }
      } catch {
        // The normal realtime reconnect path will retry as well.
      }
      if (!cancelled && attempts < 10) {
        timer = window.setTimeout(refresh, 2_000);
      } else if (!cancelled) {
        setNotice('Your payment is still being confirmed. Keep this page open or refresh it shortly.');
      }
    };

    refresh();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [checkoutSessionId, checkoutState, isPaymentFailed, isPro, navigate, refreshSubscription]);

  useEffect(() => {
    if (
      checkoutState !== 'success'
      || !isPaymentFailed
      || subscription?.stripeStatus !== 'incomplete'
    ) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      signOut(new URL('/?reason=payment-failed', window.location.origin).href);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [checkoutState, isPaymentFailed, signOut, subscription?.stripeStatus]);

  useEffect(() => {
    if (checkoutState === 'success' && isPro) {
      navigate('/', { replace: true });
    }
  }, [checkoutState, isPro, navigate]);

  useEffect(() => {
    if (entry === 'auth' && isPro) {
      navigate('/', { replace: true });
    }
  }, [entry, isPro, navigate]);

  useEffect(() => {
    if (isPro) setSelectedPlan('pro');
  }, [isPro]);

  async function handleCheckout() {
    if (busyAction || isLoading || isPro || isProcessing) return;
    setBusyAction('checkout');
    setNotice('Opening secure Stripe Checkout…');
    try {
      const result = await createCheckoutSession();
      window.location.assign(result.url);
    } catch (error) {
      setNotice(error.message || 'Could not start Stripe Checkout.');
      setBusyAction('');
    }
  }

  async function handleSubscriptionAction(action, { leaveAfter = false } = {}) {
    if (busyAction) return;
    setBusyAction(action);
    setNotice('');
    try {
      const result = action === 'cancel'
        ? await cancelSubscription()
        : await resumeSubscription();
      applySubscription(result.subscription);
      setNotice(action === 'cancel'
        ? 'Your Pro plan will remain available until the end of this billing period.'
        : 'Auto-renew has been restored.');
      if (leaveAfter) navigate('/');
      return result.subscription;
    } catch (error) {
      setNotice(error.message || 'Could not update your subscription.');
      return null;
    } finally {
      setBusyAction('');
    }
  }

  async function handlePaymentRecovery() {
    if (busyAction) return;
    setBusyAction('portal');
    try {
      const result = await createCustomerPortal();
      window.location.assign(result.url);
    } catch (error) {
      setNotice(error.message || 'Could not open the billing portal.');
      setBusyAction('');
    }
  }

  function handleProceed() {
    if (isPro) {
      if (subscription?.cancelAtPeriodEnd) {
        setDialog('leave-cancelled-pro');
        return;
      }
      navigate('/');
      return;
    }
    if (isPaymentFailed || isProcessing || isLoading || busyAction) return;
    setDialog('leave-without-subscription');
  }

  function handleSelectBasic() {
    if (isLoading || busyAction) return;
    if (isPro) {
      setDialog('switch-to-basic');
      return;
    }
    setSelectedPlan('basic');
  }

  function handleSelectPro() {
    if (isLoading || busyAction) return;
    setSelectedPlan('pro');
  }

  function handleCardKeyDown(event, selectPlan) {
    if (event.currentTarget !== event.target || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    selectPlan();
  }

  function leaveWithoutSubscription() {
    setDialog(null);
    signOut(new URL('/?reason=subscription-required', window.location.origin).href);
  }

  async function leaveWithCancellation() {
    setDialog(null);
    if (subscription?.cancelAtPeriodEnd) {
      navigate('/');
      return;
    }
    await handleSubscriptionAction('cancel', { leaveAfter: true });
  }

  let proAction;
  if (!isPro && !isProSelected) {
    proAction = <button type="button" className="subscription-primary" disabled>Select Pro to subscribe</button>;
  } else if (isLoading) {
    proAction = <button type="button" className="subscription-primary" disabled>Checking subscription…</button>;
  } else if (isPaymentFailed) {
    proAction = (
      <button type="button" className="subscription-recovery" onClick={handlePaymentRecovery} disabled={Boolean(busyAction)}>
        {busyAction === 'portal' ? 'Opening billing portal…' : 'Update payment to resume'}
      </button>
    );
  } else if (isProcessing) {
    proAction = <button type="button" className="subscription-primary" disabled>Confirming your payment…</button>;
  } else if (isPro && subscription.cancelAtPeriodEnd) {
    proAction = (
      <button
        type="button"
        className="subscription-secondary"
        onClick={() => handleSubscriptionAction('resume')}
        disabled={Boolean(busyAction)}
      >
        {busyAction === 'resume' ? 'Restoring auto-renew…' : 'Resume auto-renew'}
      </button>
    );
  } else if (isPro) {
    proAction = (
      <button
        type="button"
        className="subscription-secondary"
        onClick={() => handleSubscriptionAction('cancel')}
        disabled={Boolean(busyAction)}
      >
        {busyAction === 'cancel' ? 'Scheduling cancellation…' : 'Cancel at period end'}
      </button>
    );
  } else {
    proAction = (
      <button type="button" className="subscription-primary" onClick={handleCheckout} disabled={Boolean(busyAction)}>
        {busyAction === 'checkout' ? 'Opening Checkout…' : `Try for ${displayPrice}`}
      </button>
    );
  }

  return (
    <main className="subscription-page">
      <section className="subscription-shell" aria-label="Subscription plans">
        <div className="subscription-cards" aria-label="Choose a plan" role="radiogroup">
          <article
            className={`subscription-card subscription-card--basic${isBasicSelected ? ' is-selected' : ''}`}
            aria-checked={isBasicSelected}
            aria-label="Basic plan"
            onClick={handleSelectBasic}
            onKeyDown={(event) => handleCardKeyDown(event, handleSelectBasic)}
            role="radio"
            tabIndex={0}
          >
            {isBasicSelected ? <div className="subscription-basic-banner">Basic is unavailable in this beta.</div> : null}
            <h2>Basic</h2>
            <p className="subscription-card-summary">Free plan for entry-level writing support, currently unavailable.</p>
            <button type="button" className="subscription-current" disabled>{isPro ? 'Switch to Basic' : 'Current plan'}</button>
            <div className="subscription-basic-warning">
              <WarningIcon />
              <p>Sorry, currently we don&apos;t support free trial. You will be signed out if you proceed with the Basic account.</p>
            </div>
          </article>

          <article
            className={`subscription-card subscription-card--pro${isProSelected ? ' is-selected' : ''}`}
            aria-checked={isProSelected}
            aria-label="Pro plan"
            onClick={handleSelectPro}
            onKeyDown={(event) => handleCardKeyDown(event, handleSelectPro)}
            role="radio"
            tabIndex={0}
          >
            {isProSelected ? <div className="subscription-pro-banner">Best for school <span aria-hidden="true">✦</span></div> : null}
            <h2>Pro</h2>
            <p className="subscription-card-summary">Ace your thesis with clear and confident writing!</p>

            {isPro ? (
              <div className="subscription-active-copy">
                <strong>{subscription.cancelAtPeriodEnd ? 'Pro remains active' : 'Active Pro member'}</strong>
                <span>{subscription.cancelAtPeriodEnd
                  ? `Your plan expires on ${formatPeriodEnd(subscription.currentPeriodEnd)}.`
                  : 'Your workspace is fully unlocked.'}
                </span>
              </div>
            ) : isPaymentFailed ? (
              <div className="subscription-active-copy subscription-active-copy--failed">
                <strong>Payment needs attention</strong>
                <span>Update your payment method in Stripe to restore Pro access.</span>
              </div>
            ) : (
              <div className="subscription-price-row">
                <span className="subscription-price">{REFERENCE_MONTHLY_PRICE}</span>
                <span className="subscription-currency">{subscription?.price?.currency ?? 'USD'} / month</span>
                <span className="subscription-discount">Enjoy a huge discount</span>
              </div>
            )}

            {proAction}

            <ul className="subscription-benefits">
              {BENEFITS.map((benefit) => (
                <li key={benefit}><CheckIcon />{benefit}</li>
              ))}
            </ul>
          </article>
        </div>

        {notice || state.error ? (
          <p className="subscription-notice" role="status">{notice || state.error}</p>
        ) : null}

        <div className="subscription-proceed-row">
          <button
            type="button"
            className="subscription-proceed"
            onClick={handleProceed}
            disabled={isLoading || isProcessing || isPaymentFailed || Boolean(busyAction)}
          >
            Proceed
          </button>
        </div>

        {dialog === 'leave-without-subscription' ? (
          <ConfirmModal
            title="Leave without subscribing?"
            confirmLabel="Leave"
            modalClassName="subscription-leave-modal"
            onCancel={() => setDialog(null)}
            onConfirm={leaveWithoutSubscription}
          >
            You have not subscribed to Pro. Leaving this page will sign you out.
          </ConfirmModal>
        ) : null}

        {dialog === 'leave-cancelled-pro' ? (
          <ConfirmModal
            title="Leave with cancellation scheduled?"
            confirmLabel="Leave"
            modalClassName="subscription-leave-modal"
            onCancel={() => setDialog(null)}
            onConfirm={() => {
              setDialog(null);
              navigate('/');
            }}
          >
            Your subscription is scheduled to end on {periodEnd}. Pro access remains available until then.
          </ConfirmModal>
        ) : null}

        {dialog === 'switch-to-basic' ? (
          <ConfirmModal
            title="Switch to Basic?"
            confirmLabel="Leave with cancellation"
            alternateLabel="Leave with subscription"
            modalClassName="subscription-leave-modal"
            onCancel={() => setDialog(null)}
            onAlternate={() => {
              setDialog(null);
              navigate('/');
            }}
            onConfirm={leaveWithCancellation}
          >
            Basic is unavailable. Leaving with cancellation schedules your Pro plan to end on {periodEnd}; your access remains unchanged until then.
          </ConfirmModal>
        ) : null}
      </section>
    </main>
  );
}
