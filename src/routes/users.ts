import crypto from 'node:crypto';
import { Router } from 'express';
import { userBody, userListQuery, userStatusBody, type Role } from '@estateflow/shared';
import { db } from '../db/index.js';
import { adminAppReadOnly, authorize, type AuthUser } from '../middleware/auth.js';
import { HttpError, forbidden, idParam, likeParam, notFound, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { nowIso } from '../utils/dates.js';
import { audit } from '../services/activity.js';
import { revokeAllSessions, sha256 } from '../services/tokens.js';
import { hashNewPassword, publicUser } from '../services/users.js';

const r = Router();

// Lightweight staff directory for assignment pickers and the app's "call a colleague" list.
r.get('/directory', authorize('admin', 'manager', 'sales', 'accounts'), async (_req, res) => {
  res.json({ data: await db.all("SELECT id, name, role, title, phone FROM users WHERE status = 'Active' AND role != 'customer' ORDER BY name") });
});

// ─── Password reset codes (no email: an admin or manager hands the code over in person) ──
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_MINUTES = 30;
const newCode = () => Array.from(crypto.randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

/** Managers handle resets for sales executives and customers; admins for everyone. */
function canReset(actor: AuthUser, targetRole: Role) {
  return actor.role === 'admin' || (actor.role === 'manager' && (targetRole === 'sales' || targetRole === 'customer'));
}

const resetManagers = authorize('admin', 'manager');

r.get('/reset-requests', resetManagers, async (req, res) => {
  const managerScope = req.user.role === 'manager' ? " AND u.role IN ('sales','customer')" : '';
  const data = await db.all(
    `SELECT pr.id, pr.user_id, pr.email, pr.note, pr.status, pr.requested_at, pr.issued_at, pr.code_expires_at, pr.completed_at,
            u.name AS user_name, u.role AS user_role, ib.name AS issued_by_name
     FROM password_reset_requests pr
     LEFT JOIN users u ON u.id = pr.user_id
     LEFT JOIN users ib ON ib.id = pr.issued_by
     WHERE (pr.status IN ('Pending','Issued') OR pr.requested_at > ?)${managerScope}
     ORDER BY CASE pr.status WHEN 'Pending' THEN 0 WHEN 'Issued' THEN 1 ELSE 2 END, pr.requested_at DESC
     LIMIT 100`,
    [new Date(Date.now() - 14 * 86_400_000).toISOString()],
  );
  res.json({ data, meta: { pending: data.filter((d) => d.status === 'Pending').length } });
});

async function issueCode(userId: number, actor: AuthUser, requestId: number | null, ctx: { ip?: string; request_id?: string }) {
  const user = await db.get('SELECT id, name, email, role, status FROM users WHERE id = ?', [userId]);
  if (!user) throw notFound('User');
  if (user.status !== 'Active') throw new HttpError(422, 'Activate this account before issuing a reset code');
  if (!canReset(actor, user.role)) throw forbidden('You cannot reset the password for this account');
  const code = newCode();
  const expires = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString();
  await db.transaction(async () => {
    // Only the newest code works.
    await db.run("UPDATE password_reset_requests SET status = 'Dismissed', code_hash = NULL WHERE user_id = ? AND status = 'Issued'", [userId]);
    const fields = { status: 'Issued', code_hash: sha256(code), code_expires_at: expires, attempts: 0, issued_by: actor.id, issued_at: nowIso() };
    if (requestId) await db.update('password_reset_requests', requestId, fields);
    else await db.insert('password_reset_requests', { user_id: userId, email: user.email, requested_at: nowIso(), ...fields });
    if (requestId) await db.run("UPDATE password_reset_requests SET status = 'Dismissed' WHERE user_id = ? AND status = 'Pending' AND id != ?", [userId, requestId]);
  });
  await audit({ user_id: actor.id, action: 'reset_code_issued', title: `Issued a reset code for ${user.name}`, entity_type: 'user', entity_id: userId, ...ctx });
  // The plain code is returned exactly once; only its hash is stored.
  return { code, expires_at: expires, user: { id: user.id, name: user.name, email: user.email } };
}

r.post('/reset-requests/:id/issue', resetManagers, async (req, res) => {
  const request = await db.get('SELECT * FROM password_reset_requests WHERE id = ?', [idParam(req)]);
  if (!request || !request.user_id) throw notFound('Reset request');
  if (request.status === 'Completed') throw new HttpError(409, 'This request has already been completed');
  res.json(await issueCode(request.user_id, req.user, request.id, { ip: req.ip, request_id: req.requestId }));
});

r.post('/reset-requests/:id/dismiss', resetManagers, async (req, res) => {
  const request = await db.get('SELECT pr.*, u.role FROM password_reset_requests pr LEFT JOIN users u ON u.id = pr.user_id WHERE pr.id = ?', [idParam(req)]);
  if (!request) throw notFound('Reset request');
  if (!canReset(req.user, request.role)) throw forbidden();
  await db.update('password_reset_requests', request.id, { status: 'Dismissed', code_hash: null });
  res.json({ ok: true, id: request.id });
});

r.post('/:id/issue-reset', resetManagers, async (req, res) => {
  res.json(await issueCode(idParam(req), req.user, null, { ip: req.ip, request_id: req.requestId }));
});

// ─── User management (administrators) ───────────────────────────────────
r.use(authorize('admin'), adminAppReadOnly);

const ROLE_ORDER = "CASE u.role WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'sales' THEN 3 WHEN 'accounts' THEN 4 ELSE 5 END";

r.get('/', async (req, res) => {
  const q = parseQuery(userListQuery, req);
  const p = paging(q, 50);
  const params: unknown[] = [];
  let where = 'WHERE 1=1';
  if (q.role) { where += ' AND u.role = ?'; params.push(q.role); }
  if (q.status) { where += ' AND u.status = ?'; params.push(q.status); }
  if (q.q) { where += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)'; const l = likeParam(q.q); params.push(l, l, l); }
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users u ${where}`, params))!.n;
  const roleCounts = await db.all(`SELECT u.role, COUNT(*) AS n FROM users u ${where} GROUP BY u.role`, params);
  const rows = await db.all(
    `SELECT u.*, c.name AS customer_name,
       (SELECT COUNT(*) FROM leads l WHERE l.assigned_to = u.id) AS leads_count,
       (SELECT COUNT(*) FROM refresh_tokens t WHERE t.user_id = u.id AND t.revoked_at IS NULL AND t.expires_at > ?) AS active_sessions
     FROM users u LEFT JOIN customers c ON c.id = u.customer_id ${where}
     ORDER BY u.status, ${ROLE_ORDER}, u.name LIMIT ? OFFSET ?`,
    [nowIso(), ...params, p.limit, p.offset],
  );
  res.json({
    data: rows.map((u) => ({ ...publicUser(u), customer_name: u.customer_name, leads_count: u.leads_count, active_sessions: u.active_sessions })),
    meta: pageMeta(total, p, { roleCounts }),
  });
});

async function validateLink(body: { role: Role; customer_id?: number | null }, exceptUserId?: number) {
  if (body.role !== 'customer') return;
  if (!body.customer_id) throw new HttpError(422, 'customer_id: Select the customer this app login belongs to');
  if (!(await db.get('SELECT id FROM customers WHERE id = ?', [body.customer_id]))) throw new HttpError(422, 'customer_id: Customer not found');
  const taken = await db.get("SELECT id FROM users WHERE customer_id = ? AND role = 'customer' AND id != ?", [body.customer_id, exceptUserId ?? 0]);
  if (taken) throw new HttpError(409, 'This customer already has an app login');
}

r.post('/', async (req, res) => {
  const body = parse(userBody, req.body);
  if (!body.password) throw new HttpError(422, 'password: is required');
  await validateLink(body);
  if (await db.get('SELECT id FROM users WHERE email = ?', [body.email])) throw new HttpError(409, 'A user with this email already exists');
  const { password, ...rest } = body;
  const id = await db.insert('users', {
    ...rest,
    customer_id: body.role === 'customer' ? body.customer_id : null,
    password_hash: await hashNewPassword(password, 'password'),
    password_changed_at: nowIso(),
    status: 'Active',
    created_at: nowIso(),
  });
  res.status(201).json(publicUser(await db.get('SELECT * FROM users WHERE id = ?', [id])));
});

r.put('/:id', async (req, res) => {
  const id = idParam(req);
  const body = parse(userBody, req.body);
  const existing = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!existing) throw notFound('User');
  if (id === req.user.id && body.role !== 'admin') throw new HttpError(422, 'role: You cannot remove your own administrator role');
  if (await db.get('SELECT id FROM users WHERE email = ? AND id != ?', [body.email, id])) throw new HttpError(409, 'A user with this email already exists');
  await validateLink(body, id);
  const { password, ...rest } = body;
  await db.update('users', id, {
    ...rest,
    customer_id: body.role === 'customer' ? body.customer_id : null,
    ...(password ? { password_hash: await hashNewPassword(password, 'password'), password_changed_at: nowIso() } : {}),
  });
  // A new password or a role change ends the user's existing sessions.
  if (password || body.role !== existing.role) await revokeAllSessions(id);
  res.json(publicUser(await db.get('SELECT * FROM users WHERE id = ?', [id])));
});

r.patch('/:id/status', async (req, res) => {
  const id = idParam(req);
  const { status } = parse(userStatusBody, req.body);
  if (id === req.user.id) throw new HttpError(422, 'You cannot deactivate your own account');
  if (!(await db.update('users', id, { status }))) throw notFound('User');
  if (status === 'Inactive') await revokeAllSessions(id);
  res.json({ id, status });
});

r.post('/:id/force-logout', async (req, res) => {
  const id = idParam(req);
  if (!(await db.get('SELECT id FROM users WHERE id = ?', [id]))) throw notFound('User');
  await revokeAllSessions(id);
  res.json({ ok: true, id });
});

r.post('/:id/unlock', async (req, res) => {
  const id = idParam(req);
  if (!(await db.update('users', id, { failed_logins: 0, locked_until: null }))) throw notFound('User');
  res.json({ ok: true, id });
});

export default r;
