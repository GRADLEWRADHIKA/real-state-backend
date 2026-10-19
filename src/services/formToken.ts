/**
 * Website form protection without third-party CAPTCHA: a signed, short-lived, single-use token
 * that also proves the visitor spent a minimum time on the form.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';

const MAX_AGE_MS = 2 * 60 * 60_000;
export const MIN_FILL_MS = () => Number(process.env.FORM_MIN_FILL_MS ?? 3000);
const used = new Map<string, number>();

const sign = (payload: string) => crypto.createHmac('sha256', config.jwtSecret).update(`form:${payload}`).digest('base64url').slice(0, 32);

export function issueFormToken(now = Date.now()) {
  const payload = `${now}.${crypto.randomBytes(9).toString('base64url')}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns an error message, or null when the token is valid (and marks it used). */
export function checkFormToken(token: unknown, now = Date.now()): string | null {
  if (typeof token !== 'string') return 'missing';
  const parts = token.split('.');
  if (parts.length !== 3) return 'malformed';
  const [ts, nonce, sig] = parts;
  const want = sign(`${ts}.${nonce}`);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return 'bad signature';
  const age = now - Number(ts);
  if (!(age >= 0) || age > MAX_AGE_MS) return 'expired';
  if (age < MIN_FILL_MS()) return 'too fast';
  if (used.has(nonce)) return 'reused';
  used.set(nonce, now + MAX_AGE_MS);
  if (used.size > 5000) for (const [k, exp] of used) if (exp < now) used.delete(k);
  return null;
}
