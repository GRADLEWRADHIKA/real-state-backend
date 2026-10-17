import { db } from '../db/index.js';
import { HttpError, notFound } from '../utils/http.js';
import { installmentStatus as statusFor } from '@estateflow/shared';
import { financialYear, nowIso, today } from '../utils/dates.js';
import { logActivity, notifyRoles, notifyUsers } from './activity.js';
import { portalUserFor } from './notifications.js';
import { realtime } from './realtime.js';
import type { AuthUser } from '../middleware/auth.js';

export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

let lastSync = 0;
/** Recomputes installment statuses from amounts and due dates (cheap; throttled). */
export async function syncInstallmentStatuses(force = false) {
  if (!force && Date.now() - lastSync < 30_000) return;
  lastSync = Date.now();
  await db.run(
    `UPDATE installments SET status = CASE
       WHEN paid_amount >= amount THEN 'Paid'
       WHEN due_date < ? THEN 'Overdue'
       WHEN paid_amount > 0 THEN 'Partially Paid'
       ELSE 'Pending' END`,
    [today()],
  );
}

export const installmentStatus = (amount: number, paid: number, due: string) => statusFor(amount, paid, due, today());

export async function customerFinancials(customerId: number) {
  const t = today();
  const row = await db.get(
    `SELECT c.total_value,
       COALESCE(SUM(i.paid_amount), 0) AS paid,
       COALESCE(SUM(CASE WHEN i.paid_amount < i.amount AND i.due_date < ? THEN i.amount - i.paid_amount END), 0) AS overdue,
       COUNT(i.id) AS installments,
       SUM(CASE WHEN i.paid_amount >= i.amount THEN 1 ELSE 0 END) AS paid_installments
     FROM customers c LEFT JOIN installments i ON i.customer_id = c.id
     WHERE c.id = ? GROUP BY c.id`,
    [t, customerId],
  );
  if (!row) throw notFound('Customer');
  const next = await db.get(
    `SELECT id, number, label, due_date, amount, paid_amount, amount - paid_amount AS balance
     FROM installments WHERE customer_id = ? AND paid_amount < amount ORDER BY due_date, number LIMIT 1`,
    [customerId],
  );
  const deal = await db.get('SELECT booking_amount FROM deals WHERE customer_id = ? ORDER BY id DESC LIMIT 1', [customerId]);
  const outstanding = row.total_value - row.paid;
  return {
    total_value: row.total_value,
    booking_amount: deal?.booking_amount ?? 0,
    paid: row.paid,
    outstanding,
    overdue: row.overdue,
    progress: row.total_value ? Math.round((row.paid / row.total_value) * 1000) / 10 : 0,
    installments: row.installments,
    paid_installments: row.paid_installments ?? 0,
    next_installment: next ? { ...next, balance: next.balance } : null,
  };
}

/**
 * Next receipt number for the financial year in which the receipt is issued (prefix/FY/NNNN).
 * A per-FY counter row is incremented inside the payment transaction, so numbers are gap-free per
 * year and never repeat — back-dated payments included.
 */
export async function nextReceiptNumber() {
  const fy = financialYear();
  const company = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'company'");
  const prefix = (company && JSON.parse(company.value).receipt_prefix) || 'RCPT';
  await db.run('INSERT INTO receipt_sequences (fy, last_number) VALUES (?, 1) ON CONFLICT(fy) DO UPDATE SET last_number = last_number + 1', [fy.label]);
  const n = (await db.get<{ last_number: number }>('SELECT last_number FROM receipt_sequences WHERE fy = ?', [fy.label]))!.last_number;
  return `${prefix}/${fy.label}/${String(n).padStart(4, '0')}`;
}

/** Applies a (positive or negative) amount to an installment and closes out the sale when fully paid. */
async function applyToInstallment(installmentId: number, delta: number, paymentDate: string | null) {
  const inst = await db.get('SELECT * FROM installments WHERE id = ?', [installmentId]);
  if (!inst) return;
  const paid = Math.max(0, Math.min(inst.amount, inst.paid_amount + delta));
  await db.update('installments', installmentId, {
    paid_amount: paid,
    status: installmentStatus(inst.amount, paid, inst.due_date),
    payment_date: paid > 0 ? (delta > 0 ? paymentDate : inst.payment_date) : null,
  });
  const fin = await customerFinancials(inst.customer_id);
  const customer = await db.get('SELECT id, property_id, status FROM customers WHERE id = ?', [inst.customer_id]);
  if (fin.outstanding <= 0 && customer.status !== 'Completed') {
    await db.update('customers', customer.id, { status: 'Completed', updated_at: nowIso() });
    if (customer.property_id) await db.update('properties', customer.property_id, { status: 'Sold', updated_at: nowIso() });
  } else if (fin.outstanding > 0 && customer.status === 'Completed') {
    await db.update('customers', customer.id, { status: 'Active', updated_at: nowIso() });
    if (customer.property_id) await db.update('properties', customer.property_id, { status: 'Booked', updated_at: nowIso() });
  }
}

export interface PaymentInput {
  installment_id: number;
  amount: number;
  method: string;
  payment_date: string;
  reference?: string | null;
  notes?: string | null;
  status?: 'Completed' | 'Pending';
}

/**
 * Records a payment against an installment. In one transaction it creates the transaction +
 * receipt, updates the installment and customer balance, logs timeline activity and notifies.
 */
export async function recordPayment(input: PaymentInput, user: AuthUser) {
  return db.transaction(async () => {
    const inst = await db.get(
      `SELECT i.*, c.name AS customer_name, c.property_id, c.lead_id, c.assigned_to
       FROM installments i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`,
      [input.installment_id],
    );
    if (!inst) throw notFound('Installment');
    const pendingClearance = (await db.get<{ n: number }>(
      "SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE installment_id = ? AND status = 'Pending'",
      [inst.id],
    ))!.n;
    const balance = inst.amount - inst.paid_amount - pendingClearance;
    if (balance <= 0) throw new HttpError(422, 'This installment has no balance left to collect');
    if (input.amount <= 0) throw new HttpError(422, 'Amount must be greater than zero');
    if (input.amount > balance) throw new HttpError(422, `Amount exceeds the installment balance of ${inr(balance)}`);
    if (input.payment_date > today()) throw new HttpError(422, 'Payment date cannot be in the future');

    const status = input.status ?? 'Completed';
    const id = await db.insert('transactions', {
      code: `TMP-${Date.now()}-${Math.random()}`,
      customer_id: inst.customer_id,
      property_id: inst.property_id,
      installment_id: inst.id,
      type: inst.number === 1 ? 'Booking Amount' : 'Installment',
      amount: input.amount,
      method: input.method,
      payment_date: input.payment_date,
      reference: input.reference || null,
      status,
      notes: input.notes || null,
      recorded_by: user.id,
      created_at: nowIso(),
    });
    const receipt = status === 'Completed' ? await nextReceiptNumber() : null;
    await db.update('transactions', id, { code: `TXN-${100000 + id}`, receipt_number: receipt });
    if (status === 'Completed') await applyToInstallment(inst.id, input.amount, input.payment_date);

    const what = `${inr(input.amount)} via ${input.method} for ${inst.label}`;
    await logActivity({
      customer_id: inst.customer_id,
      lead_id: inst.lead_id,
      property_id: inst.property_id,
      type: 'payment',
      title: status === 'Completed' ? 'Payment received' : 'Payment recorded — awaiting clearance',
      description: what + (input.reference ? ` · Ref ${input.reference}` : ''),
      user_id: user.id,
    });
    const n = {
      type: 'payment',
      title: status === 'Completed' ? 'Payment received' : 'Cheque awaiting clearance',
      message: `Payment of ${inr(input.amount)} ${status === 'Completed' ? 'received' : 'recorded'} from ${inst.customer_name}.`,
      link: `/customers/${inst.customer_id}`,
    };
    await notifyRoles(['admin', 'accounts'], { ...n, trigger: 'payment_received' }, user.id);
    await notifyUsers([inst.assigned_to], { ...n, trigger: 'payment_received' }, user.id);
    const portalUser = await portalUserFor(inst.customer_id);
    if (portalUser && status === 'Completed') {
      await notifyUsers([portalUser.id], {
        type: 'payment',
        title: 'Payment received — thank you',
        message: `We have received ${inr(input.amount)} towards ${inst.label}. Your receipt ${receipt} is ready.`,
        link: `/receipts/${id}`,
        trigger: 'payment_received',
      });
    }
    if (portalUser) realtime.change(['portal', 'finance'], { userIds: [portalUser.id] });
    return id;
  });
}

/** Moves a transaction between Completed / Pending / Failed and keeps balances in sync. */
export async function setTransactionStatus(id: number, status: 'Completed' | 'Pending' | 'Failed', user: AuthUser) {
  return db.transaction(async () => {
    const t = await db.get('SELECT t.*, c.name AS customer_name, c.lead_id FROM transactions t JOIN customers c ON c.id = t.customer_id WHERE t.id = ?', [id]);
    if (!t) throw notFound('Transaction');
    if (t.status === status) return;
    const wasCounted = t.status === 'Completed';
    const nowCounted = status === 'Completed';
    if (t.installment_id && wasCounted !== nowCounted) {
      if (nowCounted) {
        const inst = await db.get('SELECT amount, paid_amount FROM installments WHERE id = ?', [t.installment_id]);
        if (inst && inst.paid_amount + t.amount > inst.amount) throw new HttpError(422, 'Clearing this payment would exceed the installment amount');
      }
      await applyToInstallment(t.installment_id, nowCounted ? t.amount : -t.amount, t.payment_date);
    }
    const receipt = nowCounted && !t.receipt_number ? await nextReceiptNumber() : t.receipt_number;
    await db.update('transactions', id, { status, receipt_number: receipt });
    await logActivity({
      customer_id: t.customer_id,
      lead_id: t.lead_id,
      type: 'payment',
      title: status === 'Completed' ? 'Payment cleared' : status === 'Failed' ? 'Payment failed / bounced' : 'Payment marked pending',
      description: `${t.code} · ${inr(t.amount)} via ${t.method}`,
      user_id: user.id,
    });
    const portal = await portalUserFor(t.customer_id);
    if (portal) realtime.change(['portal', 'finance'], { userIds: [portal.id] });
    if (status === 'Failed') {
      await notifyRoles(['admin', 'accounts'], {
        type: 'alert',
        title: 'Payment failed',
        message: `${inr(t.amount)} from ${t.customer_name} (${t.method}) was marked as failed.`,
        link: `/customers/${t.customer_id}`,
      }, user.id);
    }
  });
}
