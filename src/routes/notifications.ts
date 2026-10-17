import { Router } from 'express';
import { notificationListQuery } from '@estateflow/shared';
import { db } from '../db/index.js';
import { idParam, notFound, pageMeta, paging, parseQuery } from '../utils/http.js';

const r = Router();

r.get('/', async (req, res) => {
  const q = parseQuery(notificationListQuery, req);
  const p = paging(q, 30);
  let where = 'WHERE user_id = ?';
  const params: unknown[] = [req.user.id];
  if (q.unread === '1') where += ' AND is_read = 0';
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications ${where}`, params))!.n;
  const unread = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]))!.n;
  const rows = await db.all(`SELECT * FROM notifications ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  res.json({ data: rows.map((n) => ({ ...n, is_read: !!n.is_read })), meta: pageMeta(total, p, { unread }) });
});

r.post('/read-all', async (req, res) => {
  await db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ ok: true, unread: 0 });
});

r.patch('/:id/read', async (req, res) => {
  const id = idParam(req);
  const changed = await db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, req.user.id]);
  if (!changed.changes) throw notFound('Notification');
  res.json({ ok: true, id });
});

export default r;
