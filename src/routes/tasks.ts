import { Router } from 'express';
import { taskBody, taskListQuery } from '@estateflow/shared';
import { db } from '../db/index.js';
import { adminAppReadOnly, authorize, type AuthUser } from '../middleware/auth.js';
import { HttpError, forbidden, idParam, likeParam, notFound, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { addDays, nowIso, today } from '../utils/dates.js';
import { notifyUsers } from '../services/activity.js';

const r = Router();
r.use(authorize('admin', 'manager', 'sales', 'accounts'), adminAppReadOnly);

const SELECT = `
  SELECT t.*, a.name AS assignee_name, c.name AS creator_name, l.name AS lead_name, l.code AS lead_code, cu.name AS customer_name
  FROM tasks t
  LEFT JOIN users a ON a.id = t.assigned_to
  LEFT JOIN users c ON c.id = t.created_by
  LEFT JOIN leads l ON l.id = t.lead_id
  LEFT JOIN customers cu ON cu.id = t.customer_id`;

// Admins and managers see every task; everyone else sees what they own or created.
const mine = (role: string) => !['admin', 'manager'].includes(role);

/** Linked lead/customer must be one the user can see (stops reading other executives' records through tasks). */
async function assertLinks(user: AuthUser, leadId?: number | null, customerId?: number | null, assignee?: number | null) {
  if (leadId) {
    const l = await db.get<{ assigned_to: number | null }>('SELECT assigned_to FROM leads WHERE id = ?', [leadId]);
    if (!l) throw new HttpError(422, 'lead_id: Unknown lead');
    if (user.role === 'sales' && l.assigned_to !== user.id) throw forbidden('You can only link tasks to your own leads');
    if (user.role === 'accounts') throw forbidden('Accounts tasks can be linked to customers, not leads');
  }
  if (customerId) {
    const c = await db.get<{ assigned_to: number | null }>('SELECT assigned_to FROM customers WHERE id = ?', [customerId]);
    if (!c) throw new HttpError(422, 'customer_id: Unknown customer');
    if (user.role === 'sales' && c.assigned_to !== user.id) throw forbidden('You can only link tasks to your own customers');
  }
  if (assignee) {
    const u = await db.get("SELECT id FROM users WHERE id = ? AND status = 'Active' AND role != 'customer'", [assignee]);
    if (!u) throw new HttpError(422, 'assigned_to: Select an active team member');
  }
}

r.get('/', async (req, res) => {
  const q = parseQuery(taskListQuery, req);
  const p = paging(q, 100);
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  const t = today();
  if (mine(req.user.role)) { where += ' AND (t.assigned_to = ? OR t.created_by = ?)'; params.push(req.user.id, req.user.id); }
  if (q.priority) { where += ' AND t.priority = ?'; params.push(q.priority); }
  if (q.assignee) { where += ' AND t.assigned_to = ?'; params.push(q.assignee); }
  if (q.mine === '1') { where += ' AND t.assigned_to = ?'; params.push(req.user.id); }
  if (q.lead) { where += ' AND t.lead_id = ?'; params.push(q.lead); }
  if (q.customer) { where += ' AND t.customer_id = ?'; params.push(q.customer); }
  if (q.due === 'overdue') { where += " AND t.due_date < ? AND t.status != 'Completed'"; params.push(t); }
  if (q.due === 'today') { where += " AND t.due_date = ? AND t.status != 'Completed'"; params.push(t); }
  if (q.due === 'week') { where += " AND t.due_date BETWEEN ? AND ? AND t.status != 'Completed'"; params.push(t, addDays(t, 7)); }
  if (q.from) { where += ' AND t.due_date >= ?'; params.push(q.from); }
  if (q.to) { where += ' AND t.due_date <= ?'; params.push(q.to); }
  if (q.q) { const like = likeParam(q.q); where += ' AND (t.title LIKE ? OR l.name LIKE ? OR cu.name LIKE ?)'; params.push(like, like, like); }
  const from = 'FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id LEFT JOIN customers cu ON cu.id = t.customer_id';
  // Tab counts follow every filter except the status itself.
  const counts = await db.all(`SELECT t.status, COUNT(*) AS n ${from} ${where} GROUP BY t.status`, params);
  if (q.status === 'open') where += " AND t.status != 'Completed'";
  else if (q.status) { where += ' AND t.status = ?'; params.push(q.status); }
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n ${from} ${where}`, params))!.n;
  const data = await db.all(
    `${SELECT} ${where} ORDER BY CASE t.status WHEN 'Completed' THEN 1 ELSE 0 END,
      CASE t.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, t.due_date NULLS LAST, t.id DESC LIMIT ? OFFSET ?`,
    [...params, p.limit, p.offset],
  );
  res.json({ data, meta: pageMeta(total, p, { statusCounts: Object.fromEntries(counts.map((c) => [c.status, c.n])) }) });
});

r.post('/', async (req, res) => {
  const data = parse(taskBody, req.body);
  // Sales executives and accounts staff assign tasks to themselves; managers/admins can delegate.
  const assignee = mine(req.user.role) ? req.user.id : (data.assigned_to ?? req.user.id);
  await assertLinks(req.user, data.lead_id, data.customer_id, assignee);
  const id = await db.insert('tasks', { ...data, assigned_to: assignee, created_by: req.user.id, completed_at: data.status === 'Completed' ? nowIso() : null, created_at: nowIso() });
  await notifyUsers([assignee], { type: 'task', title: 'New task assigned', message: `${req.user.name} assigned you: ${data.title}`, link: '/tasks' }, req.user.id);
  res.status(201).json(await db.get(`${SELECT} WHERE t.id = ?`, [id]));
});

r.put('/:id', async (req, res) => {
  const id = idParam(req);
  const task = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
  if (!task) throw notFound('Task');
  if (mine(req.user.role) && task.assigned_to !== req.user.id && task.created_by !== req.user.id) throw forbidden();
  const data = parse(taskBody.partial(), req.body);
  if (mine(req.user.role)) delete data.assigned_to;
  await assertLinks(req.user, data.lead_id, data.customer_id, data.assigned_to);
  const completing = data.status === 'Completed' && task.status !== 'Completed';
  await db.update('tasks', id, { ...data, completed_at: completing ? nowIso() : data.status && data.status !== 'Completed' ? null : undefined });
  if (completing && task.created_by && task.created_by !== req.user.id) {
    await notifyUsers([task.created_by], { type: 'task', title: 'Task completed', message: `${req.user.name} completed: ${task.title}`, link: '/tasks' });
  }
  if (data.assigned_to && data.assigned_to !== task.assigned_to) {
    await notifyUsers([data.assigned_to], { type: 'task', title: 'Task assigned to you', message: `${req.user.name} assigned you: ${data.title ?? task.title}`, link: '/tasks' }, req.user.id);
  }
  res.json(await db.get(`${SELECT} WHERE t.id = ?`, [id]));
});

r.delete('/:id', async (req, res) => {
  const id = idParam(req);
  const task = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
  if (!task) throw notFound('Task');
  if (mine(req.user.role) && task.created_by !== req.user.id) throw forbidden();
  await db.run('DELETE FROM tasks WHERE id = ?', [id]);
  res.json({ ok: true, id });
});

export default r;
