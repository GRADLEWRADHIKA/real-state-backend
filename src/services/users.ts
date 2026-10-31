import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { passwordSchema } from '@estateflow/shared';
import { db } from '../db/index.js';
import { parse } from '../utils/http.js';
import { getSetting } from './settings.js';

export const publicUser = (u: any) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  phone: u.phone ?? null,
  title: u.title ?? null,
  status: u.status,
  customer_id: u.customer_id ?? null,
  last_login: u.last_login ?? null,
  locked_until: u.locked_until && u.locked_until > new Date().toISOString() ? u.locked_until : null,
  created_at: u.created_at,
});

/** Validates a new password against Settings → Security and returns its bcrypt hash. */
export async function hashNewPassword(password: string, field = 'new_password') {
  const security = await getSetting('security');
  parse(z.object({ [field]: passwordSchema(security.password_min_length, security.enforce_strong_passwords) }), { [field]: password });
  return bcrypt.hash(password, 10);
}

/**
 * Failed sign-ins live in login_failures per account and network address. This copies a summary onto
 * the user (total failures, latest active lock) so Users & roles can show it next to Unlock.
 */
export async function syncAccountLock(userId: number) {
  const s = await db.get<{ failed: number | null; until: string | null }>(
    'SELECT SUM(failed) AS failed, MAX(locked_until) AS until FROM login_failures WHERE user_id = ? AND (locked_until IS NULL OR locked_until > ?)',
    [userId, new Date().toISOString()],
  );
  await db.update('users', userId, { failed_logins: s?.failed ?? 0, locked_until: s?.until ?? null });
}

/** Unlock, password reset: forget every failed sign-in for the account. */
export async function clearLoginFailures(userId: number) {
  await db.run('DELETE FROM login_failures WHERE user_id = ?', [userId]);
  await db.update('users', userId, { failed_logins: 0, locked_until: null });
}
