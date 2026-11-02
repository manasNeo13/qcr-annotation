import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;

/** Verify "scrypt$<saltHex>$<hashHex>" (main QCR app format, utils/password.js). */
export async function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEYLEN) return false;
  // TODO: confirm with main app whether salt is used as hex string or raw bytes; accept both until then.
  for (const salt of [saltHex, Buffer.from(saltHex, 'hex')]) {
    const got = await scrypt(password, salt, KEYLEN);
    if (crypto.timingSafeEqual(got, expected)) return true;
  }
  return false;
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}
