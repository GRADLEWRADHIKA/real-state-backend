import { Router } from 'express';
import { customerRequestUpdateBody, requestListQuery } from '@estateflow/shared';
import { db } from '../db/index.js';
import { authorize } from '../middleware/auth.js';
import { forbidden, idParam, likeParam, notFound, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { nowIso } from '../utils/dates.js';
import { logActivity } from '../services/activity.js';
import { notifyUsers } from '../services/notifications.js';
import { realtime } from '../services/realtime.js';

/** Staff inbox for requests raised from the customer app. Sales see their own customers' requests. */
const r = Router();
r.use(authorize('admin', 'manager', 'sales', 'accounts'));

const SELECT = `
  SELECT r.*, c.name AS customer_name, c.code AS customer_code, c.phone AS customer_phone, c.assigned_to,
         a.name AS agent_name, h.name AS handled_by_name
  FROM customer_requests r
  JOIN customers c ON c.id = r.customer_id
  LEFT JOIN users a ON a.id = c.assigned_to
  LEFT JOIN users h ON h.id = r.handled_by`;

function scopeFor(user: { id: number; role: string }) {
  if (user.role === 'sales') return { sql: ' AND c.assigned_to = ?', params: [user.id] };
  if (user.role === 'accounts') return { sql: " AND r.type = 'Payment'", params: [] };
  return { sql: '', params: [] };
}

r.get('/', async (req, res) => {
  const q = parseQuery(requestListQuery, req);
  const p = paging(q);
  const s = scopeFor(req.user);
  let where = `WHERE 1=1${s.sql}`;
  const params: unknown[] = [...s.params];
  if (q.type) { where += ' AND r.type = ?'; params.push(q.type); }
  if (q.customer) { where += ' AND r.customer_id = ?'; params.push(q.customer); }
  if (q.q) { where += ' AND (r.subject LIKE ? OR c.name LIKE ? OR c.code LIKE ?)'; const l = likeParam(q.q); params.push(l, l, l); }
  // Tab counts ignore the status filter so every tab shows its own total.
  const statusCounts = await db.all(`SELECT r.status, COUNT(*) AS n FROM customer_requests r JOIN customers c ON c.id = r.customer_id ${where} GROUP BY r.status`, params);
  if (q.status) { where += ' AND r.status = ?'; params.push(q.status); }
  if (q.state === 'open') where += " AND r.status IN ('Open','In Progress')";
  const base = `FROM customer_requests r JOIN customers c ON c.id = r.customer_id ${where}`;
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n ${base}`, params))!.n;
  const data = await db.all(
    `${SELECT} ${where} ORDER BY CASE r.status WHEN 'Open' THEN 0 WHEN 'In Progress' THEN 1 ELSE 2 END, r.created_at DESC LIMIT ? OFFSET ?`,
    [...params, p.limit, p.offset],
  );
  res.json({ data, meta: pageMeta(total, p, { statusCounts }) });
});

async function getRequestFor(id: number, user: { id: number; role: string }) {
  const row = await db.get(`${SELECT} WHERE r.id = ?`, [id]);
  if (!row) throw notFound('Request');
  if (user.role === 'sales' && row.assigned_to !== user.id) throw forbidden();
  if (user.role === 'accounts' && row.type !== 'Payment') throw forbidden();
  return row;
}

r.get('/:id', async (req, res) => {
  res.json(await getRequestFor(idParam(req), req.user));
});

/** Admins may answer customers from the app too: replying is operational work, not configuration. */
r.patch('/:id', async (req, res) => {
  const id = idParam(req);
  const row = await getRequestFor(id, req.user);
  const body = parse(customerRequestUpdateBody, req.body);
  await db.update('customer_requests', id, { ...body, handled_by: req.user.id, updated_at: nowIso() });
  const portalUser = row.user_id ?? (await db.get("SELECT id FROM users WHERE customer_id = ? AND role = 'customer'", [row.customer_id]))?.id;
  if (body.status && body.status !== row.status) {
    await logActivity({ customer_id: row.customer_id, type: 'request', title: `Request ${body.status.toLowerCase()}: ${row.subject}`, description: body.response ?? null, user_id: req.user.id });
  }
  if (portalUser && (body.response || (body.status && body.status !== row.status))) {
    await notifyUsers([portalUser], {
      type: 'request',
      title: `Your ${row.type.toLowerCase()} request is ${(body.status ?? row.status).toLowerCase()}`,
      message: body.response || row.subject,
      link: '/requests',
      trigger: 'customer_request',
    });
    realtime.change(['portal'], { userIds: [portalUser] });
  }
  res.json(await getRequestFor(id, req.user));
});

export default r;
