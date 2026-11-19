import { Router } from 'express';
import { HttpError } from '../lib/httpError.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { changePasswordSchema, loginSchema, parse } from '../lib/validation.js';
import { requireAuthAllowPending, signToken } from '../middleware/auth.js';
import { accessOf } from '../middleware/permissions.js';
import { repo } from '../repos/index.js';

const router = Router();
// Equalise timing when user missing.
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

router.post('/login', async (req, res) => {
  const { email, password } = parse(loginSchema, req.body ?? {});
  const user = await repo.users.findForLogin(email);
  const ok = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Invalid email or password');
  if (!user.active) throw new HttpError(403, 'Account disabled — contact admin');
  const publicUser = { id: user.id, name: user.name, email: user.email };
  const mustChangePassword = !!user.mustChangePassword;
  res.json({ token: signToken({ ...publicUser, role: user.role, mustChangePassword }), user: publicUser, mustChangePassword });
});

/** Current user + role + permissions + clients (fresh from DB → admin edits apply without re-login). */
router.get('/me', requireAuthAllowPending, async (req, res) =>
  res.json({ ...req.user, ...(await accessOf(req.user)), mustChangePassword: req.user.mustChangePassword }),
);

/** Change own password (also the forced change after a temporary password). Returns a fresh token. */
router.post('/password', requireAuthAllowPending, async (req, res) => {
  const { currentPassword, newPassword } = parse(changePasswordSchema, req.body ?? {});
  const hash = await repo.users.passwordHashOf(req.user.id);
  if (!hash || !(await verifyPassword(currentPassword, hash))) {
    throw new HttpError(400, 'Current password is wrong', { currentPassword: 'Current password is wrong' });
  }
  await repo.users.setOwnPassword(req.user.id, await hashPassword(newPassword));
  const user = { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, mustChangePassword: false };
  res.json({ token: signToken(user) });
});

export default router;
