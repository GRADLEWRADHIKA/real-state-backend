import { Router } from 'express';
import { brokerBody, commissionPayBody, inr, listQuery } from '@estateflow/shared';
import { z } from 'zod';
import { db } from '../db/index.js';
import { adminAppReadOnly, authorize } from '../middleware/auth.js';
import { HttpError, idParam, likeParam, notFound, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { nowIso, today } from '../utils/dates.js';
import { logActivity } from '../services/activity.js';

const r = Router();
r.use(authorize('admin', 'manager', 'sales', 'accounts'), adminAppReadOnly);

const SELECT = `
  SELECT b.*,
    (SELECT COUNT(*) FROM customers c WHERE c.broker_id = b.id AND c.status != 'Cancelled') AS customers_count,
    (SELECT COALESCE(SUM(amount), 0) FROM broker_commissions bc WHERE bc.broker_id = b.id AND bc.status = 'Due') AS commission_due,
    (SELECT COALESCE(SUM(amount), 0) FROM broker_commissions bc WHERE bc.broker_id = b.id AND bc.status = 'Paid') AS commission_paid
  FROM brokers b`;

const COMMISSIONS = `
  SELECT bc.*, b.name AS broker_name, c.name AS customer_name, c.code AS customer_code, t.receipt_number, t.payment_date
  FROM broker_commissions bc
  JOIN brokers b ON b.id = bc.broker_id
  JOIN customers c ON c.id = bc.customer_id
  JOIN transactions t ON t.id = bc.transaction_id`;

const brokerList = listQuery.extend({ status: z.enum(['Active', 'Inactive']).optional().or(z.literal('').transform(() => undefined)) });

/** Everyone on staff can pick a broker on a customer; money columns are for admin, manager and accounts. */
r.get('/', async (req, res) => {
  const q = parseQuery(brokerList, req);
  const p = paging(q, 100);
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (q.status) { where += ' AND b.status = ?'; params.push(q.status); }
  if (q.q) { const like = likeParam(q.q); where += ' AND (b.name LIKE ? OR b.firm LIKE ? OR b.phone LIKE ?)'; params.push(like, like, like); }
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM brokers b ${where}`, params))!.n;
  let data = await db.all(`${SELECT} ${where} ORDER BY b.status, b.name LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  if (req.user.role === 'sales') data = data.map(({ commission_due: _d, commission_paid: _p, ...b }) => b);
  res.json({ data, meta: pageMeta(total, p) });
});

const money = authorize('admin', 'manager', 'accounts');

r.get('/commissions', money, async (req, res) => {
  const q = parseQuery(listQuery.extend({ status: z.enum(['Due', 'Paid']).optional().or(z.literal('').transform(() => undefined)), broker: z.coerce.number().int().positive().optional() }), req);
  const p = paging(q, 100);
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (q.status) { where += ' AND bc.status = ?'; params.push(q.status); }
  if (q.broker) { where += ' AND bc.broker_id = ?'; params.push(q.broker); }
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM broker_commissions bc ${where}`, params))!.n;
  const data = await db.all(`${COMMISSIONS} ${where} ORDER BY CASE bc.status WHEN 'Due' THEN 0 ELSE 1 END, t.payment_date DESC, bc.id DESC LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  const totals = await db.get("SELECT COALESCE(SUM(CASE WHEN status = 'Due' THEN amount END), 0) AS due, COALESCE(SUM(CASE WHEN status = 'Paid' THEN amount END), 0) AS paid FROM broker_commissions");
  res.json({ data, meta: pageMeta(total, p, { totals }) });
});

r.post('/commissions/:id/pay', authorize('admin', 'accounts'), async (req, res) => {
  const data = parse(commissionPayBody, req.body);
  const c = await db.get(`${COMMISSIONS} WHERE bc.id = ?`, [idParam(req)]);
  if (!c) throw notFound('Commission');
  if (c.status === 'Paid') throw new HttpError(409, 'This commission is already paid');
  if (data.paid_on > today()) throw new HttpError(422, 'paid_on: cannot be in the future');
  await db.update('broker_commissions', c.id, { status: 'Paid', paid_on: data.paid_on, paid_method: data.method });
  await logActivity({ customer_id: c.customer_id, type: 'payment', title: 'Broker commission paid', description: `${inr(c.amount)} to ${c.broker_name} via ${data.method}`, user_id: req.user.id });
  res.json(await db.get(`${COMMISSIONS} WHERE bc.id = ?`, [c.id]));
});

r.get('/:id', money, async (req, res) => {
  const b = await db.get(`${SELECT} WHERE b.id = ?`, [idParam(req)]);
  if (!b) throw notFound('Broker');
  const [customers, commissions] = await Promise.all([
    db.all('SELECT c.id, c.code, c.name, c.booking_date, c.total_value, c.status FROM customers c WHERE c.broker_id = ? ORDER BY c.booking_date DESC', [b.id]),
    db.all(`${COMMISSIONS} WHERE bc.broker_id = ? ORDER BY t.payment_date DESC, bc.id DESC`, [b.id]),
  ]);
  res.json({ ...b, customers, commissions });
});

r.post('/', authorize('admin', 'manager'), async (req, res) => {
  const data = parse(brokerBody, req.body);
  const id = await db.insert('brokers', { ...data, created_at: nowIso() });
  res.status(201).json(await db.get(`${SELECT} WHERE b.id = ?`, [id]));
});

r.put('/:id', authorize('admin', 'manager'), async (req, res) => {
  const id = idParam(req);
  if (!(await db.get('SELECT id FROM brokers WHERE id = ?', [id]))) throw notFound('Broker');
  const data = parse(brokerBody.partial(), req.body);
  // A new rate applies to payments from now on; commission already worked out keeps its rate.
  await db.update('brokers', id, data);
  res.json(await db.get(`${SELECT} WHERE b.id = ?`, [id]));
});

export default r;
