import { inr } from '@estateflow/shared';
import { db } from '../db/index.js';
import { nowIso } from '../utils/dates.js';
import { notifyRoles } from './notifications.js';

/**
 * Broker commission follows the customer's payments: every completed payment from a customer who came
 * through a broker gets one commission row at the broker's rate. A payment that later fails or goes back
 * to pending loses its unpaid commission; commission already paid out is never changed.
 */
export async function syncCommissionForTransaction(transactionId: number) {
  const t = await db.get(
    `SELECT t.id, t.amount, t.status, t.customer_id, c.name AS customer_name, c.broker_id, b.name AS broker_name, b.commission_pct
     FROM transactions t JOIN customers c ON c.id = t.customer_id LEFT JOIN brokers b ON b.id = c.broker_id WHERE t.id = ?`,
    [transactionId],
  );
  if (!t) return;
  const existing = await db.get('SELECT id, status, broker_id FROM broker_commissions WHERE transaction_id = ?', [t.id]);
  if (existing?.status === 'Paid') return;
  const earns = t.status === 'Completed' && t.broker_id && t.commission_pct > 0;
  if (!earns) {
    if (existing) await db.run('DELETE FROM broker_commissions WHERE id = ?', [existing.id]);
    return;
  }
  const amount = Math.round((t.amount * t.commission_pct) / 100);
  if (existing) {
    await db.update('broker_commissions', existing.id, { broker_id: t.broker_id, payment_amount: t.amount, pct: t.commission_pct, amount });
    return;
  }
  await db.insert('broker_commissions', {
    broker_id: t.broker_id,
    customer_id: t.customer_id,
    transaction_id: t.id,
    payment_amount: t.amount,
    pct: t.commission_pct,
    amount,
    status: 'Due',
    created_at: nowIso(),
  });
  await notifyRoles(['admin', 'accounts'], {
    type: 'payment',
    title: 'Broker commission due',
    message: `${inr(amount)} (${t.commission_pct}%) is due to ${t.broker_name} on ${t.customer_name}'s payment of ${inr(t.amount)}.`,
    link: '/brokers',
  });
}

/** Re-applies the customer's current broker to all of their completed payments (after the broker is set or changed). */
export async function syncCommissionsForCustomer(customerId: number) {
  const txns = await db.all<{ id: number }>('SELECT id FROM transactions WHERE customer_id = ?', [customerId]);
  for (const t of txns) await syncCommissionForTransaction(t.id);
}
