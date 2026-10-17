import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { passwordSchema } from '@estateflow/shared';
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
