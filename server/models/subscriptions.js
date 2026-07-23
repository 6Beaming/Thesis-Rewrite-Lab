import { query, withTransaction } from './db.js';
import { randomUUID } from 'node:crypto';

export const ACCESS_STATES = new Set([
  'basic',
  'processing',
  'pro',
  'payment_failed',
]);

const PRODUCT_USER_SUBSCRIPTION_FIELDS = `
  id,
  auth_user_id,
  stripe_customer_id,
  stripe_subscription_id,
  stripe_price_id,
  stripe_subscription_status,
  latest_invoice_status,
  access_state,
  cancel_at_period_end,
  current_period_end,
  subscription_updated_at,
  stripe_checkout_session_id,
  stripe_checkout_session_expires_at,
  stripe_checkout_attempt_token,
  stripe_checkout_attempt_started_at
`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dateToIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function asNullableString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function hasProAccess(subscription) {
  return subscription?.access_state === 'pro';
}

export function publicSubscription(subscription, price = null) {
  const accessState = ACCESS_STATES.has(subscription?.access_state)
    ? subscription.access_state
    : 'basic';
  const stripeStatus = asNullableString(subscription?.stripe_subscription_status) || 'none';
  return {
    plan: accessState === 'pro' ? 'pro' : 'basic',
    accessState,
    hasProAccess: accessState === 'pro',
    stripeStatus,
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
    currentPeriodEnd: dateToIso(subscription?.current_period_end),
    recoveryRequired: accessState === 'payment_failed',
    price: price
      ? {
        amount: Number(price.amount),
        currency: String(price.currency ?? '').toUpperCase(),
        interval: String(price.interval ?? 'month'),
      }
      : null,
  };
}

export async function getSubscriptionForUserId(userId, runQuery = query) {
  const result = await runQuery(
    `
      select ${PRODUCT_USER_SUBSCRIPTION_FIELDS}
      from users
      where id = $1
    `,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function findSubscriptionUser({
  productUserId = null,
  customerId = null,
  subscriptionId = null,
} = {}, runQuery = query) {
  const safeProductUserId = UUID_PATTERN.test(String(productUserId ?? ''))
    ? productUserId
    : null;
  const safeCustomerId = asNullableString(customerId);
  const safeSubscriptionId = asNullableString(subscriptionId);
  if (!safeProductUserId && !safeCustomerId && !safeSubscriptionId) return null;

  const result = await runQuery(
    `
      select ${PRODUCT_USER_SUBSCRIPTION_FIELDS}
      from users
      where ($1::uuid is not null and id = $1)
         or ($2::text is not null and stripe_customer_id = $2)
         or ($3::text is not null and stripe_subscription_id = $3)
      order by id
      limit 1
    `,
    [safeProductUserId, safeCustomerId, safeSubscriptionId],
  );
  return result.rows[0] ?? null;
}

export async function saveStripeCustomerId(userId, customerId, runQuery = query) {
  const normalizedCustomerId = asNullableString(customerId);
  if (!normalizedCustomerId) throw new TypeError('A Stripe customer ID is required');
  const result = await runQuery(
    `
      update users
      set stripe_customer_id = $2,
          subscription_updated_at = now()
      where id = $1
      returning ${PRODUCT_USER_SUBSCRIPTION_FIELDS}
    `,
    [userId, normalizedCustomerId],
  );
  return result.rows[0] ?? null;
}

export async function reserveCheckoutAttempt(
  userId,
  {
    now = () => new Date(),
    nextToken = randomUUID,
    transaction = withTransaction,
  } = {},
) {
  const currentTime = now();
  const reusableAttemptAfter = new Date(currentTime.getTime() - (10 * 60 * 1000));
  return transaction(async (client) => {
    const currentResult = await client.query(
      `
        select ${PRODUCT_USER_SUBSCRIPTION_FIELDS}
        from users
        where id = $1
        for update
      `,
      [userId],
    );
    const current = currentResult.rows[0] ?? null;
    if (!current) throw new Error('Product user was not found');
    const existingExpiry = current.stripe_checkout_session_expires_at
      ? new Date(current.stripe_checkout_session_expires_at)
      : null;
    if (
      current.stripe_checkout_session_id
      && existingExpiry
      && Number.isFinite(existingExpiry.getTime())
      && existingExpiry > currentTime
    ) {
      return {
        sessionId: current.stripe_checkout_session_id,
        attemptToken: current.stripe_checkout_attempt_token,
        reusedSession: true,
      };
    }

    const startedAt = current.stripe_checkout_attempt_started_at
      ? new Date(current.stripe_checkout_attempt_started_at)
      : null;
    const attemptToken = (
      current.stripe_checkout_attempt_token
      && startedAt
      && Number.isFinite(startedAt.getTime())
      && startedAt >= reusableAttemptAfter
    )
      ? current.stripe_checkout_attempt_token
      : nextToken();
    await client.query(
      `
        update users
        set stripe_checkout_session_id = null,
            stripe_checkout_session_expires_at = null,
            stripe_checkout_attempt_token = $2,
            stripe_checkout_attempt_started_at = $3,
            subscription_updated_at = now()
        where id = $1
      `,
      [userId, attemptToken, currentTime],
    );
    return { sessionId: null, attemptToken, reusedSession: false };
  });
}

export async function saveCheckoutSession({ userId, attemptToken, sessionId, expiresAt }, runQuery = query) {
  const normalizedSessionId = asNullableString(sessionId);
  const normalizedAttemptToken = asNullableString(attemptToken);
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (!normalizedSessionId || !normalizedAttemptToken || !Number.isFinite(expiry.getTime())) {
    throw new TypeError('A valid Stripe Checkout session is required');
  }
  const result = await runQuery(
    `
      update users
      set stripe_checkout_session_id = $3,
          stripe_checkout_session_expires_at = $4,
          subscription_updated_at = now()
      where id = $1
        and stripe_checkout_attempt_token = $2
      returning ${PRODUCT_USER_SUBSCRIPTION_FIELDS}
    `,
    [userId, normalizedAttemptToken, normalizedSessionId, expiry],
  );
  return result.rows[0] ?? null;
}

export async function clearCheckoutAttempt(userId, runQuery = query) {
  const result = await runQuery(
    `
      update users
      set stripe_checkout_session_id = null,
          stripe_checkout_session_expires_at = null,
          stripe_checkout_attempt_token = null,
          stripe_checkout_attempt_started_at = null,
          subscription_updated_at = now()
      where id = $1
      returning ${PRODUCT_USER_SUBSCRIPTION_FIELDS}
    `,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function saveSubscriptionState({
  userId,
  customerId = null,
  subscriptionId = null,
  priceId = null,
  subscriptionStatus = null,
  invoiceStatus = null,
  accessState = 'basic',
  cancelAtPeriodEnd = false,
  currentPeriodEnd = null,
}, runQuery = query) {
  if (!ACCESS_STATES.has(accessState)) {
    throw new TypeError('Invalid subscription access state');
  }
  const result = await runQuery(
    `
      update users
      set stripe_customer_id = coalesce($2, stripe_customer_id),
          stripe_subscription_id = coalesce($3, stripe_subscription_id),
          stripe_price_id = $4,
          stripe_subscription_status = $5,
          latest_invoice_status = $6,
          access_state = $7,
          cancel_at_period_end = $8,
          current_period_end = $9,
          stripe_checkout_session_id = case when $3 is null then stripe_checkout_session_id else null end,
          stripe_checkout_session_expires_at = case when $3 is null then stripe_checkout_session_expires_at else null end,
          stripe_checkout_attempt_token = case when $3 is null then stripe_checkout_attempt_token else null end,
          stripe_checkout_attempt_started_at = case when $3 is null then stripe_checkout_attempt_started_at else null end,
          subscription_updated_at = now()
      where id = $1
      returning ${PRODUCT_USER_SUBSCRIPTION_FIELDS}
    `,
    [
      userId,
      asNullableString(customerId),
      asNullableString(subscriptionId),
      asNullableString(priceId),
      asNullableString(subscriptionStatus),
      asNullableString(invoiceStatus),
      accessState,
      Boolean(cancelAtPeriodEnd),
      currentPeriodEnd ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function recordWebhookEvent({ eventId, eventType, eventCreatedAt }, runQuery = query) {
  const normalizedEventId = asNullableString(eventId);
  const normalizedEventType = asNullableString(eventType);
  const eventDate = eventCreatedAt instanceof Date
    ? eventCreatedAt
    : new Date(eventCreatedAt);
  if (!normalizedEventId || !normalizedEventType || !Number.isFinite(eventDate.getTime())) {
    throw new TypeError('A valid Stripe webhook event is required');
  }
  const existing = await runQuery(
    'select event_id from stripe_webhook_events where event_id = $1',
    [normalizedEventId],
  );
  if (existing.rows.length) return false;
  const result = await runQuery(
    `
      insert into stripe_webhook_events (event_id, event_type, event_created_at)
      values ($1, $2, $3)
      on conflict (event_id) do nothing
      returning event_id
    `,
    [normalizedEventId, normalizedEventType, eventDate],
  );
  return result.rows.length === 1;
}
