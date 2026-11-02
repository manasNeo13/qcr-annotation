import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from '../lib/httpError.js';

export const signToken = (user) =>
  jwt.sign({ name: user.name, email: user.email, role: user.role }, env.JWT_SECRET, { subject: user.id, expiresIn: env.JWT_EXPIRES_IN });

/** Sets req.user = { id, name, email } or 401. */
export function requireAuth(req, _res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return next(new HttpError(401, 'Not signed in'));
  try {
    const p = jwt.verify(token, env.JWT_SECRET);
    req.user = { id: p.sub, name: p.name, email: p.email, role: p.role };
    next();
  } catch {
    next(new HttpError(401, 'Session expired — sign in again'));
  }
}
