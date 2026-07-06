import { appOrigin, getAuthSession } from '../auth.js';

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
