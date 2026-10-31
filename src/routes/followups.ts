import { Router } from 'express';
import { followupBody, followupListQuery, followupUpdateBody, humanDate } from '@estateflow/shared';
import { db } from '../db/index.js';
import { adminAppReadOnly, authorize, isScoped, scope } from '../middleware/auth.js';
import { forbidden, idParam, likeParam, notFound, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { addDays, nowIso, today } from '../utils/dates.js';
import { logActivity, notifyUsers } from '../services/activity.js';
import { advanceLead, refreshLeadFollowup, touchLeadContact } from '../services/leads.js';
import { getLeadFor } from './leads.js';

const r = Router();
r.use(authorize('admin', 'manager', 'sales'), adminAppReadOnly);

const SELECT = `
  SELECT f.*, l.name AS lead_name, l.phone AS lead_phone, l.code AS lead_code, l.status AS lead_status, u.name AS agent_name,
         p.project AS property_project
  FROM followups f
  JOIN leads l ON l.id = f.lead_id
  LEFT JOIN users u ON u.id = f.agent_id
  LEFT JOIN properties p ON p.id = l.property_id`;

r.get('/', async (req, res) => {
  const q = parseQuery(followupListQuery, req);
  const p = paging(q, 100);
  const s = scope(req.user, 'f.agent_id');
  let where = `WHERE 1=1${s.sql}`;
  const params: unknown[] = [...s.params];
  const t = today();
  if (q.status) { where += ' AND f.status = ?'; params.push(q.status); }
  if (q.type) { where += ' AND f.type = ?'; params.push(q.type); }
  if (q.agent) { where += ' AND f.agent_id = ?'; params.push(q.agent); }
  if (q.lead) { where += ' AND f.lead_id = ?'; params.push(q.lead); }
  if (q.bucket === 'today') { where += " AND f.due_date = ? AND f.status = 'Pending'"; params.push(t); }
  if (q.bucket === 'overdue') { where += " AND f.due_date < ? AND f.status = 'Pending'"; params.push(t); }
  if (q.bucket === 'upcoming') { where += " AND f.due_date > ? AND f.status = 'Pending'"; params.push(t); }
  if (q.bucket === 'week') { where += " AND f.due_date BETWEEN ? AND ? AND f.status = 'Pending'"; params.push(t, addDays(t, 7)); }
  if (q.from) { where += ' AND f.due_date >= ?'; params.push(q.from); }
  if (q.to) { where += ' AND f.due_date <= ?'; params.push(q.to); }
  if (q.q) { const like = likeParam(q.q); where += ' AND (l.name LIKE ? OR f.notes LIKE ? OR l.phone LIKE ?)'; params.push(like, like, like); }
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM followups f JOIN leads l ON l.id = f.lead_id ${where}`, params))!.n;
  // Completed follow-ups read newest first; everything else in the order it falls due.
  const order = q.status === 'Completed' ? 'f.due_date DESC, f.due_time DESC' : "CASE f.status WHEN 'Pending' THEN 0 ELSE 1 END, f.due_date, f.due_time";
  const data = await db.all(`${SELECT} ${where} ORDER BY ${order}, f.id LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);

  const sc = scope(req.user, 'agent_id');
  const summary = await db.get(
    `SELECT
       SUM(CASE WHEN status = 'Pending' AND due_date = ? THEN 1 ELSE 0 END) AS today,
       SUM(CASE WHEN status = 'Pending' AND due_date < ? THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN status = 'Pending' AND due_date > ? THEN 1 ELSE 0 END) AS upcoming,
       SUM(CASE WHEN status = 'Completed' AND substr(completed_at, 1, 10) >= ? THEN 1 ELSE 0 END) AS completed_week
     FROM followups WHERE 1=1${sc.sql}`,
    [t, t, t, addDays(t, -7), ...sc.params],
  );
  res.json({
    data,
    meta: pageMeta(total, p, { summary: { today: summary?.today ?? 0, overdue: summary?.overdue ?? 0, upcoming: summary?.upcoming ?? 0, completed_week: summary?.completed_week ?? 0 } }),
  });
});

r.post('/', async (req, res) => {
  const data = parse(followupBody, req.body);
  const lead = await getLeadFor(data.lead_id, req.user);
  const agent = req.user.role === 'sales' ? req.user.id : (data.agent_id ?? lead.assigned_to ?? req.user.id);
  const id = await db.insert('followups', { ...data, agent_id: agent, created_by: req.user.id, created_at: nowIso() });
  await refreshLeadFollowup(lead.id);
  await logActivity({ lead_id: lead.id, type: 'followup', title: `${data.type} follow-up scheduled`, description: `${humanDate(data.due_date, data.due_time)}${data.notes ? ` — ${data.notes}` : ''}`, user_id: req.user.id });
  await notifyUsers([agent], { type: 'followup', title: 'Follow-up scheduled', message: `${data.type} with ${lead.name} on ${humanDate(data.due_date, data.due_time)}.`, link: `/leads/${lead.id}`, trigger: 'followup_reminder' }, req.user.id);
  res.status(201).json(await db.get(`${SELECT} WHERE f.id = ?`, [id]));
});

r.put('/:id', async (req, res) => {
  const id = idParam(req);
  const f = await db.get('SELECT * FROM followups WHERE id = ?', [id]);
  if (!f) throw notFound('Follow-up');
  if (isScoped(req.user) && f.agent_id !== req.user.id) throw forbidden();
  const data = parse(followupUpdateBody, req.body);
  delete data.lead_id;
  if (req.user.role === 'sales') delete data.agent_id;
  const completing = data.status === 'Completed' && f.status !== 'Completed';
  const rescheduled = (data.due_date && data.due_date !== f.due_date) || (data.due_time && data.due_time !== f.due_time);
  await db.update('followups', id, {
    ...data,
    completed_at: completing ? nowIso() : data.status && data.status !== 'Completed' ? null : undefined,
    overdue_at: rescheduled || completing ? null : undefined,
  });
  if (completing) {
    await touchLeadContact(f.lead_id);
    await logActivity({ lead_id: f.lead_id, type: 'followup', title: `${data.type ?? f.type} follow-up completed`, description: data.outcome || f.notes, user_id: req.user.id });
    await advanceLead(f.lead_id, 'Contacted', req.user);
  } else if (data.status === 'Missed' && f.status !== 'Missed') {
    await logActivity({ lead_id: f.lead_id, type: 'followup', title: `${f.type} follow-up missed`, description: data.outcome, user_id: req.user.id });
  } else if (rescheduled) {
    await logActivity({ lead_id: f.lead_id, type: 'followup', title: `${f.type} follow-up rescheduled`, description: humanDate(data.due_date ?? f.due_date, data.due_time ?? f.due_time), user_id: req.user.id });
  }
  await refreshLeadFollowup(f.lead_id);
  res.json(await db.get(`${SELECT} WHERE f.id = ?`, [id]));
});

r.delete('/:id', async (req, res) => {
  const id = idParam(req);
  const f = await db.get('SELECT * FROM followups WHERE id = ?', [id]);
  if (!f) throw notFound('Follow-up');
  if (isScoped(req.user) && f.agent_id !== req.user.id) throw forbidden();
  await db.run('DELETE FROM followups WHERE id = ?', [id]);
  await refreshLeadFollowup(f.lead_id);
  res.json({ ok: true, id });
});

export default r;
