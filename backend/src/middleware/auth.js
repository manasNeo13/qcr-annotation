import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from '../lib/httpError.js';

export const signToken = (user) =>
  jwt.sign({ name: user.name, email: user.email, role: user.role }, env.JWT_SECRET, { subject: user.id, expiresIn: env.JWT_EXPIRES_IN });

/** Response header carrying a renewed token (sliding 8h idle timeout). */
export const RENEW_HEADER = 'X-Session-Token';

/** Sets req.user = { id, name, email } or 401. Active users get a fresh token every few minutes. */
export function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return next(new HttpError(401, 'Not signed in'));
  try {
    const p = jwt.verify(token, env.JWT_SECRET);
    req.user = { id: p.sub, name: p.name, email: p.email, role: p.role };
    if (Date.now() / 1000 - (p.iat ?? 0) > env.JWT_RENEW_AFTER_S) res.set(RENEW_HEADER, signToken(req.user));
    next();
  } catch {
    next(new HttpError(401, 'Session expired — sign in again'));
  }
}
