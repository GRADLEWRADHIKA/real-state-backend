import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { changePasswordBody, forgotPasswordBody, loginBody, profileBody, refreshBody, resetPasswordBody } from '@estateflow/shared';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { assertRoleOnClient, authenticate, requestClient } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { HttpError, parse } from '../utils/http.js';
import { nowIso } from '../utils/dates.js';
import { audit } from '../services/activity.js';
import { notifyRoles, notifyUsers } from '../services/notifications.js';
import { getSetting } from '../services/settings.js';
import { issueSession, revokeAllSessions, revokeRefreshToken, rotateSession, sha256 } from '../services/tokens.js';
import { hashNewPassword, publicUser } from '../services/users.js';

const r = Router();

export const authLimiter = rateLimit({
  name: 'auth',
  windowMs: config.rateLimit.windowMs,
  max: () => config.rateLimit.auth,
  message: 'Too many attempts from this device. Please wait a minute and try again.',
});

const ctx = (req: any) => ({ ip: req.ip, request_id: req.requestId });

// Dummy hash so unknown emails take as long as wrong passwords (no account enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('estateflow-timing-guard', 10);

r.post('/login', authLimiter, async (req, res) => {
  const body = parse(loginBody, req.body);
  const headerClient = requestClient(req);
  if (headerClient && headerClient !== body.client) throw new HttpError(400, 'Client mismatch');
  const security = await getSetting('security');
  const user = await db.get('SELECT * FROM users WHERE email = ?', [body.email]);
  const now = nowIso();

  if (user?.locked_until && user.locked_until > now) {
    const mins = Math.max(1, Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60_000));
    throw new HttpError(423, `Too many failed sign-in attempts. This account is locked for ${mins} more minute${mins > 1 ? 's' : ''}.`, { code: 'locked', until: user.locked_until });
  }
  const ok = await bcrypt.compare(body.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    if (user) {
      const failed = (user.failed_logins ?? 0) + 1;
      // Lock after N failures; each further failure doubles the lock (capped at 24 h).
      const over = failed - security.max_failed_logins;
      const lockMin = over >= 0 ? Math.min(1440, security.lockout_minutes * 2 ** Math.min(6, over)) : 0;
      await db.update('users', user.id, { failed_logins: failed, locked_until: lockMin ? new Date(Date.now() + lockMin * 60_000).toISOString() : null });
      await audit({ user_id: user.id, action: 'login_failed', title: 'Failed sign-in', entity_type: 'user', entity_id: user.id, description: lockMin ? `Account locked for ${lockMin} min` : `${failed} failed attempt(s)`, ...ctx(req) });
      if (lockMin && over === 0) {
        await notifyRoles(['admin'], { type: 'alert', title: 'Account locked', message: `${user.name} (${user.email}) was locked after ${failed} failed sign-in attempts.`, link: '/users' });
      }
    }
    throw new HttpError(401, 'Incorrect email or password');
  }
  if (user.status !== 'Active') throw new HttpError(403, 'Your account has been deactivated. Contact your administrator.', { code: 'inactive' });
  assertRoleOnClient(user.role, body.client);

  await db.update('users', user.id, { last_login: now, failed_logins: 0, locked_until: null });
  const session = await issueSession({ ...user, last_login: now }, body.client, body.remember, body.device ?? String(req.headers['user-agent'] ?? '').slice(0, 120), req.ip);
  await audit({ user_id: user.id, action: 'login', title: `Signed in to the ${body.client}`, entity_type: 'user', entity_id: user.id, ...ctx(req) });
  res.json(session);
});

r.post('/refresh', authLimiter, async (req, res) => {
  const { refreshToken } = parse(refreshBody, req.body);
  const client = requestClient(req);
  if (!client) throw new HttpError(400, 'Missing X-EstateFlow-Client header');
  res.json(await rotateSession(refreshToken, client, req.ip));
});

r.post('/logout', async (req, res) => {
  const token = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  if (token) {
    const row = await db.get<{ user_id: number }>('SELECT user_id FROM refresh_tokens WHERE token_hash = ?', [sha256(token)]);
    await revokeRefreshToken(token);
    if (row) await audit({ user_id: row.user_id, action: 'logout', title: 'Signed out', entity_type: 'user', entity_id: row.user_id, ...ctx(req) });
  }
  res.json({ ok: true });
});

r.post('/logout-all', authenticate, async (req, res) => {
  await revokeAllSessions(req.user.id);
  await audit({ user_id: req.user.id, action: 'logout_all', title: 'Signed out of every device', entity_type: 'user', entity_id: req.user.id, ...ctx(req) });
  res.json({ ok: true });
});

const FORGOT_MESSAGE =
  'Your request has been sent to your administrator. They will give you a one-time reset code in person or by phone — enter it on the "I have a reset code" screen.';

/** No email is sent: the request appears for administrators/managers, who issue a one-time code. */
r.post('/forgot-password', authLimiter, async (req, res) => {
  const { email, note } = parse(forgotPasswordBody, req.body);
  const user = await db.get("SELECT id, name, role, status FROM users WHERE email = ? AND status = 'Active'", [email]);
  if (user) {
    const recent = await db.get("SELECT id FROM password_reset_requests WHERE user_id = ? AND status = 'Pending' AND requested_at > ?", [
      user.id,
      new Date(Date.now() - 15 * 60_000).toISOString(),
    ]);
    if (!recent) {
      const id = await db.insert('password_reset_requests', { user_id: user.id, email, note: note ?? null, ip: req.ip, status: 'Pending', requested_at: nowIso() });
      const n = { type: 'alert', title: 'Password reset requested', message: `${user.name} (${email}) asked for a password reset. Issue a one-time code from Users → Reset requests.`, link: `/users?tab=resets&request=${id}` };
      await notifyRoles(['admin'], n);
      if (user.role === 'sales' || user.role === 'customer') await notifyRoles(['manager'], n);
      await audit({ user_id: user.id, action: 'password_reset_requested', title: 'Password reset requested', entity_type: 'user', entity_id: user.id, ...ctx(req) });
    }
  }
  res.json({ message: FORGOT_MESSAGE });
});

r.post('/reset-password', authLimiter, async (req, res) => {
  const body = parse(resetPasswordBody, req.body);
  const user = await db.get("SELECT * FROM users WHERE email = ? AND status = 'Active'", [body.email]);
  const invalid = new HttpError(422, 'code: This reset code is invalid or has expired. Ask your administrator for a new one.');
  if (!user) throw invalid;
  const request = await db.get("SELECT * FROM password_reset_requests WHERE user_id = ? AND status = 'Issued' ORDER BY issued_at DESC LIMIT 1", [user.id]);
  if (!request || !request.code_hash || request.code_expires_at <= nowIso() || request.attempts >= 5) throw invalid;
  if (sha256(body.code.trim().toUpperCase()) !== request.code_hash) {
    await db.run('UPDATE password_reset_requests SET attempts = attempts + 1 WHERE id = ?', [request.id]);
    throw invalid;
  }
  const hash = await hashNewPassword(body.new_password);
  await db.transaction(async () => {
    await db.update('users', user.id, { password_hash: hash, password_changed_at: nowIso(), failed_logins: 0, locked_until: null });
    await db.update('password_reset_requests', request.id, { status: 'Completed', completed_at: nowIso(), code_hash: null });
  });
  await revokeAllSessions(user.id);
  await audit({ user_id: user.id, action: 'password_reset', title: 'Password reset with a one-time code', entity_type: 'user', entity_id: user.id, ...ctx(req) });
  if (request.issued_by) await notifyUsers([request.issued_by], { type: 'info', title: 'Password reset completed', message: `${user.name} set a new password with the code you issued.`, link: '/users' });
  res.json({ message: 'Your password has been changed. You can now sign in.' });
});

r.get('/me', authenticate, async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ user: publicUser(user), client: req.user.client });
});

r.put('/profile', authenticate, async (req, res) => {
  const body = parse(profileBody, req.body);
  await db.update('users', req.user.id, body);
  await audit({ user_id: req.user.id, action: 'profile_update', title: 'Updated own profile', entity_type: 'user', entity_id: req.user.id, ...ctx(req) });
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ user: publicUser(user) });
});

/** Changing the password ends every other session and returns a fresh one for this device. */
r.put('/password', authenticate, async (req, res) => {
  const body = parse(changePasswordBody, req.body);
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(body.current_password, user.password_hash))) throw new HttpError(422, 'current_password: Current password is incorrect');
  if (body.current_password === body.new_password) throw new HttpError(422, 'new_password: Choose a password you have not used just now');
  const hash = await hashNewPassword(body.new_password);
  await db.update('users', req.user.id, { password_hash: hash, password_changed_at: nowIso() });
  await revokeAllSessions(req.user.id);
  await audit({ user_id: req.user.id, action: 'password_change', title: 'Changed password', entity_type: 'user', entity_id: req.user.id, ...ctx(req) });
  const fresh = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ message: 'Password updated. Other devices have been signed out.', session: await issueSession(fresh, req.user.client, req.body?.remember === true, undefined, req.ip) });
});

export default r;
