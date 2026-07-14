import { requestJson } from './request.js';

export function getSubscription() {
  return requestJson('/stripe/subscription');
}

export function createCheckoutSession() {
  return requestJson('/stripe/checkout-session', { method: 'POST' });
}

export function confirmCheckoutSession(sessionId) {
  return requestJson('/stripe/checkout-session/confirm', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

export function cancelSubscription() {
  return requestJson('/stripe/subscription/cancel', { method: 'POST' });
}

export function resumeSubscription() {
  return requestJson('/stripe/subscription/resume', { method: 'POST' });
}

export function createCustomerPortal() {
  return requestJson('/stripe/customer-portal', { method: 'POST' });
}
