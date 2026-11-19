import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from '../lib/httpError.js';

/** pwc = must change password (temporary password set by admin) → only /auth/me + /auth/password allowed. */
export const signToken = (user) =>
  jwt.sign(
    { name: user.name, email: user.email, role: user.role, ...(user.mustChangePassword ? { pwc: true } : {}) },
    env.JWT_SECRET,
    { subject: user.id, expiresIn: env.JWT_EXPIRES_IN },
  );

/** Response header carrying a renewed token (sliding 8h idle timeout). */
export const RENEW_HEADER = 'X-Session-Token';

/** Error code the frontend uses to open the "set new password" screen. */
export const PASSWORD_CHANGE_CODE = 'PASSWORD_CHANGE_REQUIRED';

function authenticate(req, res, next, allowPendingPassword) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return next(new HttpError(401, 'Not signed in'));
  let p;
  try {
    p = jwt.verify(token, env.JWT_SECRET);
  } catch {
    return next(new HttpError(401, 'Session expired — sign in again'));
  }
  req.user = { id: p.sub, name: p.name, email: p.email, role: p.role, mustChangePassword: !!p.pwc };
  if (p.pwc && !allowPendingPassword) {
    const e = new HttpError(403, 'Set a new password first');
    e.code = PASSWORD_CHANGE_CODE;
    return next(e);
  }
  if (Date.now() / 1000 - (p.iat ?? 0) > env.JWT_RENEW_AFTER_S) res.set(RENEW_HEADER, signToken(req.user));
  next();
}

/** Sets req.user = { id, name, email, role } or 401. Active users get a fresh token every few minutes. */
export const requireAuth = (req, res, next) => authenticate(req, res, next, false);

/** Same, but also lets in users who still have to replace their temporary password. */
export const requireAuthAllowPending = (req, res, next) => authenticate(req, res, next, true);
