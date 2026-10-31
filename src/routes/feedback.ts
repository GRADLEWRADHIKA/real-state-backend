import { Router } from 'express';
import { listQuery, visitFeedbackBody } from '@estateflow/shared';
import { z } from 'zod';
import { db } from '../db/index.js';
import { authorize, isScoped } from '../middleware/auth.js';
import { HttpError, forbidden, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { nowIso } from '../utils/dates.js';
import { logActivity, notifyRoles } from '../services/activity.js';

/**
 * Ratings of 1-5 with a comment: given by a visitor after a site visit (recorded by the executive who
 * took them) or by a customer after possession or at any time from their portal. Managers read them all.
 */
const r = Router();

const SELECT = `
  SELECT f.*, c.name AS customer_name, l.name AS lead_name, u.name AS agent_name
  FROM feedback f LEFT JOIN customers c ON c.id = f.customer_id LEFT JOIN leads l ON l.id = f.lead_id LEFT JOIN users u ON u.id = f.agent_id`;

r.get('/', authorize('admin', 'manager'), async (req, res) => {
  const q = parseQuery(listQuery.extend({ kind: z.enum(['site_visit', 'possession', 'general']).optional().or(z.literal('').transform(() => undefined)) }), req);
  const p = paging(q, 100);
  const where = q.kind ? 'WHERE f.kind = ?' : 'WHERE 1=1';
  const params = q.kind ? [q.kind] : [];
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM feedback f ${where}`, params))!.n;
  const data = await db.all(`${SELECT} ${where} ORDER BY f.created_at DESC, f.id DESC LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  const summary = await db.all('SELECT kind, COUNT(*) AS n, ROUND(AVG(rating), 1) AS average, SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) AS low FROM feedback GROUP BY kind');
  const distribution = await db.all(`SELECT rating, COUNT(*) AS n FROM feedback f ${where} GROUP BY rating ORDER BY rating`, params);
  const byAgent = await db.all(
    "SELECT u.id AS agent_id, u.name AS agent_name, COUNT(*) AS n, ROUND(AVG(f.rating), 1) AS average FROM feedback f JOIN users u ON u.id = f.agent_id WHERE f.kind = 'site_visit' GROUP BY u.id ORDER BY average DESC",
  );
  res.json({ data, meta: pageMeta(total, p, { summary, distribution, byAgent }) });
});

/** The executive records how the visitor rated the visit (one rating per visit; a second call updates it). */
r.post('/site-visit', authorize('admin', 'manager', 'sales'), async (req, res) => {
  const data = parse(visitFeedbackBody, req.body);
  const v = await db.get('SELECT v.id, v.lead_id, v.agent_id, v.status, l.name AS lead_name FROM site_visits v JOIN leads l ON l.id = v.lead_id WHERE v.id = ?', [data.site_visit_id]);
  if (!v) throw new HttpError(422, 'site_visit_id: Unknown visit');
  if (isScoped(req.user) && v.agent_id !== req.user.id) throw forbidden('You can only record feedback for your own visits');
  if (v.status === 'Cancelled') throw new HttpError(409, 'This visit was cancelled');
  const existing = await db.get<{ id: number }>('SELECT id FROM feedback WHERE site_visit_id = ?', [v.id]);
  const row = { kind: 'site_visit', rating: data.rating, comment: data.comment ?? null, lead_id: v.lead_id, site_visit_id: v.id, agent_id: v.agent_id, given_by: 'visitor', created_by: req.user.id };
  const id = existing ? (await db.update('feedback', existing.id, row), existing.id) : await db.insert('feedback', { ...row, created_at: nowIso() });
  await logActivity({ lead_id: v.lead_id, type: 'feedback', title: `Visit rated ${data.rating}/5`, description: data.comment ?? undefined, user_id: req.user.id });
  if (data.rating <= 2) await notifyRoles(['admin', 'manager'], { type: 'alert', title: 'Low visit rating', message: `${v.lead_name} rated their site visit ${data.rating}/5${data.comment ? `: ${data.comment}` : ''}.`, link: `/leads/${v.lead_id}` }, req.user.id);
  res.status(existing ? 200 : 201).json(await db.get(`${SELECT} WHERE f.id = ?`, [id]));
});

export default r;
