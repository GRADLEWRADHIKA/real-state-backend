import { Router } from 'express';
import { attendanceCheckBody, attendanceMarkBody, salaryPaymentBody, staffPayBody, zDate, zMonth } from '@estateflow/shared';
import { z } from 'zod';
import { db } from '../db/index.js';
import { adminAppReadOnly, authorize } from '../middleware/auth.js';
import { HttpError, forbidden, idParam, notFound, parse, parseQuery } from '../utils/http.js';
import { nowIso, today } from '../utils/dates.js';

/** Staff salary, attendance and sales targets. */
const r = Router();
r.use(authorize('admin', 'manager', 'sales', 'accounts'), adminAppReadOnly);

const thisMonth = () => today().slice(0, 7);
const STAFF_SQL = "SELECT id, name, title, role, monthly_salary, monthly_target FROM users WHERE status = 'Active' AND role != 'customer'";
const monthQuery = z.object({ month: zMonth.optional() });

// ─── Salary ──────────────────────────────────────────────────────────────
r.get('/salaries', authorize('admin', 'accounts'), async (req, res) => {
  const month = parseQuery(monthQuery, req).month ?? thisMonth();
  const [staff, payments] = await Promise.all([
    db.all(`${STAFF_SQL} ORDER BY name`),
    db.all('SELECT s.*, u.name AS user_name FROM salary_payments s JOIN users u ON u.id = s.user_id WHERE s.month = ? ORDER BY s.paid_on, s.id', [month]),
  ]);
  const data = staff.map((u) => {
    const mine = payments.filter((p) => p.user_id === u.id);
    const paid = mine.reduce((s, p) => s + p.amount, 0);
    return { user_id: u.id, name: u.name, title: u.title, role: u.role, monthly_salary: u.monthly_salary, paid, balance: Math.max(0, u.monthly_salary - paid), payments: mine };
  });
  const totals = data.reduce((t, d) => ({ salary: t.salary + d.monthly_salary, paid: t.paid + d.paid, balance: t.balance + d.balance }), { salary: 0, paid: 0, balance: 0 });
  res.json({ data, meta: { month, totals } });
});

r.post('/salary-payments', authorize('admin', 'accounts'), async (req, res) => {
  const data = parse(salaryPaymentBody, req.body);
  const u = await db.get("SELECT id, monthly_salary FROM users WHERE id = ? AND role != 'customer'", [data.user_id]);
  if (!u) throw new HttpError(422, 'user_id: Select a staff member');
  if (data.paid_on > today()) throw new HttpError(422, 'paid_on: cannot be in the future');
  const paid = (await db.get<{ n: number }>('SELECT COALESCE(SUM(amount), 0) AS n FROM salary_payments WHERE user_id = ? AND month = ?', [u.id, data.month]))!.n;
  if (u.monthly_salary > 0 && paid + data.amount > u.monthly_salary) throw new HttpError(422, `amount: only ₹${(u.monthly_salary - paid).toLocaleString('en-IN')} is left for ${data.month}`);
  const id = await db.insert('salary_payments', { ...data, recorded_by: req.user.id, created_at: nowIso() });
  res.status(201).json(await db.get('SELECT * FROM salary_payments WHERE id = ?', [id]));
});

r.delete('/salary-payments/:id', authorize('admin', 'accounts'), async (req, res) => {
  const id = idParam(req);
  if (!(await db.get('SELECT id FROM salary_payments WHERE id = ?', [id]))) throw notFound('Salary payment');
  await db.run('DELETE FROM salary_payments WHERE id = ?', [id]);
  res.status(204).end();
});

/** Monthly salary is set by admin or accounts; the sales target by admin or the sales manager. */
r.put('/:id/pay', async (req, res) => {
  const id = idParam(req);
  const data = parse(staffPayBody, req.body);
  const role = req.user.role;
  if (data.monthly_salary !== undefined && !['admin', 'accounts'].includes(role)) throw forbidden('Only admin or accounts can set salaries');
  if (data.monthly_target !== undefined && !['admin', 'manager'].includes(role)) throw forbidden('Only admin or the sales manager can set targets');
  if (!(await db.get("SELECT id FROM users WHERE id = ? AND role != 'customer'", [id]))) throw notFound('Staff member');
  await db.update('users', id, data);
  res.json(await db.get(`${STAFF_SQL.replace("WHERE status = 'Active' AND", 'WHERE')} AND id = ?`, [id]));
});

// ─── Targets ─────────────────────────────────────────────────────────────
r.get('/targets', async (req, res) => {
  const month = parseQuery(monthQuery, req).month ?? thisMonth();
  if (req.user.role === 'accounts') throw forbidden();
  const own = req.user.role === 'sales';
  const staff = await db.all(`${STAFF_SQL} AND role IN ('sales', 'manager')${own ? ' AND id = ?' : ''} ORDER BY name`, own ? [req.user.id] : []);
  const data = await Promise.all(
    staff.map(async (u) => {
      const sold = await db.get<{ value: number; n: number }>(
        "SELECT COALESCE(SUM(value), 0) AS value, COUNT(*) AS n FROM deals WHERE agent_id = ? AND status != 'Cancelled' AND substr(booking_date, 1, 7) = ?",
        [u.id, month],
      );
      const collected = await db.get<{ n: number }>(
        "SELECT COALESCE(SUM(t.amount), 0) AS n FROM transactions t JOIN customers c ON c.id = t.customer_id WHERE c.assigned_to = ? AND t.status = 'Completed' AND substr(t.payment_date, 1, 7) = ?",
        [u.id, month],
      );
      return { user_id: u.id, name: u.name, title: u.title, monthly_target: u.monthly_target, achieved: sold!.value, bookings: sold!.n, collected: collected!.n };
    }),
  );
  res.json({ data, meta: { month } });
});

// ─── Attendance ──────────────────────────────────────────────────────────
const ATT = 'SELECT a.*, u.name, u.title FROM attendance a JOIN users u ON u.id = a.user_id';

r.get('/attendance', authorize('admin', 'manager', 'accounts'), async (req, res) => {
  const date = parseQuery(z.object({ date: zDate.optional() }), req).date ?? today();
  const [staff, rows] = await Promise.all([db.all(`${STAFF_SQL} ORDER BY name`), db.all(`${ATT} WHERE a.date = ?`, [date])]);
  const data = staff.map((u) => rows.find((a) => a.user_id === u.id) ?? { user_id: u.id, name: u.name, title: u.title, date, status: null });
  res.json({ data, meta: { date } });
});

/** Month sheet: each staff member's days present, half days, leave and absences. */
r.get('/attendance/month', authorize('admin', 'manager', 'accounts'), async (req, res) => {
  const month = parseQuery(monthQuery, req).month ?? thisMonth();
  const staff = await db.all(`${STAFF_SQL} ORDER BY name`);
  const rows = await db.all('SELECT user_id, date, status FROM attendance WHERE substr(date, 1, 7) = ?', [month]);
  const data = staff.map((u) => {
    const mine = rows.filter((a) => a.user_id === u.id);
    const count = (s: string) => mine.filter((a) => a.status === s).length;
    return { user_id: u.id, name: u.name, title: u.title, present: count('Present'), half_day: count('Half day'), leave: count('Leave'), absent: count('Absent'), days: Object.fromEntries(mine.map((a) => [a.date, a.status])) };
  });
  res.json({ data, meta: { month } });
});

r.post('/attendance', authorize('admin', 'manager', 'accounts'), async (req, res) => {
  const data = parse(attendanceMarkBody, req.body);
  if (data.date > today()) throw new HttpError(422, 'date: cannot be in the future');
  if (!(await db.get("SELECT id FROM users WHERE id = ? AND role != 'customer'", [data.user_id]))) throw new HttpError(422, 'user_id: Select a staff member');
  await db.run(
    `INSERT INTO attendance (user_id, date, status, notes, marked_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, date) DO UPDATE SET status = excluded.status, notes = excluded.notes, marked_by = excluded.marked_by`,
    [data.user_id, data.date, data.status, data.notes ?? null, req.user.id, nowIso()],
  );
  res.json(await db.get(`${ATT} WHERE a.user_id = ? AND a.date = ?`, [data.user_id, data.date]));
});

/** Self service from the app or dashboard: today's record for the signed-in staff member. */
r.get('/attendance/me', async (req, res) => {
  res.json((await db.get(`${ATT} WHERE a.user_id = ? AND a.date = ?`, [req.user.id, today()])) ?? { user_id: req.user.id, date: today(), status: null });
});

r.post('/attendance/check-in', async (req, res) => {
  const { lat, lng } = parse(attendanceCheckBody, req.body ?? {});
  const t = today();
  const existing = await db.get('SELECT * FROM attendance WHERE user_id = ? AND date = ?', [req.user.id, t]);
  if (existing?.check_in_at) throw new HttpError(409, 'You have already checked in today');
  if (existing) await db.update('attendance', existing.id, { status: 'Present', check_in_at: nowIso(), check_in_lat: lat ?? null, check_in_lng: lng ?? null });
  else await db.insert('attendance', { user_id: req.user.id, date: t, status: 'Present', check_in_at: nowIso(), check_in_lat: lat ?? null, check_in_lng: lng ?? null, marked_by: req.user.id, created_at: nowIso() });
  res.json(await db.get(`${ATT} WHERE a.user_id = ? AND a.date = ?`, [req.user.id, t]));
});

r.post('/attendance/check-out', async (req, res) => {
  const a = await db.get('SELECT * FROM attendance WHERE user_id = ? AND date = ?', [req.user.id, today()]);
  if (!a?.check_in_at) throw new HttpError(409, 'Check in first');
  if (a.check_out_at) throw new HttpError(409, 'You have already checked out today');
  await db.update('attendance', a.id, { check_out_at: nowIso() });
  res.json(await db.get(`${ATT} WHERE a.id = ?`, [a.id]));
});

export default r;
