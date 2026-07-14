import Stripe from 'stripe';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { withTransaction } from '../models/db.js';
import {
  findSubscriptionUser,
  getSubscriptionForUserId,
  hasProAccess,
  publicSubscription,
  recordWebhookEvent,
  reserveCheckoutAttempt,
  saveCheckoutSession,
  clearCheckoutAttempt,
  saveStripeCustomerId,
  saveSubscriptionState,
} from '../models/subscriptions.js';

const TERMINAL_SUBSCRIPTION_STATUSES = new Set([
  'canceled',
  'incomplete_expired',
  'unpaid',
  'paused',
]);
const FAILED_INVOICE_STATUSES = new Set(['open', 'uncollectible', 'void']);
const REFUND_EVENTS = new Set(['refund.created', 'refund.updated']);
const MINIMUM_USD_CENTS = 50;
const PRODUCT_USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let stripeClient;

function httpError(message, statusCode, publicCode = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicCode = publicCode;
  return error;
}

function objectId(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

function unixSecondsToDate(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

function currentPeriodEnd(subscription) {
  const item = subscription?.items?.data?.[0] ?? null;
  return unixSecondsToDate(item?.current_period_end ?? subscription?.current_period_end);
}

function subscriptionMetadata(subscription) {
  return subscription?.metadata && typeof subscription.metadata === 'object'
    ? subscription.metadata
    : {};
}

export function getStripeConfig(environment = process.env) {
  const secretKey = String(environment.STRIPE_SECRET_KEY ?? '').trim();
  const webhookSecret = String(environment.STRIPE_WEBHOOK_SECRET ?? '').trim();
  const productId = String(environment.STRIPE_PRODUCT_ID ?? '').trim();
  const priceId = String(environment.STRIPE_PRICE_ID ?? '').trim();
  const appOrigin = String(environment.APP_ORIGIN ?? 'http://localhost:5173').trim();
  if (!secretKey || !webhookSecret || !productId || !priceId) {
    throw httpError('Stripe configuration is incomplete', 500, 'STRIPE_CONFIGURATION_ERROR');
  }
  if (!/^https?:\/\//.test(appOrigin)) {
    throw httpError('APP_ORIGIN must be an HTTP(S) origin', 500, 'STRIPE_CONFIGURATION_ERROR');
  }
  if (environment.NODE_ENV !== 'production' && !secretKey.startsWith('sk_test_')) {
    throw httpError('Development Stripe configuration must use a test secret key', 500, 'STRIPE_CONFIGURATION_ERROR');
  }
  return {
    secretKey,
    webhookSecret,
    productId,
    priceId,
    appOrigin: new URL(appOrigin).origin,
  };
}

function getStripeClient(config = getStripeConfig()) {
  if (!stripeClient) stripeClient = new Stripe(config.secretKey);
  return stripeClient;
}

export function resetStripeClientForTests() {
  stripeClient = undefined;
}

export async function getValidatedStripePrice(stripe, config) {
  const price = await stripe.prices.retrieve(config.priceId, {
    expand: ['product'],
  });
  const productId = objectId(price.product);
  if (
    !price.active
    || price.livemode
    || price.type !== 'recurring'
    || price.recurring?.interval !== 'month'
    || productId !== config.productId
    || price.currency?.toLowerCase() !== 'usd'
    || !Number.isInteger(price.unit_amount)
    || price.unit_amount < MINIMUM_USD_CENTS
  ) {
    throw httpError(
      'Configured Stripe Price must be an active test USD monthly recurring Price of at least $0.50 for the configured Product',
      500,
      'STRIPE_CONFIGURATION_ERROR',
    );
  }
  return {
    id: price.id,
    productId,
    amount: price.unit_amount / 100,
    currency: price.currency.toUpperCase(),
    interval: price.recurring.interval,
  };
}

function configuredSubscriptionItem(subscription, config) {
  const item = (subscription?.items?.data ?? []).find((candidate) => {
    const price = candidate?.price;
    return objectId(price) === config.priceId
      && objectId(price?.product) === config.productId;
  });
  if (!item?.price) return null;
  const price = item.price;
  if (price.id && price.id !== config.priceId) return null;
  const productId = objectId(price.product);
  if (productId && productId !== config.productId) return null;
  return item;
}

function invoiceStatusFromSubscription(subscription) {
  const invoice = subscription?.latest_invoice;
  return typeof invoice === 'object' && invoice ? invoice.status ?? null : null;
}

function invoiceSubscriptionId(invoice) {
  return objectId(invoice?.subscription)
    ?? objectId(invoice?.parent?.subscription_details?.subscription);
}

function isFullyRefundedCharge(charge) {
  const amount = Number(charge?.amount);
  const refundedAmount = Number(charge?.amount_refunded);
  return Boolean(
    Number.isFinite(amount)
    && amount > 0
    && Number.isFinite(refundedAmount)
    && (charge?.refunded || refundedAmount >= amount),
  );
}

function isSucceededFullRefund(refund, charge) {
  return refund?.status === 'succeeded' && isFullyRefundedCharge(charge);
}

export function deriveAccessState({
  subscriptionStatus,
  invoiceStatus = null,
  eventType = '',
  previousAccessState = 'basic',
}) {
  if (TERMINAL_SUBSCRIPTION_STATUSES.has(subscriptionStatus)) return 'basic';
  if (eventType === 'invoice.payment_failed' || subscriptionStatus === 'past_due') {
    return 'payment_failed';
  }
  if (eventType === 'checkout.session.completed') {
    return previousAccessState === 'pro' ? 'pro' : 'processing';
  }
  if (subscriptionStatus === 'incomplete') {
    return invoiceStatus === 'paid' ? 'pro' : 'processing';
  }
  if (subscriptionStatus === 'active') {
    if (invoiceStatus === 'paid') return 'pro';
    if (FAILED_INVOICE_STATUSES.has(invoiceStatus)) return 'payment_failed';
    return previousAccessState === 'pro' ? 'pro' : 'processing';
  }
  return 'basic';
}

export function subscriptionStateFromStripe({ subscription, eventType, previousSubscription }) {
  const status = String(subscription?.status ?? 'canceled');
  const invoiceStatus = invoiceStatusFromSubscription(subscription);
  return {
    customerId: objectId(subscription?.customer),
    subscriptionId: objectId(subscription),
    priceId: configuredSubscriptionItem(subscription, {
      productId: subscription?.__configuredProductId,
      priceId: subscription?.__configuredPriceId,
    })?.price?.id ?? subscription?.items?.data?.[0]?.price?.id ?? null,
    subscriptionStatus: status,
    invoiceStatus,
    accessState: deriveAccessState({
      subscriptionStatus: status,
      invoiceStatus,
      eventType,
      previousAccessState: previousSubscription?.access_state ?? 'basic',
    }),
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
    currentPeriodEnd: currentPeriodEnd(subscription),
  };
}

async function retrieveCanonicalSubscription(stripe, subscriptionId) {
  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['latest_invoice', 'items.data.price.product'],
  });
}

async function reconcileSubscription({
  subscription,
  eventType,
  config,
  user,
  runQuery,
}) {
  const configuredItem = configuredSubscriptionItem(subscription, config);
  if (!configuredItem) return null;
  const state = subscriptionStateFromStripe({
    subscription: {
      ...subscription,
      __configuredPriceId: config.priceId,
      __configuredProductId: config.productId,
    },
    eventType,
    previousSubscription: user,
  });
  return saveSubscriptionState({ userId: user.id, ...state }, runQuery);
}

function productUserIdFromStripeObject(object, subscription) {
  const candidates = [
    subscriptionMetadata(subscription).productUserId,
    subscriptionMetadata(object).productUserId,
    object?.client_reference_id,
  ];
  return candidates.find((value) => PRODUCT_USER_ID_PATTERN.test(String(value ?? ''))) ?? null;
}

async function resolveWebhookSubscription(stripe, event) {
  const object = event?.data?.object;
  if (!object || typeof object !== 'object') return null;
  if (event.type === 'customer.subscription.deleted') return object;
  const subscriptionId = event.type.startsWith('customer.subscription.')
    ? objectId(object)
    : objectId(object.subscription);
  if (!subscriptionId) return null;
  return retrieveCanonicalSubscription(stripe, subscriptionId);
}

async function resolvePaymentIntentCharge(stripe, paymentIntentId) {
  if (!paymentIntentId) return null;
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge'],
  });
  const paymentIntentChargeId = objectId(paymentIntent?.latest_charge);
  return paymentIntentChargeId ? stripe.charges.retrieve(paymentIntentChargeId) : null;
}

async function resolveRefundCharge(stripe, refund) {
  const chargeId = objectId(refund?.charge);
  if (chargeId) return stripe.charges.retrieve(chargeId);
  return resolvePaymentIntentCharge(stripe, objectId(refund?.payment_intent));
}

async function resolveInvoiceCharge(stripe, invoice) {
  const directChargeId = objectId(invoice?.charge);
  if (directChargeId) return stripe.charges.retrieve(directChargeId);
  const directPaymentIntentId = objectId(invoice?.payment_intent);
  if (directPaymentIntentId) return resolvePaymentIntentCharge(stripe, directPaymentIntentId);
  const invoicePayment = (invoice?.payments?.data ?? []).find((payment) => (
    objectId(payment?.payment?.charge) || objectId(payment?.payment?.payment_intent)
  ));
  const invoicePaymentChargeId = objectId(invoicePayment?.payment?.charge);
  if (invoicePaymentChargeId) return stripe.charges.retrieve(invoicePaymentChargeId);
  return resolvePaymentIntentCharge(stripe, objectId(invoicePayment?.payment?.payment_intent));
}

async function cancelSubscriptionForRefund(stripe, subscriptionId, eventId) {
  let subscription = await retrieveCanonicalSubscription(stripe, subscriptionId);
  if (TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)) return subscription;
  try {
    await stripe.subscriptions.cancel(subscriptionId, {}, {
      idempotencyKey: `thesis-stripe-refund-revoke:${eventId}`,
    });
  } catch (error) {
    subscription = await retrieveCanonicalSubscription(stripe, subscriptionId);
    if (!TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status)) throw error;
    return subscription;
  }
  return retrieveCanonicalSubscription(stripe, subscriptionId);
}

async function handleRefundWebhookEvent(event, {
  stripe,
  config,
  eventPublisher = null,
} = {}) {
  const refund = event?.data?.object;
  const eventCreatedAt = unixSecondsToDate(event?.created);
  if (!event?.id || !eventCreatedAt || !refund || typeof refund !== 'object') {
    throw httpError('Stripe webhook event is invalid', 400, 'STRIPE_WEBHOOK_INVALID');
  }
  if (refund.status !== 'succeeded') return { ignored: true };

  const charge = await resolveRefundCharge(stripe, refund);
  if (!isSucceededFullRefund(refund, charge)) return { ignored: true };
  const invoiceId = objectId(charge?.invoice);
  if (!invoiceId) return { ignored: true };
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return { ignored: true };

  const originalSubscription = await retrieveCanonicalSubscription(stripe, subscriptionId);
  if (!configuredSubscriptionItem(originalSubscription, config)) return { ignored: true };
  const customerId = objectId(originalSubscription.customer) ?? objectId(charge.customer);
  const productUserId = productUserIdFromStripeObject(charge, originalSubscription);
  const canceledSubscription = await cancelSubscriptionForRefund(stripe, subscriptionId, event.id);

  const result = await withTransaction(async (client) => {
    const claimed = await recordWebhookEvent({
      eventId: event.id,
      eventType: event.type,
      eventCreatedAt,
    }, client.query.bind(client));
    if (!claimed) return { duplicate: true, subscription: null, user: null };

    const user = await findSubscriptionUser({
      productUserId,
      customerId,
      subscriptionId,
    }, client.query.bind(client));
    if (!user) return { ignored: true, subscription: null, user: null };
    const updated = await reconcileSubscription({
      subscription: canceledSubscription,
      eventType: 'customer.subscription.deleted',
      config,
      user,
      runQuery: client.query.bind(client),
    });
    return { duplicate: false, ignored: !updated, subscription: updated, user };
  });

  if (result.subscription && result.user?.auth_user_id && eventPublisher) {
    eventPublisher.publishSubscription({
      authUserId: result.user.auth_user_id,
      productUserId: result.subscription.id,
      subscription: publicSubscription(result.subscription),
    });
  }
  return result;
}

export async function handleStripeWebhookEvent(event, {
  stripe,
  config,
  eventPublisher = null,
} = {}) {
  const supported = new Set([
    'checkout.session.completed',
    'invoice.paid',
    'invoice.payment_failed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    ...REFUND_EVENTS,
  ]);
  if (!supported.has(event?.type)) return { ignored: true };
  if (REFUND_EVENTS.has(event.type)) {
    return handleRefundWebhookEvent(event, { stripe, config, eventPublisher });
  }

  const subscription = await resolveWebhookSubscription(stripe, event);
  if (!subscription) return { ignored: true };
  const object = event.data.object;
  const customerId = objectId(subscription.customer) ?? objectId(object.customer);
  const subscriptionId = objectId(subscription);
  const productUserId = productUserIdFromStripeObject(object, subscription);
  const eventCreatedAt = unixSecondsToDate(event.created);
  if (!event?.id || !eventCreatedAt) {
    throw httpError('Stripe webhook event is invalid', 400, 'STRIPE_WEBHOOK_INVALID');
  }

  const result = await withTransaction(async (client) => {
    const claimed = await recordWebhookEvent({
      eventId: event.id,
      eventType: event.type,
      eventCreatedAt,
    }, client.query.bind(client));
    if (!claimed) return { duplicate: true, subscription: null, user: null };

    const user = await findSubscriptionUser({
      productUserId,
      customerId,
      subscriptionId,
    }, client.query.bind(client));
    if (!user) return { ignored: true, subscription: null, user: null };

    const updated = await reconcileSubscription({
      subscription,
      eventType: event.type,
      config,
      user,
      runQuery: client.query.bind(client),
    });
    return { duplicate: false, ignored: !updated, subscription: updated, user };
  });

  if (result.subscription && result.user?.auth_user_id && eventPublisher) {
    eventPublisher.publishSubscription({
      authUserId: result.user.auth_user_id,
      productUserId: result.subscription.id,
      subscription: publicSubscription(result.subscription),
    });
  }
  return result;
}

async function ensureStripeCustomer({ stripe, productUser, sessionUser, subscription }) {
  if (subscription?.stripe_customer_id) {
    const existing = await stripe.customers.retrieve(subscription.stripe_customer_id);
    if (!existing.deleted) return existing.id;
  }
  const customer = await stripe.customers.create({
    email: String(sessionUser?.email ?? '').trim() || undefined,
    name: String(sessionUser?.name ?? '').trim() || undefined,
    metadata: { productUserId: productUser.id },
  }, {
    idempotencyKey: `thesis-stripe-customer:${productUser.id}`,
  });
  await saveStripeCustomerId(productUser.id, customer.id);
  return customer.id;
}

function ownsStripeSubscription(subscription, localSubscription) {
  return Boolean(
    subscription
    && localSubscription?.stripe_subscription_id
    && subscription.id === localSubscription.stripe_subscription_id
    && objectId(subscription.customer) === localSubscription.stripe_customer_id,
  );
}

function checkoutSessionProductUserId(checkoutSession) {
  return productUserIdFromStripeObject(checkoutSession, checkoutSession?.subscription);
}

function checkoutSessionIsOwnedByUser({ checkoutSession, localSubscription, productUser }) {
  const checkoutSubscriptionId = objectId(checkoutSession?.subscription);
  if (
    checkoutSession?.mode !== 'subscription'
    || checkoutSession?.status !== 'complete'
    || !checkoutSubscriptionId
    || objectId(checkoutSession.customer) !== localSubscription?.stripe_customer_id
    || checkoutSessionProductUserId(checkoutSession) !== productUser?.id
  ) {
    return false;
  }
  if (localSubscription?.stripe_checkout_session_id) {
    return checkoutSession.id === localSubscription.stripe_checkout_session_id;
  }
  return checkoutSubscriptionId === localSubscription?.stripe_subscription_id;
}

async function latestConfiguredSubscriptionForCustomer(stripe, customerId, config) {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
    expand: ['data.latest_invoice', 'data.items.data.price'],
  });
  return subscriptions.data.find((subscription) => configuredSubscriptionItem(subscription, config)) ?? null;
}

async function reconcileUnrecordedCustomerSubscription({
  stripe,
  config,
  productUser,
  subscription,
  eventPublisher = null,
}) {
  if (!subscription?.stripe_customer_id || subscription?.stripe_subscription_id) {
    return subscription;
  }
  const stripeSubscription = await latestConfiguredSubscriptionForCustomer(
    stripe,
    subscription.stripe_customer_id,
    config,
  );
  if (!stripeSubscription) return subscription;
  if (objectId(stripeSubscription.customer) !== subscription.stripe_customer_id) {
    throw httpError('The Stripe subscription could not be verified', 409, 'SUBSCRIPTION_OWNERSHIP_ERROR');
  }
  const updated = await reconcileSubscription({
    subscription: stripeSubscription,
    eventType: 'invoice.paid',
    config,
    user: subscription,
  });
  if (updated && productUser?.auth_user_id && eventPublisher) {
    eventPublisher.publishSubscription({
      authUserId: productUser.auth_user_id,
      productUserId: productUser.id,
      subscription: publicSubscription(updated),
    });
  }
  return updated ?? subscription;
}

async function reconcileRefundedActiveSubscription({
  stripe,
  config,
  productUser,
  subscription,
  eventPublisher = null,
}) {
  if (!hasProAccess(subscription) || !subscription?.stripe_subscription_id) return subscription;
  const stripeSubscription = await retrieveCanonicalSubscription(
    stripe,
    subscription.stripe_subscription_id,
  );
  if (!configuredSubscriptionItem(stripeSubscription, config)) return subscription;
  const latestInvoiceId = objectId(stripeSubscription.latest_invoice);
  if (!latestInvoiceId) return subscription;
  const invoice = await stripe.invoices.retrieve(latestInvoiceId, {
    expand: ['payments.data'],
  });
  const charge = await resolveInvoiceCharge(stripe, invoice);
  if (!isFullyRefundedCharge(charge)) return subscription;
  const canceledSubscription = await cancelSubscriptionForRefund(
    stripe,
    stripeSubscription.id,
    `reconcile:${stripeSubscription.id}:${latestInvoiceId}`,
  );
  const updated = await reconcileSubscription({
    subscription: canceledSubscription,
    eventType: 'customer.subscription.deleted',
    config,
    user: subscription,
  });
  if (updated && productUser?.auth_user_id && eventPublisher) {
    eventPublisher.publishSubscription({
      authUserId: productUser.auth_user_id,
      productUserId: productUser.id,
      subscription: publicSubscription(updated),
    });
  }
  return updated ?? subscription;
}

function checkoutLimiter() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 12,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: 'Too many billing requests. Please wait and try again.',
      code: 'BILLING_RATE_LIMITED',
    },
  });
}

export function createStripeRouter({
  getStripe = getStripeClient,
  getConfig = getStripeConfig,
  getPrice = getValidatedStripePrice,
} = {}) {
  const router = Router();
  const limitCheckout = checkoutLimiter();

  router.get('/subscription', async (_req, res) => {
    const config = getConfig();
    const stripe = getStripe(config);
    const storedSubscription = await getSubscriptionForUserId(res.locals.productUser.id);
    let subscription = await reconcileUnrecordedCustomerSubscription({
      stripe,
      config,
      productUser: res.locals.productUser,
      subscription: storedSubscription,
      eventPublisher: res.app.get('eventPublisher'),
    });
    subscription = await reconcileRefundedActiveSubscription({
      stripe,
      config,
      productUser: res.locals.productUser,
      subscription,
      eventPublisher: res.app.get('eventPublisher'),
    });
    const price = await getPrice(stripe, config);
    res.json({ subscription: publicSubscription(subscription, price) });
  });

  router.post('/checkout-session', limitCheckout, async (_req, res) => {
    const config = getConfig();
    const stripe = getStripe(config);
    const productUser = res.locals.productUser;
    const [storedSubscription, price] = await Promise.all([
      getSubscriptionForUserId(productUser.id),
      getPrice(stripe, config),
    ]);
    if (hasProAccess(storedSubscription)) {
      throw httpError('Your Pro subscription is already active', 409, 'ALREADY_SUBSCRIBED');
    }
    const customerId = await ensureStripeCustomer({
      stripe,
      productUser,
      sessionUser: res.locals.session.user,
      subscription: storedSubscription,
    });
    let subscription = await getSubscriptionForUserId(productUser.id);
    subscription = await reconcileUnrecordedCustomerSubscription({
      stripe,
      config,
      productUser,
      subscription,
      eventPublisher: res.app.get('eventPublisher'),
    });
    if (hasProAccess(subscription)) {
      throw httpError('Your Pro subscription is already active', 409, 'ALREADY_SUBSCRIBED');
    }
    if (
      subscription?.stripe_subscription_id
      && !TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.stripe_subscription_status)
    ) {
      throw httpError(
        'An existing subscription is still being resolved. Update billing details or wait for Stripe to finish processing it.',
        409,
        'SUBSCRIPTION_IN_PROGRESS',
      );
    }
    let checkoutAttempt = await reserveCheckoutAttempt(productUser.id, {
      nextToken: randomUUID,
    });
    if (checkoutAttempt.sessionId) {
      const existing = await stripe.checkout.sessions.retrieve(checkoutAttempt.sessionId);
      if (existing.status === 'open' && existing.url) {
        res.status(200).json({ url: existing.url });
        return;
      }
      await clearCheckoutAttempt(productUser.id);
      checkoutAttempt = await reserveCheckoutAttempt(productUser.id, {
        nextToken: randomUUID,
      });
    }
    let checkout;
    try {
      checkout = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: price.id, quantity: 1 }],
      client_reference_id: productUser.id,
      metadata: { productUserId: productUser.id },
      subscription_data: {
        metadata: {
          productUserId: productUser.id,
          stripeProductId: config.productId,
        },
      },
      automatic_tax: { enabled: false },
      allow_promotion_codes: false,
      success_url: `${config.appOrigin}/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.appOrigin}/subscription?checkout=cancelled`,
      }, {
        idempotencyKey: checkoutAttempt.attemptToken,
      });
    } catch (error) {
      await clearCheckoutAttempt(productUser.id).catch(() => {});
      throw error;
    }
    if (!checkout.url) {
      throw httpError('Stripe did not create a Checkout URL', 502, 'STRIPE_CHECKOUT_UNAVAILABLE');
    }
    const savedCheckout = await saveCheckoutSession({
      userId: productUser.id,
      attemptToken: checkoutAttempt.attemptToken,
      sessionId: checkout.id,
      expiresAt: unixSecondsToDate(checkout.expires_at) ?? new Date(Date.now() + (24 * 60 * 60 * 1000)),
    });
    if (!savedCheckout) {
      throw httpError('Stripe Checkout state could not be saved', 503, 'STRIPE_CHECKOUT_UNAVAILABLE');
    }
    res.status(201).json({ url: checkout.url });
  });

  router.post('/checkout-session/confirm', async (req, res) => {
    const sessionId = String(req.body?.sessionId ?? '').trim();
    if (!/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) {
      throw httpError('A valid Stripe Checkout session is required', 400, 'CHECKOUT_SESSION_INVALID');
    }
    const config = getConfig();
    const stripe = getStripe(config);
    const productUser = res.locals.productUser;
    const localSubscription = await getSubscriptionForUserId(productUser.id);
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);
    if (!checkoutSessionIsOwnedByUser({
      checkoutSession,
      localSubscription,
      productUser,
    })) {
      throw httpError('The Stripe Checkout session could not be verified', 409, 'CHECKOUT_SESSION_OWNERSHIP_ERROR');
    }
    const stripeSubscription = await retrieveCanonicalSubscription(
      stripe,
      objectId(checkoutSession.subscription),
    );
    if (!ownsStripeSubscription(stripeSubscription, {
      ...localSubscription,
      stripe_subscription_id: objectId(checkoutSession.subscription),
    })) {
      throw httpError('The Stripe subscription could not be verified', 409, 'SUBSCRIPTION_OWNERSHIP_ERROR');
    }
    const updated = await reconcileSubscription({
      subscription: stripeSubscription,
      eventType: 'invoice.paid',
      config,
      user: localSubscription,
    });
    if (!updated) {
      throw httpError('The Stripe subscription is not configured for this workspace', 409, 'SUBSCRIPTION_OWNERSHIP_ERROR');
    }
    const publicState = publicSubscription(updated, await getPrice(stripe, config));
    res.app.get('eventPublisher')?.publishSubscription({
      authUserId: res.locals.session.user.id,
      productUserId: productUser.id,
      subscription: publicState,
    });
    res.json({ subscription: publicState });
  });

  router.post('/subscription/cancel', async (_req, res) => {
    const config = getConfig();
    const stripe = getStripe(config);
    const productUser = res.locals.productUser;
    const localSubscription = await getSubscriptionForUserId(productUser.id);
    if (!hasProAccess(localSubscription) || !localSubscription?.stripe_subscription_id) {
      throw httpError('An active Pro subscription is required', 409, 'NO_ACTIVE_SUBSCRIPTION');
    }
    const subscription = await retrieveCanonicalSubscription(stripe, localSubscription.stripe_subscription_id);
    if (!ownsStripeSubscription(subscription, localSubscription) || subscription.status !== 'active') {
      throw httpError('The Stripe subscription could not be verified', 409, 'SUBSCRIPTION_OWNERSHIP_ERROR');
    }
    const updatedStripeSubscription = await stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: true,
      proration_behavior: 'none',
    });
    const updated = await reconcileSubscription({
      subscription: updatedStripeSubscription,
      eventType: 'customer.subscription.updated',
      config,
      user: localSubscription,
      runQuery: undefined,
    });
    const publicState = publicSubscription(updated, await getPrice(stripe, config));
    res.app.get('eventPublisher')?.publishSubscription({
      authUserId: res.locals.session.user.id,
      productUserId: productUser.id,
      subscription: publicState,
    });
    res.json({ subscription: publicState });
  });

  router.post('/subscription/resume', async (_req, res) => {
    const config = getConfig();
    const stripe = getStripe(config);
    const productUser = res.locals.productUser;
    const localSubscription = await getSubscriptionForUserId(productUser.id);
    if (!hasProAccess(localSubscription) || !localSubscription?.stripe_subscription_id) {
      throw httpError('A scheduled active Pro subscription is required', 409, 'NO_ACTIVE_SUBSCRIPTION');
    }
    const subscription = await retrieveCanonicalSubscription(stripe, localSubscription.stripe_subscription_id);
    if (
      !ownsStripeSubscription(subscription, localSubscription)
      || subscription.status !== 'active'
      || !subscription.cancel_at_period_end
    ) {
      throw httpError('The Stripe subscription cannot be resumed', 409, 'SUBSCRIPTION_NOT_RESUMABLE');
    }
    const updatedStripeSubscription = await stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: false,
      proration_behavior: 'none',
    });
    const updated = await reconcileSubscription({
      subscription: updatedStripeSubscription,
      eventType: 'customer.subscription.updated',
      config,
      user: localSubscription,
      runQuery: undefined,
    });
    const publicState = publicSubscription(updated, await getPrice(stripe, config));
    res.app.get('eventPublisher')?.publishSubscription({
      authUserId: res.locals.session.user.id,
      productUserId: productUser.id,
      subscription: publicState,
    });
    res.json({ subscription: publicState });
  });

  router.post('/customer-portal', async (_req, res) => {
    const config = getConfig();
    const stripe = getStripe(config);
    const subscription = await getSubscriptionForUserId(res.locals.productUser.id);
    if (!subscription?.stripe_customer_id) {
      throw httpError('No Stripe customer is available for billing recovery', 409, 'NO_BILLING_CUSTOMER');
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${config.appOrigin}/subscription`,
    });
    res.json({ url: portal.url });
  });

  return router;
}

export function createStripeWebhookHandler({
  getStripe = getStripeClient,
  getConfig = getStripeConfig,
  handleEvent = handleStripeWebhookEvent,
} = {}) {
  return async function stripeWebhookHandler(req, res, next) {
    try {
      const config = getConfig();
      const stripe = getStripe(config);
      const signature = req.get('stripe-signature');
      if (!signature) {
        throw httpError('Stripe signature is required', 400, 'STRIPE_SIGNATURE_INVALID');
      }
      let event;
      try {
        event = stripe.webhooks.constructEvent(req.body, signature, config.webhookSecret);
      } catch {
        throw httpError('Stripe signature verification failed', 400, 'STRIPE_SIGNATURE_INVALID');
      }
      const result = await handleEvent(event, {
        stripe,
        config,
        eventPublisher: req.app.get('eventPublisher'),
      });
      res.status(200).json({ received: true, duplicate: Boolean(result?.duplicate) });
    } catch (error) {
      next(error);
    }
  };
}

export const stripeWebhookHandler = createStripeWebhookHandler();

export default createStripeRouter();
