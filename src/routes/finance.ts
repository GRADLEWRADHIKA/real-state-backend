import { Router } from 'express';
import { installmentListQuery, paymentBody, transactionBody, transactionListQuery, transactionStatusBody, type ReceiptData } from '@estateflow/shared';
import { db } from '../db/index.js';
import { adminAppReadOnly, authorize, type AuthUser } from '../middleware/auth.js';
import { HttpError, attachmentHeader, forbidden, idParam, likeParam, notFound, orderBy, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { addDays, lastMonths, today } from '../utils/dates.js';
import { recordPayment, setTransactionStatus, syncInstallmentStatuses } from '../services/payments.js';
import { getSettings } from '../services/settings.js';
import { receiptFileName, receiptPdf } from '../services/pdf.js';

const finance = [authorize('admin', 'accounts'), adminAppReadOnly];

// ─── Summary ─────────────────────────────────────────────────────────────
export const financeRouter = Router();
financeRouter.use(finance);

export async function financeSummary() {
  await syncInstallmentStatuses();
  const t = today();
  const month = t.slice(0, 7);
  const prevMonth = lastMonths(2)[0];
  const m = db.dialect.month('payment_date');
  const totals = await db.get(
    `SELECT
       (SELECT COALESCE(SUM(total_value), 0) FROM customers WHERE status != 'Cancelled') AS total_sales,
       COALESCE(SUM(paid_amount), 0) AS collected,
       COALESCE(SUM(CASE WHEN paid_amount < amount AND due_date >= ? THEN amount - paid_amount END), 0) AS pending,
       COALESCE(SUM(CASE WHEN paid_amount < amount AND due_date < ? THEN amount - paid_amount END), 0) AS overdue,
       COALESCE(SUM(CASE WHEN paid_amount < amount AND due_date BETWEEN ? AND ? THEN amount - paid_amount END), 0) AS upcoming_30,
       COALESCE(SUM(CASE WHEN paid_amount < amount AND due_date < ? THEN 1 ELSE 0 END), 0) AS overdue_count
     FROM installments`,
    [t, t, t, addDays(t, 30), t],
  );
  const monthRows = await db.all(
    `SELECT ${m} AS month, SUM(amount) AS amount, COUNT(*) AS count FROM transactions
     WHERE status = 'Completed' AND payment_date >= ? GROUP BY ${m}`,
    [`${lastMonths(12)[0]}-01`],
  );
  const byMonth = Object.fromEntries(monthRows.map((r) => [r.month, r]));
  const monthly = lastMonths(12).map((k) => ({ month: k, amount: byMonth[k]?.amount ?? 0, count: byMonth[k]?.count ?? 0 }));
  const methods = await db.all(
    "SELECT method, SUM(amount) AS amount, COUNT(*) AS count FROM transactions WHERE status = 'Completed' GROUP BY method ORDER BY amount DESC",
  );
  const lastMonthToDate = await db.get<{ n: number }>(
    "SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE status = 'Completed' AND payment_date BETWEEN ? AND ?",
    [`${prevMonth}-01`, `${prevMonth}-${t.slice(8, 10)}`],
  );
  const pendingClearance = await db.get("SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM transactions WHERE status = 'Pending'");
  const instSelect = `
    SELECT i.*, i.amount - i.paid_amount AS balance, c.name AS customer_name, c.code AS customer_code, c.phone AS customer_phone,
           p.project AS property_project, p.unit_number AS property_unit
    FROM installments i JOIN customers c ON c.id = i.customer_id LEFT JOIN properties p ON p.id = c.property_id`;
  const [upcoming, overdueList, recent] = await Promise.all([
    db.all(`${instSelect} WHERE i.paid_amount < i.amount AND i.due_date BETWEEN ? AND ? ORDER BY i.due_date LIMIT 8`, [t, addDays(t, 45)]),
    db.all(`${instSelect} WHERE i.paid_amount < i.amount AND i.due_date < ? ORDER BY i.due_date LIMIT 8`, [t]),
    db.all(
      `SELECT t.*, c.name AS customer_name, p.project AS property_project, p.unit_number AS property_unit
       FROM transactions t JOIN customers c ON c.id = t.customer_id LEFT JOIN properties p ON p.id = t.property_id
       ORDER BY t.payment_date DESC, t.id DESC LIMIT 8`,
    ),
  ]);
  return {
    ...totals,
    outstanding: totals.total_sales - totals.collected,
    this_month: byMonth[month]?.amount ?? 0,
    last_month: byMonth[prevMonth]?.amount ?? 0,
    last_month_to_date: lastMonthToDate!.n,
    monthly,
    methods,
    pending_clearance: pendingClearance,
    upcoming,
    overdue_list: overdueList,
    recent,
  };
}

financeRouter.get('/summary', async (_req, res) => {
  res.json(await financeSummary());
});

// ─── Transactions ────────────────────────────────────────────────────────
export const transactionsRouter = Router();

const TXN_SELECT = `
  SELECT t.*, c.name AS customer_name, c.code AS customer_code, c.phone AS customer_phone, c.email AS customer_email,
         p.project AS property_project, p.unit_number AS property_unit, p.name AS property_name,
         p.location AS property_location, p.city AS property_city,
         i.label AS installment_label, i.number AS installment_number, u.name AS recorded_by_name
  FROM transactions t
  JOIN customers c ON c.id = t.customer_id
  LEFT JOIN properties p ON p.id = t.property_id
  LEFT JOIN installments i ON i.id = t.installment_id
  LEFT JOIN users u ON u.id = t.recorded_by`;

transactionsRouter.get('/', ...finance, async (req, res) => {
  const q = parseQuery(transactionListQuery, req);
  const p = paging(q);
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (q.method) { where += ' AND t.method = ?'; params.push(q.method); }
  if (q.status) { where += ' AND t.status = ?'; params.push(q.status); }
  if (q.type) { where += ' AND t.type = ?'; params.push(q.type); }
  if (q.customer) { where += ' AND t.customer_id = ?'; params.push(q.customer); }
  if (q.from) { where += ' AND t.payment_date >= ?'; params.push(q.from); }
  if (q.to) { where += ' AND t.payment_date <= ?'; params.push(q.to); }
  if (q.q) {
    where += ' AND (t.code LIKE ? OR t.reference LIKE ? OR c.name LIKE ? OR t.receipt_number LIKE ? OR p.unit_number LIKE ?)';
    const like = likeParam(q.q);
    params.push(like, like, like, like, like);
  }
  const sorts: Record<string, string> = { payment_date: 't.payment_date', amount: 't.amount', customer: 'c.name' };
  const agg = await db.get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN t.status = 'Completed' THEN t.amount END), 0) AS completed,
       COALESCE(SUM(CASE WHEN t.status = 'Pending' THEN t.amount END), 0) AS pending,
       COALESCE(SUM(CASE WHEN t.status = 'Failed' THEN t.amount END), 0) AS failed
     FROM transactions t JOIN customers c ON c.id = t.customer_id LEFT JOIN properties p ON p.id = t.property_id ${where}`,
    params,
  );
  const data = await db.all(`${TXN_SELECT} ${where} ORDER BY ${orderBy(sorts, q.sort, q.order, 't.payment_date')}, t.id DESC LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  res.json({ data, meta: pageMeta(agg.n, p, { totals: { completed: agg.completed, pending: agg.pending, failed: agg.failed } }) });
});

/** Full receipt payload; customers may only open their own receipts. */
export async function receiptFor(id: number, user: AuthUser): Promise<ReceiptData> {
  const t = await db.get(TXN_SELECT + ' WHERE t.id = ?', [id]);
  if (!t) throw notFound('Transaction');
  if (user.role === 'customer' && t.customer_id !== user.customer_id) throw forbidden();
  if (!['admin', 'accounts', 'customer', 'manager', 'sales'].includes(user.role)) throw forbidden();
  const customer = await db.get('SELECT id, code, name, phone, email, address, city, total_value, assigned_to FROM customers WHERE id = ?', [t.customer_id]);
  if (user.role === 'sales' && customer.assigned_to !== user.id) throw forbidden();
  // Balance immediately after this payment (completed payments up to and including this one).
  const paidUpTo = await db.get<{ n: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS n FROM transactions
     WHERE customer_id = ? AND status = 'Completed' AND (payment_date < ? OR (payment_date = ? AND id <= ?))`,
    [t.customer_id, t.payment_date, t.payment_date, t.id],
  );
  const settings = await getSettings();
  return {
    ...t,
    customer,
    company: settings.company,
    paid_to_date: paidUpTo!.n,
    outstanding_after: customer.total_value - paidUpTo!.n,
  };
}

transactionsRouter.get('/:id', async (req, res) => {
  res.json(await receiptFor(idParam(req), req.user));
});

/** Receipt PDF (generated on the server so every client shares the same document). */
transactionsRouter.get('/:id/receipt.pdf', async (req, res) => {
  const r = await receiptFor(idParam(req), req.user);
  if (r.status === 'Failed') throw new HttpError(409, 'No receipt is issued for a failed payment');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', attachmentHeader(receiptFileName(r)));
  res.send(receiptPdf(r));
});

transactionsRouter.post('/', ...finance, async (req, res) => {
  const data = parse(transactionBody, req.body);
  let installmentId = data.installment_id;
  if (installmentId) {
    const inst = await db.get('SELECT customer_id FROM installments WHERE id = ?', [installmentId]);
    if (!inst || inst.customer_id !== data.customer_id) throw new HttpError(422, 'installment_id: Installment does not belong to this customer');
  } else {
    const next = await db.get('SELECT id FROM installments WHERE customer_id = ? AND paid_amount < amount ORDER BY due_date, number LIMIT 1', [data.customer_id]);
    if (!next) throw new HttpError(422, 'This customer has no outstanding installments');
    installmentId = next.id;
  }
  const id = await recordPayment({ ...data, installment_id: installmentId! }, req.user);
  res.status(201).json(await receiptFor(id, req.user));
});

transactionsRouter.patch('/:id/status', ...finance, async (req, res) => {
  const id = idParam(req);
  const { status } = parse(transactionStatusBody, req.body);
  await setTransactionStatus(id, status, req.user);
  res.json(await receiptFor(id, req.user));
});

// ─── Installments ────────────────────────────────────────────────────────
export const installmentsRouter = Router();
installmentsRouter.use(finance);

installmentsRouter.get('/', async (req, res) => {
  await syncInstallmentStatuses();
  const q = parseQuery(installmentListQuery, req);
  const p = paging(q, 50);
  const t = today();
  let where = "WHERE c.status != 'Cancelled'";
  const params: unknown[] = [];
  if (q.status) { where += ' AND i.status = ?'; params.push(q.status); }
  if (q.customer) { where += ' AND i.customer_id = ?'; params.push(q.customer); }
  if (q.range === 'month') { where += ' AND substr(i.due_date, 1, 7) = ?'; params.push(t.slice(0, 7)); }
  if (q.range === 'next30') { where += ' AND i.due_date BETWEEN ? AND ? AND i.paid_amount < i.amount'; params.push(t, addDays(t, 30)); }
  if (q.range === 'overdue') { where += ' AND i.due_date < ? AND i.paid_amount < i.amount'; params.push(t); }
  if (q.range === 'due') { where += ' AND i.due_date <= ? AND i.paid_amount < i.amount'; params.push(addDays(t, 30)); }
  if (q.q) { const like = likeParam(q.q); where += ' AND (c.name LIKE ? OR c.code LIKE ? OR p.unit_number LIKE ? OR c.phone LIKE ?)'; params.push(like, like, like, like); }
  const from = 'FROM installments i JOIN customers c ON c.id = i.customer_id LEFT JOIN properties p ON p.id = c.property_id';
  const agg = await db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(i.amount - i.paid_amount), 0) AS balance ${from} ${where}`, params);
  const sorts: Record<string, string> = { due_date: 'i.due_date', amount: 'i.amount', balance: '(i.amount - i.paid_amount)', customer: 'c.name' };
  const rows = await db.all(
    `SELECT i.*, i.amount - i.paid_amount AS balance, c.name AS customer_name, c.code AS customer_code, c.phone AS customer_phone,
            p.project AS property_project, p.unit_number AS property_unit
     ${from} ${where} ORDER BY ${q.sort ? orderBy(sorts, q.sort, q.order, 'i.due_date', 'asc') : 'CASE WHEN i.paid_amount >= i.amount THEN 1 ELSE 0 END, i.due_date, c.name'} LIMIT ? OFFSET ?`,
    [...params, p.limit, p.offset],
  );
  const counts = await db.all("SELECT i.status, COUNT(*) AS n, SUM(i.amount - i.paid_amount) AS balance FROM installments i JOIN customers c ON c.id = i.customer_id WHERE c.status != 'Cancelled' GROUP BY i.status");
  res.json({ data: rows, meta: pageMeta(agg.n, p, { balance: agg.balance, counts }) });
});

installmentsRouter.post('/:id/payment', async (req, res) => {
  const data = parse(paymentBody, req.body);
  const id = await recordPayment({ ...data, installment_id: idParam(req) }, req.user);
  res.status(201).json(await receiptFor(id, req.user));
});
