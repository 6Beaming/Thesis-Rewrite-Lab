# Stripe Subscription Implementation

## Scope And Intended Behavior

This beta uses Stripe-hosted Checkout for one monthly Pro subscription. The
subscription page is `src/pages/homepageSubscription.jsx` at `/subscription`.
It replaces the previous placeholder page and is available to authenticated
Basic as well as Pro users.

The actual charge is always the Stripe Price identified by `STRIPE_PRICE_ID`.
The `$10.00` struck-through price on the page is only a reference/promotion
display; it does not set the amount charged. The server accepts only an active,
test-mode, USD, monthly recurring Price associated with `STRIPE_PRODUCT_ID` and
with a minimum price of $0.50. For the current test setup, that configured
Price is $0.50 USD per month.

The Basic plan is intentionally unavailable in this beta.

| User state and choice | Result |
| --- | --- |
| Basic selects Basic | A red unavailability banner is shown; Pro payment is disabled while Basic is selected. Proceed asks for confirmation, and Leave signs the user out. |
| Basic selects Pro | The Pro banner and Checkout action are enabled. Checkout sends the user to Stripe's hosted page. |
| Basic completes a payment | The browser returns to `/subscription?checkout=success&session_id=...`. It confirms the owned session with the server and waits for the canonical Pro state, then opens the workspace. |
| Basic cancels Checkout or leaves without subscribing | The application signs the user out with a short explanatory message on the sign-in screen. |
| Pro cancels renewal | The server sets `cancel_at_period_end` in Stripe with no proration. Pro remains active through `current_period_end`; the user can resume automatic renewal before then. |
| Pro selects Basic | The confirmation dialog offers Cancel, Leave with subscription, or Leave with cancellation. The cancellation option preserves current-period Pro access and schedules the next-period downgrade. |
| A successful full refund is issued by an administrator | The matching configured Stripe subscription is cancelled immediately, local access becomes Basic, and all active sessions receive the downgrade in real time. |

No automatic tax is added in this beta. The Checkout session explicitly sets
`automatic_tax.enabled` to `false`, and cancellation/resume updates use
`proration_behavior: 'none'`. This makes the test subscription suitable for
repeated subscribe/cancel/refund testing without application-added tax or
proration.

## Login And Entitlement Flow

1. The user signs in through Google OAuth, handled by Auth.js.
2. The Google callback returns to `/subscription?entry=auth`, after Auth.js has
   written the session cookie.
3. `RealtimeProvider` connects with that session and fetches
   `GET /api/stripe/subscription` before loading workspace data.
4. If `hasProAccess` is true, the subscription page redirects to `/`. If it is
   false, the user stays on `/subscription`.
5. Both the client and the server enforce the entitlement. `RequirePro` guards
   React workspace routes, while the Express `requirePro` middleware guards all
   non-billing `/api` routes. Billing endpoints remain available to an
   authenticated Basic user so they can subscribe or recover payment.

### What Happens In Common Cases

**If the user cancels a subscription and tries to log in:** a cancellation is
scheduled for the billing-period end, not an immediate downgrade. Until
`current_period_end`, the stored access state remains `pro`; the user signs in
normally and reaches the workspace. Stripe emits the terminal cancellation
event at the period end, after which the stored state becomes `basic`. A later
workspace login is blocked and signs the Basic user out; the normal Google
return path leaves them on the subscription page to subscribe again.

**If the user fails to pay for a subscription:** Stripe's payment-failure event
sets `access_state` to `payment_failed`, which does not grant Pro access. A
failed initial Checkout signs the user out with a payment-failure message. A
failed renewal is redirected to `/subscription`, where the billing-recovery
button opens the Stripe Customer Portal to update the payment method. Workspace
API requests remain denied until Stripe reports a paid, active subscription.

**If the user tries to log in without a subscription:** the initial status
check reports `basic`. The Google return route stays on the subscription page;
attempting to enter `/` or another protected workspace route triggers the
entitlement guard and signs the user out with the subscription-required
message. The Basic user cannot fetch documents, profile data, trash, or
versions because the Express API applies `requirePro` after the billing router.

## Persistent Subscription Schema

Migrations `004_stripe_subscriptions.sql` and
`005_stripe_checkout_attempts.sql` extend the product `users` table. Auth.js
continues to own identity/session tables; the product user row stores the
application's billing projection.

| Field | Activation and update rule | Deactivation or retention rule |
| --- | --- | --- |
| `stripe_customer_id` | Created before the first Checkout with Stripe customer metadata containing the product-user UUID. | Retained for billing ownership and future Checkout/recovery. It is not sent to the browser. |
| `stripe_subscription_id` | Stored after an owned configured subscription is reconciled by webhook or checkout confirmation. | Retained after terminal cancellation for ownership/audit correlation; it does not itself grant access. |
| `stripe_price_id` | Set from the configured Price on each reconciled subscription state. | Retained as the last reconciled Price; a Stripe ID alone never grants access. |
| `stripe_subscription_status` | Mirrors the canonical Stripe subscription status, such as `incomplete`, `active`, `past_due`, or `canceled`. | Terminal states (`canceled`, `incomplete_expired`, `unpaid`, `paused`) derive Basic access. |
| `latest_invoice_status` | Updated from the subscription's latest invoice during reconciliation. | It remains as billing context; failed/open states can produce `payment_failed`. |
| `access_state` | One of `basic`, `processing`, `pro`, or `payment_failed`; derived server-side from Stripe status, invoice status, and the event type. | Only `pro` grants workspace access. `processing`, `payment_failed`, and `basic` do not. |
| `cancel_at_period_end` | True when the user schedules cancellation through Stripe. | False when automatic renewal is resumed or when Stripe returns a normal active state. It can be true while `access_state` is still `pro`. |
| `current_period_end` | Filled from Stripe's subscription item/current billing period. | Becomes null if Stripe no longer supplies a period; its reached terminal event makes access Basic. |
| `subscription_updated_at` | Updated whenever the application changes local subscription or Checkout-attempt state. | Audit timestamp only; it does not grant access. |
| `stripe_checkout_session_id` | Saved when the server creates a Checkout session. It lets the return handler verify the exact owned session. | Cleared when a subscription ID is reconciled or when an unusable attempt is cleared. |
| `stripe_checkout_session_expires_at` | Saved from Stripe's session expiry. It determines whether an open session can be reused. | Cleared together with the Checkout session state. |
| `stripe_checkout_attempt_token` | Generated for a new attempt and used as Stripe's idempotency key. Recent attempts may reuse the token. | Cleared when a subscription is reconciled or an attempt is cleared. |
| `stripe_checkout_attempt_started_at` | Records when the idempotent attempt began. | Cleared with the rest of the Checkout attempt state. |

`stripe_webhook_events` is a separate receipt table with `event_id` as its
primary key, the Stripe event type/time, and the application processing time.
The transaction claims the event before mutating the user row, so retrying a
Stripe webhook does not repeat an entitlement change.

The browser receives only this sanitized subscription projection:

```js
{
  plan,                 // 'basic' or 'pro'
  accessState,          // 'basic' | 'processing' | 'pro' | 'payment_failed'
  hasProAccess,         // true only for accessState === 'pro'
  stripeStatus,
  cancelAtPeriodEnd,
  currentPeriodEnd,
  recoveryRequired,
  price: { amount, currency, interval }
}
```

Stripe customer IDs, subscription IDs, Checkout IDs/tokens, and raw invoice
details are intentionally excluded from both REST and Socket.IO payloads.

## Stripe Dashboard And Environment Setup

Use the Stripe Dashboard in **test mode** for this beta.

1. Create one Product and one active **USD, monthly recurring** Price. Set
   `STRIPE_PRODUCT_ID` and `STRIPE_PRICE_ID` from those objects. The current
   test Price is $0.50; the backend rejects prices below that value.
2. Set `STRIPE_SECRET_KEY` to the matching `sk_test_...` secret key. The
   development configuration rejects a non-test secret key.
3. Start the application server on port 3001 and forward Stripe CLI events to
   `http://localhost:3001/api/stripe/webhook`:

   ```powershell
   stripe listen --events checkout.session.completed,invoice.paid,invoice.payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,refund.created,refund.updated --forward-to http://localhost:3001/api/stripe/webhook
   ```

4. Copy the CLI-provided `whsec_...` signing secret into
   `STRIPE_WEBHOOK_SECRET`, then restart the server. The CLI secret changes
   when a new listener is created, so the environment value must match the
   currently running listener.
5. Configure the Stripe Customer Portal in the Dashboard before relying on
   renewal-payment recovery. The application creates a portal session only for
   the stored Stripe customer and returns the user to `/subscription`.

Required server-only environment variables are:

```dotenv
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRODUCT_ID=prod_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

`APP_ORIGIN` must be the actual frontend origin, such as
`http://localhost:5173` during Vite development. It determines Stripe's
success/cancel URLs and is also the allowed CORS and Socket.IO origin.

`STRIPE_PUBLISHABLE_KEY` may be stored locally, but the current implementation
does **not** consume it. Hosted Checkout is created by the server and opened
with Stripe's returned URL; the browser does not initialize Stripe.js or
Elements. If the product later moves to embedded Stripe Elements, expose only a
Vite-prefixed publishable key to the browser and keep the secret key and webhook
secret server-only.

## Checkout, Webhook, And Refund Implementation

### Server-Created Checkout

`POST /api/stripe/checkout-session` is authenticated and rate-limited to 12
requests per ten minutes. The server, not the browser, retrieves and validates
the configured Price, creates/reuses the Stripe Customer, and creates a
subscription-mode Checkout session. It passes the product-user UUID in
`client_reference_id`, Checkout metadata, and subscription metadata so later
Stripe events can be associated with the correct local user.

The Checkout attempt token is used as Stripe's idempotency key. An unexpired
open Checkout session is reused instead of opening a second payable session.
The server refuses Checkout when the local user already has Pro or a
non-terminal configured Stripe subscription still being resolved.

Stripe's success URL is not trusted as evidence of payment. On return,
`POST /api/stripe/checkout-session/confirm` retrieves the session from Stripe
and verifies all of the following before updating access:

- the session is complete and in subscription mode;
- it belongs to the local Stripe customer;
- its metadata/reference product-user UUID matches the authenticated product
  user;
- it matches the locally saved Checkout session, or the already reconciled
  subscription; and
- the retrieved canonical Stripe subscription belongs to that customer and
  contains the configured Product and Price.

The confirm endpoint repairs the small race where the browser returns before a
webhook has been delivered. `GET /api/stripe/subscription` also reconciles an
unrecorded customer subscription and re-checks the latest charge for a full
refund, making the system recover from a missed delivery.

### Signed Webhooks

`app.js` mounts the webhook before `express.json()` and uses `express.raw()`.
`createStripeWebhookHandler` requires the `Stripe-Signature` header and calls
`stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)`.
Unsigned or incorrectly signed requests receive a 400 response and cannot
change billing state.

Supported events are:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `refund.created`
- `refund.updated`

For subscription events, the server retrieves the canonical Stripe subscription
rather than trusting the payload alone, verifies its configured Price/Product,
claims the event ID in `stripe_webhook_events`, derives `access_state`, and
updates PostgreSQL in one transaction.

For a refund event, the server acts only when the refund is `succeeded` and the
associated charge is fully refunded. It traces the charge to its invoice and
subscription, verifies that subscription is the configured product, cancels the
Stripe subscription with an idempotency key, then reconciles the local state as
Basic. Pending, failed, cancelled, partial, unrelated, or unconfigured-product
refunds are ignored. This is intentionally different from a user cancellation:
an administrator-issued full refund revokes access immediately.

## Real-Time Subscription Updates

Socket.IO authentication uses the existing Auth.js session. Every authenticated
socket joins a private `billing-user:<authUserId>` room. Pro sockets also join a
private `user:<authUserId>` room and can subscribe to owned document rooms.

After a webhook, checkout confirmation, cancellation, resume, refund, or
server-side reconciliation changes a subscription, the event publisher emits a
sanitized `subscription:updated` payload to the billing room. It then updates
each connected socket's entitlement: a newly Pro socket joins the general user
room; a downgraded socket leaves the general user room and every document room.

On the client, `RealtimeProvider` applies the event immediately. A downgrade
clears cached profile, document, trash, detail, and version data; an upgrade
refreshes those resources. On every Socket.IO reconnect, the client fetches the
canonical subscription state before loading protected data, so a temporary
socket outage cannot leave a stale entitlement active.

## Security Model

### Security Of The Login System

- Auth.js uses Google as the sole provider. The OAuth flow requires PKCE,
  `state`, and `nonce`, and accepts a sign-in only when Google reports a
  verified email address.
- Auth.js uses database-backed sessions. `AUTH_SECRET` must be at least 32
  characters in production; development creates a local-only fallback secret.
- Authentication requests are limited to the configured application origin,
  and production rejects a non-HTTPS `APP_ORIGIN`.
- API session checks run before every application router. Responses that load a
  session use `Cache-Control: no-store`; CORS accepts credentialed requests
  only from `APP_ORIGIN`; Helmet applies browser security headers.
- Entitlement is separate from identity. A valid Google session alone cannot
  access workspace resources without a current server-derived Pro state.

### Security Of The Payment System

- Card information is collected by Stripe-hosted Checkout. It is never posted
  to this React application, Express server, or PostgreSQL database.
- The Stripe secret key and webhook signing secret are server-only `.env` /
  deployment secrets. They are never returned by an API or Socket.IO event.
- The browser cannot set the amount, Product, Price, customer, subscription
  status, or entitlement. The server validates the configured Price and
  retrieves Stripe objects again before accepting a successful return.
- Webhook raw-body signature verification, database event receipts, Checkout
  idempotency, request rate limiting, and customer/subscription ownership checks
  protect against forged notifications, duplicate attempts, and cross-user
  session confirmation.
- Refund revocation verifies the actual fully refunded charge and its invoice
  subscription before cancelling access; a Stripe Dashboard refund therefore
  cannot leave a paid entitlement active.

### Security Of User Data

- The product user is derived from the immutable Auth.js user ID, not from a
  browser-supplied user ID. Document and version models scope mutations to that
  user, and Socket.IO checks document ownership before joining a document room.
- Non-Pro users cannot call document, profile, trash, or version APIs. A
  downgrade also removes those cached records from the browser and removes
  document-room membership in real time.
- REST and Socket.IO publishers whitelist their public fields. Subscription
  events expose only status needed by the UI, never Stripe IDs, Checkout tokens,
  invoice details, or secrets.
- Stripe receives only the billing identity needed to create the Customer
  (available name/email) and the local product-user UUID as metadata for
  correlation. Writing content, profile data, document data, and session
  credentials are not sent to Stripe by this feature.
