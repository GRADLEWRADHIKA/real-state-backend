import { Router } from 'express';
import {
  buildSchedule,
  cancelBookingBody,
  customerListQuery,
  customerNoteBody,
  customerUpdateBody,
  dealListQuery,
  dealUpdateBody,
  directBookingBody,
  inr,
  scheduleErrors,
  schedulePreviewBody,
  toCsv,
} from '@estateflow/shared';
import { db } from '../db/index.js';
import { adminAppReadOnly, authorize, dashboardOnly, isScoped, scope, type AuthUser } from '../middleware/auth.js';
import { HttpError, attachmentHeader, forbidden, idParam, likeParam, notFound, orderBy, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { nowIso, today } from '../utils/dates.js';
import { logActivity, notifyRoles, notifyUsers } from '../services/activity.js';
import { customerFinancials, syncInstallmentStatuses } from '../services/payments.js';
import { convertLead } from '../services/leads.js';
import { portalUserFor } from '../services/notifications.js';
import { realtime } from '../services/realtime.js';

const r = Router();
r.use(authorize('admin', 'manager', 'sales', 'accounts'), adminAppReadOnly);

const SELECT = `
  SELECT c.*, p.name AS property_name, p.project AS property_project, p.unit_number AS property_unit, p.type AS property_type,
    u.name AS agent_name,
    (SELECT COALESCE(SUM(i.paid_amount), 0) FROM installments i WHERE i.customer_id = c.id) AS paid,
    (SELECT COALESCE(SUM(i.amount - i.paid_amount), 0) FROM installments i WHERE i.customer_id = c.id AND i.paid_amount < i.amount AND i.due_date < ?) AS overdue,
    (SELECT MIN(i.due_date) FROM installments i WHERE i.customer_id = c.id AND i.paid_amount < i.amount) AS next_due_date
  FROM customers c
  LEFT JOIN properties p ON p.id = c.property_id
  LEFT JOIN users u ON u.id = c.assigned_to`;

const withBalance = (c: any) => ({ ...c, outstanding: c.status === 'Cancelled' ? 0 : c.total_value - c.paid });

export async function getCustomerFor(id: number, user: AuthUser) {
  const c = await db.get(`${SELECT} WHERE c.id = ?`, [today(), id]);
  if (!c) throw notFound('Customer');
  if (isScoped(user) && c.assigned_to !== user.id) throw forbidden();
  return withBalance(c);
}

r.get('/', async (req, res) => {
  const q = parseQuery(customerListQuery, req);
  const p = paging(q);
  const s = scope(req.user, 'c.assigned_to');
  let where = `WHERE 1=1${s.sql}`;
  const params: unknown[] = [...s.params];
  if (q.status) { where += ' AND c.status = ?'; params.push(q.status); }
  if (q.project) { where += ' AND p.project = ?'; params.push(q.project); }
  if (q.agent) { where += ' AND c.assigned_to = ?'; params.push(q.agent); }
  if (q.q) {
    const like = likeParam(q.q);
    where += ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.code LIKE ? OR p.unit_number LIKE ?)';
    params.push(like, like, like, like, like);
  }
  const sorts: Record<string, string> = { name: 'name', booking_date: 'booking_date', total_value: 'total_value', paid: 'paid', outstanding: '(total_value - paid)', overdue: 'overdue', next_due_date: 'next_due_date', code: 'id' };
  // paid/overdue are computed columns, so payment filters and sorting run on the derived table.
  const derivedWhere = q.payment === 'overdue' ? 'WHERE overdue > 0' : q.payment === 'clear' ? 'WHERE overdue = 0' : '';
  const sql = `SELECT * FROM (${SELECT} ${where}) x ${derivedWhere}`;
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM (${sql}) y`, [today(), ...params]))!.n;
  const data = await db.all(`${sql} ORDER BY ${orderBy(sorts, q.sort, q.order, 'booking_date')}, id DESC LIMIT ? OFFSET ?`, [today(), ...params, p.limit, p.offset]);
  const totals = await db.get(
    `SELECT COUNT(*) AS customers, COALESCE(SUM(total_value), 0) AS value, COALESCE(SUM(paid), 0) AS paid, COALESCE(SUM(overdue), 0) AS overdue
     FROM (${SELECT} WHERE c.status != 'Cancelled'${s.sql}) t`,
    [today(), ...s.params],
  );
  res.json({ data: data.map(withBalance), meta: pageMeta(total, p, { totals: { ...totals, outstanding: totals.value - totals.paid } }) });
});

/** Booking without a lead (walk-in or broker deal): creates customer + deal + schedule in one transaction. */
r.post('/', authorize('admin', 'manager', 'sales'), async (req, res) => {
  const body = parse(directBookingBody, req.body);
  const err = scheduleErrors(body);
  if (err) throw new HttpError(422, err);
  const existing = await db.get("SELECT code, name FROM customers WHERE status != 'Cancelled' AND phone = ?", [body.phone]);
  if (existing) throw new HttpError(409, `${existing.name} (${existing.code}) already has a booking with this phone number`);
  const id = await convertLead(null, { ...body, assigned_to: req.user.role === 'sales' ? req.user.id : body.assigned_to }, req.user);
  res.status(201).json(await getCustomerFor(id, req.user));
});

r.post('/schedule-preview', async (req, res) => {
  const body = parse(schedulePreviewBody, req.body);
  const err = scheduleErrors(body);
  if (err) throw new HttpError(422, err);
  const rows = buildSchedule(body);
  res.json({ data: rows, meta: { total: rows.reduce((s, x) => s + x.amount, 0) } });
});

r.get('/:id', async (req, res) => {
  await syncInstallmentStatuses();
  const c = await getCustomerFor(idParam(req), req.user);
  const [property, deal, installments, transactions, documents, activities, lead, portalUser, financials, requests] = await Promise.all([
    c.property_id ? db.get('SELECT * FROM properties WHERE id = ?', [c.property_id]) : null,
    db.get('SELECT d.*, u.name AS agent_name FROM deals d LEFT JOIN users u ON u.id = d.agent_id WHERE d.customer_id = ? ORDER BY d.id DESC LIMIT 1', [c.id]),
    db.all('SELECT *, amount - paid_amount AS balance FROM installments WHERE customer_id = ? ORDER BY number', [c.id]),
    db.all(
      `SELECT t.*, i.label AS installment_label, i.number AS installment_number, u.name AS recorded_by_name
       FROM transactions t LEFT JOIN installments i ON i.id = t.installment_id LEFT JOIN users u ON u.id = t.recorded_by
       WHERE t.customer_id = ? ORDER BY t.payment_date DESC, t.id DESC`,
      [c.id],
    ),
    db.all("SELECT d.*, u.name AS uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.entity_type = 'customer' AND d.entity_id = ? ORDER BY d.created_at DESC", [c.id]),
    db.all(
      `SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.type != 'audit' AND (a.customer_id = ? OR (a.lead_id = ? AND a.lead_id IS NOT NULL)) ORDER BY a.created_at DESC, a.id DESC LIMIT 80`,
      [c.id, c.lead_id],
    ),
    c.lead_id ? db.get('SELECT id, code, source, created_at FROM leads WHERE id = ?', [c.lead_id]) : null,
    db.get("SELECT id, email, last_login, status FROM users WHERE customer_id = ? AND role = 'customer'", [c.id]),
    customerFinancials(c.id),
    db.all('SELECT r.*, u.name AS handled_by_name FROM customer_requests r LEFT JOIN users u ON u.id = r.handled_by WHERE r.customer_id = ? ORDER BY r.created_at DESC', [c.id]),
  ]);
  if (property?.amenities) property.amenities = JSON.parse(property.amenities);
  res.json({ ...c, property, deal, installments, transactions, documents, activities, lead, portalUser, financials, requests });
});

/** Statement of account: every installment and payment in date order with a running balance. */
async function ledger(customerId: number) {
  const c = await db.get('SELECT id, code, name, total_value FROM customers WHERE id = ?', [customerId]);
  const inst = await db.all('SELECT number, label, due_date, amount FROM installments WHERE customer_id = ? ORDER BY due_date, number', [customerId]);
  const txns = await db.all(
    `SELECT t.id, t.code, t.receipt_number, t.payment_date, t.amount, t.method, t.reference, t.status, i.label AS installment_label
     FROM transactions t LEFT JOIN installments i ON i.id = t.installment_id WHERE t.customer_id = ? ORDER BY t.payment_date, t.id`,
    [customerId],
  );
  type Entry = { date: string; kind: 'due' | 'payment'; description: string; debit: number; credit: number; status?: string; reference?: string | null; transaction_id?: number; balance?: number };
  const entries: Entry[] = [
    ...inst.map((i) => ({ date: i.due_date, kind: 'due' as const, description: `${i.label} due`, debit: i.amount, credit: 0 })),
    ...txns.map((t) => ({
      date: t.payment_date,
      kind: 'payment' as const,
      description: `${t.receipt_number ?? t.code} · ${t.method}${t.installment_label ? ` · ${t.installment_label}` : ''}`,
      debit: 0,
      credit: t.status === 'Completed' ? t.amount : 0,
      status: t.status,
      reference: t.reference,
      transaction_id: t.id,
    })),
  ].sort((a, b) => (a.date === b.date ? (a.kind === 'due' ? -1 : 1) : a.date < b.date ? -1 : 1));
  let bal = 0;
  for (const e of entries) {
    bal += e.debit - e.credit;
    e.balance = bal;
  }
  return { customer: c, entries, totals: { billed: inst.reduce((s, i) => s + i.amount, 0), received: entries.reduce((s, e) => s + e.credit, 0), balance: bal } };
}

r.get('/:id/ledger', async (req, res) => {
  const c = await getCustomerFor(idParam(req), req.user);
  res.json(await ledger(c.id));
});

r.get('/:id/ledger.csv', async (req, res) => {
  const c = await getCustomerFor(idParam(req), req.user);
  const l = await ledger(c.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', attachmentHeader(`ledger-${c.code}.csv`));
  res.send(
    toCsv(l.entries, [
      { key: 'date', label: 'Date' },
      { key: 'description', label: 'Description' },
      { key: 'status', label: 'Status' },
      { key: 'reference', label: 'Reference' },
      { key: 'debit', label: 'Due (INR)' },
      { key: 'credit', label: 'Received (INR)' },
      { key: 'balance', label: 'Balance (INR)' },
    ]),
  );
});

r.put('/:id', async (req, res) => {
  const c = await getCustomerFor(idParam(req), req.user);
  const data = parse(customerUpdateBody, req.body);
  if (data.pan) data.pan = data.pan.toUpperCase();
  if (req.user.role === 'sales' || req.user.role === 'accounts') delete data.assigned_to;
  if (data.assigned_to && !(await db.get("SELECT id FROM users WHERE id = ? AND status = 'Active' AND role IN ('sales','manager','admin')", [data.assigned_to]))) {
    throw new HttpError(422, 'assigned_to: Select an active sales team member');
  }
  await db.update('customers', c.id, { ...data, updated_at: nowIso() });
  if (data.assigned_to && data.assigned_to !== c.assigned_to) {
    await db.run('UPDATE deals SET agent_id = ? WHERE customer_id = ?', [data.assigned_to, c.id]);
    await notifyUsers([data.assigned_to], { type: 'customer', title: 'Customer assigned to you', message: `${c.name} (${c.code}) is now yours.`, link: `/customers/${c.id}` }, req.user.id);
  }
  await logActivity({ customer_id: c.id, type: 'updated', title: 'Customer profile updated', user_id: req.user.id });
  res.json(await getCustomerFor(c.id, req.user));
});

/** Cancels a booking: unit returns to inventory, open installments are removed, payments stay on record. */
r.post('/:id/cancel', authorize('admin', 'manager'), dashboardOnly, async (req, res) => {
  const c = await getCustomerFor(idParam(req), req.user);
  const { reason } = parse(cancelBookingBody, req.body);
  if (c.status === 'Cancelled') throw new HttpError(409, 'This booking is already cancelled');
  await db.transaction(async () => {
    const now = nowIso();
    await db.update('customers', c.id, { status: 'Cancelled', cancelled_at: now, cancel_reason: reason, updated_at: now });
    await db.run("UPDATE deals SET status = 'Cancelled', closed_at = ? WHERE customer_id = ? AND status != 'Cancelled'", [now, c.id]);
    await db.run('DELETE FROM installments WHERE customer_id = ? AND paid_amount = 0', [c.id]);
    if (c.property_id) await db.update('properties', c.property_id, { status: 'Available', updated_at: now });
    if (c.lead_id) await db.update('leads', c.lead_id, { status: 'Lost', lost_reason: `Booking cancelled: ${reason}`, updated_at: now });
    await logActivity({ customer_id: c.id, lead_id: c.lead_id, property_id: c.property_id, type: 'cancelled', title: 'Booking cancelled', description: `${reason}. Payments received so far: ${inr(c.paid)}.`, user_id: req.user.id });
  });
  await notifyRoles(['admin', 'manager', 'accounts'], { type: 'alert', title: 'Booking cancelled', message: `${c.name} · ${c.property_project ?? ''} ${c.property_unit ?? ''} — ${reason}`, link: `/customers/${c.id}` }, req.user.id);
  const portal = await portalUserFor(c.id);
  if (portal) realtime.change(['portal'], { userIds: [portal.id] });
  res.json(await getCustomerFor(c.id, req.user));
});

r.post('/:id/notes', async (req, res) => {
  const c = await getCustomerFor(idParam(req), req.user);
  const { note, channel } = parse(customerNoteBody, req.body);
  const titles = { note: 'Note added', call: 'Call logged', whatsapp: 'WhatsApp message sent', sms: 'SMS sent', email: 'Email sent', meeting: 'Meeting held' };
  const id = await logActivity({ customer_id: c.id, lead_id: c.lead_id, type: channel, title: titles[channel], description: note, user_id: req.user.id });
  res.status(201).json({ ok: true, id });
});

// ─── Deals ────────────────────────────────────────────────────────────────
export const dealsRouter = Router();
dealsRouter.use(authorize('admin', 'manager', 'sales', 'accounts'), adminAppReadOnly);

const DEAL_SELECT = `
  SELECT d.*, c.name AS customer_name, c.code AS customer_code, c.phone AS customer_phone, p.project AS property_project, p.unit_number AS property_unit, p.type AS property_type,
    u.name AS agent_name, (SELECT COALESCE(SUM(i.paid_amount), 0) FROM installments i WHERE i.customer_id = d.customer_id) AS paid
  FROM deals d JOIN customers c ON c.id = d.customer_id LEFT JOIN properties p ON p.id = d.property_id LEFT JOIN users u ON u.id = d.agent_id`;

dealsRouter.get('/', async (req, res) => {
  const q = parseQuery(dealListQuery, req);
  const p = paging(q, 50);
  const s = scope(req.user, 'd.agent_id');
  const params: unknown[] = [...s.params];
  let where = `WHERE 1=1${s.sql}`;
  if (q.stage) { where += ' AND d.stage = ?'; params.push(q.stage); }
  if (q.status) { where += ' AND d.status = ?'; params.push(q.status); }
  if (q.agent) { where += ' AND d.agent_id = ?'; params.push(q.agent); }
  if (q.q) { const like = likeParam(q.q); where += ' AND (c.name LIKE ? OR d.code LIKE ? OR p.project LIKE ? OR p.unit_number LIKE ?)'; params.push(like, like, like, like); }
  const from = 'FROM deals d JOIN customers c ON c.id = d.customer_id LEFT JOIN properties p ON p.id = d.property_id';
  const agg = await db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(d.value), 0) AS value ${from} ${where}`, params);
  const stages = await db.all(`SELECT d.stage, COUNT(*) AS n, COALESCE(SUM(d.value), 0) AS value ${from} ${where} GROUP BY d.stage`, params);
  const sorts = { booking_date: 'd.booking_date', value: 'd.value', customer: 'c.name', stage: 'd.stage' };
  const data = await db.all(`${DEAL_SELECT} ${where} ORDER BY ${orderBy(sorts, q.sort, q.order, 'd.booking_date')}, d.id DESC LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  res.json({ data, meta: pageMeta(agg.n, p, { value: agg.value, stages }) });
});

dealsRouter.get('/:id', async (req, res) => {
  const deal = await db.get(`${DEAL_SELECT} WHERE d.id = ?`, [idParam(req)]);
  if (!deal) throw notFound('Deal');
  if (isScoped(req.user) && deal.agent_id !== req.user.id) throw forbidden();
  const [installments, activities, documents] = await Promise.all([
    db.all('SELECT *, amount - paid_amount AS balance FROM installments WHERE deal_id = ? ORDER BY number', [deal.id]),
    db.all("SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.customer_id = ? AND a.type IN ('deal','conversion','payment','cancelled') ORDER BY a.created_at DESC LIMIT 40", [deal.customer_id]),
    db.all("SELECT * FROM documents WHERE entity_type = 'deal' AND entity_id = ? ORDER BY created_at DESC", [deal.id]),
  ]);
  res.json({ ...deal, installments, activities, documents });
});

dealsRouter.patch('/:id', authorize('admin', 'manager', 'sales'), async (req, res) => {
  const id = idParam(req);
  const deal = await db.get('SELECT d.*, c.lead_id, c.name AS customer_name FROM deals d JOIN customers c ON c.id = d.customer_id WHERE d.id = ?', [id]);
  if (!deal) throw notFound('Deal');
  if (isScoped(req.user) && deal.agent_id !== req.user.id) throw forbidden();
  if (deal.status === 'Cancelled') throw new HttpError(409, 'This deal was cancelled');
  const data = parse(dealUpdateBody, req.body);
  const closing = data.stage === 'Possession' && deal.stage !== 'Possession';
  await db.update('deals', id, { ...data, status: closing ? 'Won' : undefined, closed_at: closing ? nowIso() : undefined });
  if (data.stage && data.stage !== deal.stage) {
    await logActivity({ customer_id: deal.customer_id, lead_id: deal.lead_id, type: 'deal', title: `Deal moved to ${data.stage}`, description: `${deal.code}`, user_id: req.user.id });
    if (closing && deal.lead_id) await db.update('leads', deal.lead_id, { status: 'Closed', updated_at: nowIso() });
    const portal = await portalUserFor(deal.customer_id);
    if (portal) {
      await notifyUsers([portal.id], { type: 'deal', title: `Your booking moved to ${data.stage}`, message: `${deal.code} is now at the "${data.stage}" stage.`, link: '/' });
      realtime.change(['portal'], { userIds: [portal.id] });
    }
  }
  res.json(await db.get(`${DEAL_SELECT} WHERE d.id = ?`, [id]));
});

export default r;
