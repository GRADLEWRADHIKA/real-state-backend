import { Router } from 'express';
import { inr, listQuery, refundBody } from '@estateflow/shared';
import { db } from '../db/index.js';
import { authorize } from '../middleware/auth.js';
import { HttpError, attachmentHeader, idParam, notFound, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { financialYear, nowIso, today } from '../utils/dates.js';
import { logActivity, notifyRoles } from '../services/activity.js';
import { getSettings } from '../services/settings.js';
import { refundPdf } from '../services/pdf.js';

/**
 * Refunds on cancelled bookings: what the buyer paid, the deduction kept (with its reason) and the
 * amount returned, each with its own refund receipt number (RF/<FY>/NNNN, counted per financial year).
 */
const r = Router();
r.use(authorize('admin', 'manager', 'accounts'));

const SELECT = `
  SELECT f.*, c.name AS customer_name, c.code AS customer_code, p.project AS property_project, p.unit_number AS property_unit, u.name AS created_by_name
  FROM refunds f JOIN customers c ON c.id = f.customer_id LEFT JOIN properties p ON p.id = c.property_id LEFT JOIN users u ON u.id = f.created_by`;

async function nextRefundNumber() {
  const fy = financialYear();
  const key = `RF-${fy.label}`;
  await db.run('INSERT INTO receipt_sequences (fy, last_number) VALUES (?, 1) ON CONFLICT(fy) DO UPDATE SET last_number = last_number + 1', [key]);
  const n = (await db.get<{ last_number: number }>('SELECT last_number FROM receipt_sequences WHERE fy = ?', [key]))!.last_number;
  return `RF/${fy.label}/${String(n).padStart(4, '0')}`;
}

/** Money the buyer has paid on a booking that is not yet refunded. */
export async function refundable(customerId: number) {
  const paid = (await db.get<{ n: number }>("SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE customer_id = ? AND status = 'Completed'", [customerId]))!.n;
  const refunded = (await db.get<{ n: number }>('SELECT COALESCE(SUM(refund_amount + deduction), 0) AS n FROM refunds WHERE customer_id = ?', [customerId]))!.n;
  return { paid, settled: refunded, open: Math.max(0, paid - refunded) };
}

r.get('/', async (req, res) => {
  const q = parseQuery(listQuery, req);
  const p = paging(q, 100);
  const total = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM refunds'))!.n;
  const data = await db.all(`${SELECT} ORDER BY f.refund_date DESC, f.id DESC LIMIT ? OFFSET ?`, [p.limit, p.offset]);
  const totals = await db.get('SELECT COALESCE(SUM(refund_amount), 0) AS refunded, COALESCE(SUM(deduction), 0) AS deducted FROM refunds');
  // Cancelled bookings with money still to settle: the accountant's queue.
  const pending = await db.all(
    `SELECT c.id, c.code, c.name, c.cancelled_at, c.cancel_reason, p.project AS property_project, p.unit_number AS property_unit,
       (SELECT COALESCE(SUM(amount), 0) FROM transactions t WHERE t.customer_id = c.id AND t.status = 'Completed') AS paid,
       (SELECT COALESCE(SUM(refund_amount + deduction), 0) FROM refunds f WHERE f.customer_id = c.id) AS settled
     FROM customers c LEFT JOIN properties p ON p.id = c.property_id WHERE c.status = 'Cancelled' ORDER BY c.cancelled_at DESC`,
  );
  res.json({ data, meta: pageMeta(total, p, { totals, pending: pending.filter((x) => x.paid > x.settled).map((x) => ({ ...x, open: x.paid - x.settled })) }) });
});

r.get('/customer/:id', async (req, res) => {
  const id = idParam(req);
  const c = await db.get('SELECT id, status FROM customers WHERE id = ?', [id]);
  if (!c) throw notFound('Customer');
  res.json({ data: await db.all(`${SELECT} WHERE f.customer_id = ? ORDER BY f.refund_date DESC, f.id DESC`, [id]), meta: await refundable(id) });
});

r.post('/customer/:id', authorize('admin', 'accounts'), async (req, res) => {
  const id = idParam(req);
  const data = parse(refundBody, req.body);
  const c = await db.get('SELECT id, name, code, status, lead_id, property_id FROM customers WHERE id = ?', [id]);
  if (!c) throw notFound('Customer');
  if (c.status !== 'Cancelled') throw new HttpError(409, 'Refunds are recorded only on cancelled bookings. Cancel the booking first.');
  if (data.refund_date > today()) throw new HttpError(422, 'refund_date: cannot be in the future');
  const money = await refundable(id);
  if (money.open <= 0) throw new HttpError(409, 'Nothing is left to refund on this booking');
  if (data.deduction > money.open) throw new HttpError(422, `deduction: cannot be more than ${inr(money.open)}`);
  if (data.deduction > 0 && !data.deduction_reason) throw new HttpError(422, 'deduction_reason: say why the deduction is kept');
  const refundAmount = money.open - data.deduction;
  const refundId = await db.transaction(async () => {
    const rid = await db.insert('refunds', {
      customer_id: id,
      receipt_number: await nextRefundNumber(),
      paid_total: money.open,
      deduction: data.deduction,
      deduction_reason: data.deduction_reason ?? null,
      refund_amount: refundAmount,
      method: data.method,
      reference: data.reference ?? null,
      refund_date: data.refund_date,
      notes: data.notes ?? null,
      created_by: req.user.id,
      created_at: nowIso(),
    });
    await logActivity({ customer_id: id, lead_id: c.lead_id, type: 'refund', title: 'Refund paid', description: `${inr(refundAmount)} via ${data.method}${data.deduction ? `, ${inr(data.deduction)} deducted (${data.deduction_reason})` : ''}`, user_id: req.user.id });
    return rid;
  });
  await notifyRoles(['admin', 'accounts'], { type: 'payment', title: 'Refund recorded', message: `${inr(refundAmount)} refunded to ${c.name} (${c.code}).`, link: `/customers/${id}` }, req.user.id);
  res.status(201).json(await db.get(`${SELECT} WHERE f.id = ?`, [refundId]));
});

r.get('/:id/receipt.pdf', async (req, res) => {
  const f = await db.get(`${SELECT} WHERE f.id = ?`, [idParam(req)]);
  if (!f) throw notFound('Refund');
  const c = await db.get('SELECT name, code, phone, address, cancelled_at, cancel_reason FROM customers WHERE id = ?', [f.customer_id]);
  const company = (await getSettings()).company;
  const pdf = refundPdf({
    receipt_number: f.receipt_number,
    refund_date: f.refund_date,
    customer: c,
    property: f.property_project ? `${f.property_project} ${f.property_unit ?? ''}` : null,
    cancelled_at: c.cancelled_at,
    cancel_reason: c.cancel_reason,
    paid_total: f.paid_total,
    deduction: f.deduction,
    deduction_reason: f.deduction_reason,
    refund_amount: f.refund_amount,
    method: f.method,
    reference: f.reference,
    company,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', attachmentHeader(`${String(f.receipt_number).replace(/\//g, '-')}.pdf`));
  res.send(pdf);
});

export default r;
