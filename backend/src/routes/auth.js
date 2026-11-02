import { Router } from 'express';
import { HttpError } from '../lib/httpError.js';
import { verifyPassword } from '../lib/password.js';
import { loginSchema, parse } from '../lib/validation.js';
import { requireAuth, signToken } from '../middleware/auth.js';
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
  res.json({ token: signToken({ ...publicUser, role: user.role }), user: publicUser });
});

router.get('/me', requireAuth, (req, res) => res.json(req.user));

export default router;
