import { Router } from 'express';
import { auditListQuery, toCsv } from '@estateflow/shared';
import { db } from '../db/index.js';
import { authorize, dashboardOnly } from '../middleware/auth.js';
import { attachmentHeader, likeParam, pageMeta, paging, parseQuery } from '../utils/http.js';
import { today } from '../utils/dates.js';

/** Who did what, when, from where. Administrators only, in the dashboard. */
const r = Router();
r.use(authorize('admin'), dashboardOnly);

function filters(q: ReturnType<typeof auditListQuery.parse>) {
  let where = "WHERE a.type = 'audit'";
  const params: unknown[] = [];
  if (q.user) { where += ' AND a.user_id = ?'; params.push(q.user); }
  if (q.entity_type) { where += ' AND a.entity_type = ?'; params.push(q.entity_type); }
  if (q.action) { where += ' AND a.action LIKE ?'; params.push(likeParam(q.action)); }
  if (q.from) { where += ' AND a.created_at >= ?'; params.push(q.from); }
  if (q.to) { where += ' AND a.created_at < ?'; params.push(`${q.to}T99`); }
  if (q.q) { where += ' AND (a.title LIKE ? OR a.description LIKE ? OR u.name LIKE ? OR a.ip LIKE ?)'; const l = likeParam(q.q); params.push(l, l, l, l); }
  return { where, params };
}

const SELECT = `SELECT a.id, a.created_at, a.user_id, u.name AS user_name, u.role AS user_role, a.action, a.title, a.description,
  a.entity_type, a.entity_id, a.ip, a.request_id FROM activities a LEFT JOIN users u ON u.id = a.user_id`;

r.get('/', async (req, res) => {
  const q = parseQuery(auditListQuery, req);
  const p = paging(q, 50);
  const { where, params } = filters(q);
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM activities a LEFT JOIN users u ON u.id = a.user_id ${where}`, params))!.n;
  const entityTypes = await db.all<{ entity_type: string }>("SELECT DISTINCT entity_type FROM activities WHERE type = 'audit' AND entity_type IS NOT NULL ORDER BY entity_type");
  const data = await db.all(`${SELECT} ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  res.json({ data, meta: pageMeta(total, p, { entityTypes: entityTypes.map((e) => e.entity_type) }) });
});

r.get('/export.csv', async (req, res) => {
  const q = parseQuery(auditListQuery, req);
  const { where, params } = filters(q);
  const rows = await db.all(`${SELECT} ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT 50000`, params);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', attachmentHeader(`audit-log-${today()}.csv`));
  res.send(
    toCsv(rows, [
      { key: 'created_at', label: 'Time' },
      { key: 'user_name', label: 'User', value: (r) => r.user_name ?? 'System' },
      { key: 'user_role', label: 'Role' },
      { key: 'action', label: 'Action' },
      { key: 'title', label: 'Summary' },
      { key: 'description', label: 'Details' },
      { key: 'entity_type', label: 'Entity' },
      { key: 'entity_id', label: 'Entity ID' },
      { key: 'ip', label: 'IP' },
      { key: 'request_id', label: 'Request ID' },
    ]),
  );
});

export default r;
