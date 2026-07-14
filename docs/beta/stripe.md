# Stripe Subscription Workflow

The beta offers one monthly Pro subscription through Stripe-hosted Checkout.
The configured Stripe Price is the amount charged; the struck-through price in
the UI is display text only. Automatic tax is disabled, and cancellation/resume
uses no proration. Basic users can access billing APIs but not workspace APIs.

## Main Files

| File | Responsibility |
| --- | --- |
| `app.js` | Mounts the raw-body webhook before `express.json()`. |
| `server/routers/index.js` | Mounts `/api/stripe` after authentication but before the Pro-only middleware. |
| `server/routers/stripe.js` | Creates Checkout/Portal sessions, verifies webhooks, reconciles Stripe objects, and handles cancel/resume/refund flows. |
| `server/models/subscriptions.js` | Reads and updates the local subscription projection, Checkout attempt, and webhook receipt. |
| `server/models/migrations/004_stripe_subscriptions.sql` | Adds subscription fields and the idempotent webhook receipt table. |
| `server/models/migrations/005_stripe_checkout_attempts.sql` | Adds temporary Checkout session and idempotency fields. |
| `server/middlewares/requireAuth.js` | Returns `403 SUBSCRIPTION_REQUIRED` when a non-Pro user calls a protected product API. |
| `src/services/subscriptionApi.js` | Browser functions for every authenticated billing endpoint. |
| `src/pages/homepageSubscription.jsx` | Subscription selection, Checkout return, cancellation, resume, and recovery UI. |
| `src/components/RequirePro.jsx` | Protects workspace routes in React. |
| `server/realtime/publisher.js` and `RealtimeProvider.jsx` | Publish and apply `subscription:updated`. |

## Environment Variables

| Variable | Use | Exposure |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` (`sk_test_...`) | Server authentication for outgoing Stripe API calls. | Server only. |
| `STRIPE_WEBHOOK_SECRET` (`whsec_...`) | Verifies incoming webhook signatures. It belongs to one Dashboard endpoint or CLI listener. | Server only. |
| `STRIPE_PRODUCT_ID` | Required Pro product. | Server only in this implementation. |
| `STRIPE_PRICE_ID` | Required active USD monthly Price. | Server only in this implementation. |
| `STRIPE_PUBLISHABLE_KEY` (`pk_test_...`) | Intended for browser-side Stripe.js/Elements. | Safe for clients, but currently unused because Checkout is server-created. |
| `APP_ORIGIN` | Builds Checkout return URLs and defines the allowed browser origin. | Configuration. |

Development rejects a non-test secret key. The configured Price must be active,
test-mode, USD, monthly, attached to the configured Product, and at least $0.50.

## Billing APIs

All authenticated billing APIs are under `/api/stripe`. They remain available
to Basic users so they can subscribe or recover payment.

| API | Purpose |
| --- | --- |
| `GET /subscription` | Returns the public local state and reconciles a missed subscription or full refund. |
| `POST /checkout-session` | Creates or reuses an idempotent Stripe-hosted subscription Checkout session. |
| `POST /checkout-session/confirm` | Verifies the returned session, customer, subscription, Product, and Price before granting access. |
| `POST /subscription/cancel` | Sets `cancel_at_period_end: true` with no proration. |
| `POST /subscription/resume` | Restores renewal before the scheduled period end. |
| `POST /customer-portal` | Creates a Stripe Customer Portal session for billing recovery. |
| `POST /api/stripe/webhook` | Receives raw Stripe events. It uses Stripe signature authentication, not the user's session. |

The browser receives only:

```js
{
  plan,
  accessState,
  hasProAccess,
  stripeStatus,
  cancelAtPeriodEnd,
  currentPeriodEnd,
  recoveryRequired,
  price: { amount, currency, interval }
}
```

Customer IDs, subscription IDs, invoices, Checkout tokens, and secrets stay on
the server.

## Access States

| `accessState` | Meaning |
| --- | --- |
| `basic` | No current paid entitlement. |
| `processing` | Stripe is still resolving the subscription. |
| `pro` | Workspace access is allowed. |
| `payment_failed` | Payment recovery is required; workspace access is blocked. |

Only `pro` makes `hasProAccess` true. A scheduled cancellation can remain Pro
until `currentPeriodEnd`.

## Sign-In and Entitlement Workflow

```text
Google sign-in
  -> Auth.js writes the session cookie
  -> browser returns to /subscription?entry=auth
  -> RealtimeProvider calls GET /api/stripe/subscription
  -> Pro: open workspace
  -> Basic/payment failure: remain on subscription page
```

`RequirePro` protects React routes, while Express `requirePro` protects profile,
document, trash, AI, and version APIs. The server check is authoritative; a
browser redirect alone never grants access.

## Checkout Workflow

1. The page calls `createCheckoutSession()`.
2. `POST /api/stripe/checkout-session` validates the configured Price, creates
   or reuses the Stripe Customer, reserves an idempotent attempt, and creates
   hosted Checkout.
3. The browser opens the returned Stripe URL. Card data goes only to Stripe.
4. Stripe returns to `/subscription?checkout=success&session_id=...`.
5. The page calls `POST /api/stripe/checkout-session/confirm`.
6. The server retrieves canonical Stripe objects and verifies ownership,
   Product, Price, and paid subscription state.
7. PostgreSQL is updated, `subscription:updated` is emitted, and the Pro user
   enters the workspace.

The success URL is not proof of payment. Confirmation and webhooks both verify
the state with Stripe. A cancelled Checkout signs the Basic user out.

## Webhook Workflow

```text
Stripe or Stripe CLI
  -> POST /api/stripe/webhook with raw body + Stripe-Signature
  -> verify with STRIPE_WEBHOOK_SECRET
  -> retrieve and validate canonical Stripe objects
  -> claim event ID in stripe_webhook_events
  -> update PostgreSQL in one transaction
  -> emit subscription:updated
  -> return 200
```

Supported events are:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `refund.created`
- `refund.updated`

Duplicate event IDs do not repeat the state change. Invalid signatures return
400. Unsupported, unrelated, partial, pending, or failed refund events are
ignored.

## Cancellation, Recovery, and Refunds

- **Cancel:** Stripe schedules cancellation at period end. Access remains Pro
  until Stripe sends the terminal subscription update.
- **Resume:** renewal is restored before the period end.
- **Payment failure:** the local state becomes `payment_failed`; the Customer
  Portal lets the user update payment details.
- **Successful full refund:** the server traces the refund through its charge,
  invoice, and configured subscription, then cancels immediately and changes
  access to Basic. A partial refund does not revoke access.

## Realtime Subscription Updates

Every authenticated socket joins `billing-user:{authUserId}`. When billing state
changes, the server emits the sanitized `subscription:updated` event to this
room.

- On upgrade, connected sockets gain the Pro user room and refresh protected
  REST data.
- On downgrade, they leave the Pro/document rooms and clear cached profile,
  documents, trash, and versions.
- On reconnect, `RealtimeProvider` fetches `GET /api/stripe/subscription` before
  protected data, so Socket.IO is never the entitlement source of truth.

See [Backend and realtime workflow](backend-and-realtime.md) for room and event
details.

## Local Webhook Setup

Each developer running a local server needs their own listener and matching
signing secret:

```powershell
stripe login
stripe listen --events checkout.session.completed,invoice.paid,invoice.payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,refund.created,refund.updated --forward-to http://localhost:3001/api/stripe/webhook
```

Copy the printed `whsec_...` into that device's `STRIPE_WEBHOOK_SECRET`, restart
Express, and keep the listener running. A teammate's CLI secret does not match
your listener. A deployed public webhook instead uses the signing secret for
its registered Dashboard endpoint, stored in the deployment secret manager.

## Security Rules

- Never expose `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` to React or Git.
- Preserve the webhook's raw body for signature verification.
- Never trust browser-provided prices, Stripe IDs, or entitlement state.
- Keep Checkout ownership checks, event receipts, idempotency, and rate limits.
- Treat PostgreSQL's server-derived `access_state` as the application source of
  truth; Socket.IO only distributes that state.
