import { appOrigin, getAuthSession } from '../auth.js';
import { getOrCreateUserFromSession } from '../models/users.js';
import { getSubscriptionForUserId, hasProAccess } from '../models/subscriptions.js';

export function requireTrustedAuthHost(req, res, next) {
  const requestOrigin = `${req.protocol}://${req.get('host')}`;

  if (requestOrigin !== appOrigin) {
    return res.status(400).json({ error: 'Untrusted authentication origin' });
  }

  return next();
}

export async function loadAuthSession(req, res, next) {
  try {
    res.locals.session = await getAuthSession(req);
    res.set('Cache-Control', 'no-store');
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireAuth(_req, res, next) {
  if (!res.locals.session?.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  return next();
}

export async function loadProductUser(_req, res, next) {
  try {
    res.locals.productUser = await getOrCreateUserFromSession(res.locals.session.user);
    return next();
  } catch (error) {
    return next(error);
  }
}

export async function requirePro(_req, res, next) {
  try {
    const subscription = await getSubscriptionForUserId(res.locals.productUser?.id);
    if (hasProAccess(subscription)) return next();
    return res.status(403).json({
      error: 'Pro subscription required',
      code: 'SUBSCRIPTION_REQUIRED',
      redirect: '/subscription',
    });
  } catch (error) {
    return next(error);
  }
}
