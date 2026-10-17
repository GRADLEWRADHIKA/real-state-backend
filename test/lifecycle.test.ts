import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, financialYear, todayStr } from '@estateflow/shared';
import { db } from '../src/db/index.js';
import { as, setupDb, type Session } from './helpers.js';

let manager: Session, sales: Session, accounts: Session;
const T = todayStr();

beforeAll(async () => {
  await setupDb();
  [manager, sales, accounts] = await Promise.all([as('manager'), as('sales', 'app'), as('accounts')]);
});

describe('lead → visit → booking → payments', () => {
  let leadId: number;
  let customerId: number;
  let propertyId: number;

  it('creates a lead, auto-assigns it round robin and blocks a duplicate phone', async () => {
    await db.run("UPDATE settings SET value = ? WHERE key = 'assignment'", [JSON.stringify({ mode: 'round_robin', pool: [], apply_to_imports: true, last_user_id: 0 })]);
    const res = await manager.post('/api/leads', { name: 'Kavya Bansal', phone: '+91 91234 56780', source: 'Website', priority: 'Hot', budget: 9000000 });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^LD-\d+$/);
    expect(res.body.assigned_to).toBeTruthy();
    const firstSales = await db.get("SELECT id FROM users WHERE role = 'sales' AND status = 'Active' ORDER BY id LIMIT 1");
    expect(res.body.assigned_to).toBe(firstSales.id);

    const second = await manager.post('/api/leads', { name: 'Someone Else', phone: '+91 98888 77766', source: 'Google' });
    expect(second.body.assigned_to).not.toBe(res.body.assigned_to);

    const dup = await manager.post('/api/leads', { name: 'Kavya B', phone: '091234 56780', source: 'Facebook' });
    expect(dup.status).toBe(409);
    expect(dup.body.details.duplicate.id).toBe(res.body.id);

    // Hand it to the demo sales executive for the rest of the flow.
    await manager.post('/api/leads/bulk-assign', { ids: [res.body.id], agent_id: sales.session.user.id }).expect(200);
    leadId = res.body.id;
  });

  it('logs a call and moves the stage', async () => {
    await sales.post(`/api/leads/${leadId}/log-contact`, { channel: 'Call', summary: 'Wants a 3 BHK villa' }).expect(200);
    await sales.patch(`/api/leads/${leadId}/status`, { status: 'Qualified' }).expect(200);
    const lead = await sales.get(`/api/leads/${leadId}`).expect(200);
    expect(lead.body.status).toBe('Qualified');
    expect(lead.body.last_contact).toBeTruthy();
    expect(lead.body.activities.some((a: any) => a.type === 'call')).toBe(true);
    expect(lead.body.activities.some((a: any) => a.type === 'audit')).toBe(false);
  });

  it('schedules a visit, checks in and out with an outcome', async () => {
    propertyId = (await db.get("SELECT id FROM properties WHERE status = 'Available' AND type = 'Villa' LIMIT 1")).id;
    const v = await sales.post('/api/site-visits', { lead_id: leadId, property_id: propertyId, visit_date: T, visit_time: '10:00' });
    expect(v.status).toBe(201);
    const out0 = await sales.post(`/api/site-visits/${v.body.id}/check-out`, {});
    expect(out0.status).toBe(422);
    const inn = await sales.post(`/api/site-visits/${v.body.id}/check-in`, { lat: 26.6863, lng: 80.9876 }).expect(200);
    expect(inn.body.checked_in_at).toBeTruthy();
    expect((await sales.post(`/api/site-visits/${v.body.id}/check-in`, {})).status).toBe(409);
    const out = await sales.post(`/api/site-visits/${v.body.id}/check-out`, { outcome: 'Very interested', feedback: 'Loved the garden', lat: 26.6864, lng: 80.9877 }).expect(200);
    expect(out.body.status).toBe('Completed');
    expect(out.body.outcome).toBe('Very interested');
  });

  it('schedules a follow-up that shows up in "my day"', async () => {
    await sales.post('/api/followups', { lead_id: leadId, due_date: T, due_time: '23:59', type: 'Call', notes: 'Share cost sheet' }).expect(201);
    const today = await sales.get('/api/dashboard/today').expect(200);
    expect(today.body.followups.today.some((f: any) => f.lead_id === leadId)).toBe(true);
    expect(today.body.tasks.every((t: any) => t.status !== 'Completed')).toBe(true);
  });

  it('drops completed tasks from "my day"', async () => {
    const task = await sales.post('/api/tasks', { title: 'Send brochure', priority: 'High', due_date: T, lead_id: leadId }).expect(201);
    const before = await sales.get('/api/dashboard/today').expect(200);
    expect(before.body.tasks.some((t: any) => t.id === task.body.id)).toBe(true);
    await sales.put(`/api/tasks/${task.body.id}`, { status: 'Completed' }).expect(200);
    const after = await sales.get('/api/dashboard/today').expect(200);
    expect(after.body.tasks.some((t: any) => t.id === task.body.id)).toBe(false);
  });

  it('previews and converts to a booking with an installment schedule', async () => {
    const plan = { total_value: 8_500_000, booking_amount: 850_000, booking_date: T, installments_count: 4, frequency_months: 3, first_due_date: addDays(T, 30) };
    const preview = await sales.post('/api/customers/schedule-preview', plan).expect(200);
    const rows = preview.body.data;
    expect(preview.body.meta.total).toBe(8_500_000);
    expect(rows.reduce((s: number, r: any) => s + r.amount, 0)).toBe(8_500_000);

    const res = await sales.post(`/api/leads/${leadId}/convert`, { ...plan, property_id: propertyId, pan: 'ABCDE1234F', record_booking_payment: false });
    expect(res.status).toBe(201);
    customerId = res.body.customer_id;
    const cust = await sales.get(`/api/customers/${customerId}`).expect(200);
    expect(cust.body.installments).toHaveLength(5);
    expect(cust.body.financials.outstanding).toBe(8_500_000);
    const prop = await db.get('SELECT status FROM properties WHERE id = ?', [propertyId]);
    expect(prop.status).toBe('Booked');
  });

  it('records partial and full payments with correct balances', async () => {
    const inst = await db.get('SELECT * FROM installments WHERE customer_id = ? AND number = 1', [customerId]);
    const part = await accounts.post(`/api/installments/${inst.id}/payment`, { amount: 300_000, method: 'UPI', payment_date: T, reference: 'UPI-1' });
    expect(part.status).toBe(201);
    expect(part.body.receipt_number).toMatch(/\/\d{4}$/);
    expect(part.body.outstanding_after).toBe(8_200_000);
    let row = await db.get('SELECT * FROM installments WHERE id = ?', [inst.id]);
    expect(row.status).toBe('Partially Paid');

    const over = await accounts.post(`/api/installments/${inst.id}/payment`, { amount: 600_000, method: 'UPI', payment_date: T });
    expect(over.status).toBe(422);

    const rest = await accounts.post(`/api/installments/${inst.id}/payment`, { amount: 550_000, method: 'Bank Transfer', payment_date: T }).expect(201);
    expect(rest.body.paid_to_date).toBe(850_000);
    row = await db.get('SELECT * FROM installments WHERE id = ?', [inst.id]);
    expect(row.status).toBe('Paid');
    const fin = (await accounts.get(`/api/customers/${customerId}`).expect(200)).body.financials;
    expect(fin.paid).toBe(850_000);
    expect(fin.outstanding).toBe(7_650_000);
  });

  it('numbers receipts from a per-year counter, including back-dated payments', async () => {
    const fy = financialYear().label;
    const before = (await db.get('SELECT last_number FROM receipt_sequences WHERE fy = ?', [fy]))?.last_number ?? 0;
    const inst2 = await db.get('SELECT * FROM installments WHERE customer_id = ? AND number = 2', [customerId]);
    // A payment dated last month must not reuse a number already issued.
    const back = await accounts.post(`/api/installments/${inst2.id}/payment`, { amount: 100_000, method: 'Cheque', payment_date: addDays(T, -20) }).expect(201);
    const now = await accounts.post(`/api/installments/${inst2.id}/payment`, { amount: 100_000, method: 'Cheque', payment_date: T }).expect(201);
    expect(back.body.receipt_number).toBe(`SWR/${fy}/${String(before + 1).padStart(4, '0')}`);
    expect(now.body.receipt_number).toBe(`SWR/${fy}/${String(before + 2).padStart(4, '0')}`);
    const dupes = await db.get('SELECT COUNT(*) AS n FROM (SELECT receipt_number FROM transactions WHERE receipt_number IS NOT NULL GROUP BY receipt_number HAVING COUNT(*) > 1) x');
    expect(dupes.n).toBe(0);
  });

  it('a pending cheque does not reduce the balance until it clears, and a bounce reverses nothing', async () => {
    const inst3 = await db.get('SELECT * FROM installments WHERE customer_id = ? AND number = 3', [customerId]);
    const pending = await accounts.post(`/api/installments/${inst3.id}/payment`, { amount: 200_000, method: 'Cheque', payment_date: T, status: 'Pending' }).expect(201);
    let fin = (await accounts.get(`/api/customers/${customerId}`)).body.financials;
    expect(fin.paid).toBe(1_050_000);
    await accounts.patch(`/api/transactions/${pending.body.id}/status`, { status: 'Completed' }).expect(200);
    fin = (await accounts.get(`/api/customers/${customerId}`)).body.financials;
    expect(fin.paid).toBe(1_250_000);
    await accounts.patch(`/api/transactions/${pending.body.id}/status`, { status: 'Failed' }).expect(200);
    fin = (await accounts.get(`/api/customers/${customerId}`)).body.financials;
    expect(fin.paid).toBe(1_050_000);
  });

  it('a failed payment inside the transaction leaves nothing behind', async () => {
    const before = await db.get('SELECT COUNT(*) AS n FROM transactions');
    const res = await accounts.post('/api/installments/999999/payment', { amount: 1000, method: 'UPI', payment_date: T });
    expect(res.status).toBe(404);
    expect((await db.get('SELECT COUNT(*) AS n FROM transactions')).n).toBe(before.n);
  });

  it('the receipt PDF is generated on the server', async () => {
    const txn = await db.get("SELECT id FROM transactions WHERE customer_id = ? AND status = 'Completed' LIMIT 1", [customerId]);
    const res = await accounts.get(`/api/transactions/${txn.id}/receipt.pdf`).expect(200);
    expect(res.headers['content-disposition']).toMatch(/\.pdf/);
    expect(res.body.length).toBeGreaterThan(2000);
  });
});

describe('duplicates and merge', () => {
  it('merges a duplicate lead into the original and keeps its history', async () => {
    const original = await db.get("SELECT id FROM leads WHERE name = 'Vikas Chaudhary'");
    const dup = await db.get("SELECT id FROM leads WHERE name = 'Vikas Choudhary'");
    const detail = await manager.get(`/api/leads/${original.id}`).expect(200);
    expect(detail.body.duplicates.map((d: any) => d.id)).toContain(dup.id);
    await manager.post(`/api/leads/${original.id}/merge`, { source_id: dup.id }).expect(200);
    expect(await db.get('SELECT id FROM leads WHERE id = ?', [dup.id])).toBeUndefined();
    const acts = await db.all('SELECT * FROM activities WHERE lead_id = ?', [original.id]);
    expect(acts.some((a: any) => /merged/i.test(a.title))).toBe(true);
  });
});

describe('pagination envelope', () => {
  for (const path of ['/api/leads', '/api/customers', '/api/properties', '/api/site-visits', '/api/followups', '/api/tasks', '/api/deals', '/api/documents', '/api/notifications', '/api/customer-requests']) {
    it(`${path} returns { data, meta }`, async () => {
      const res = await manager.get(`${path}?limit=2`).expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 2 });
      expect(typeof res.body.meta.total).toBe('number');
      if (res.body.meta.hasMore) {
        const next = await manager.get(`${path}?limit=2&cursor=${res.body.meta.nextCursor}`).expect(200);
        expect(next.body.meta.page).toBe(2);
        expect(next.body.data[0]?.id).not.toBe(res.body.data[0]?.id);
      }
    });
  }
  it('finance lists use the same envelope', async () => {
    for (const path of ['/api/transactions', '/api/installments']) {
      const res = await accounts.get(`${path}?limit=3`).expect(200);
      expect(res.body.meta.limit).toBe(3);
    }
  });
  it('rejects invalid query values', async () => {
    expect((await manager.get('/api/leads?limit=100000')).status).toBe(400);
    expect((await manager.get('/api/leads?status=Nonsense')).status).toBe(400);
  });
});

describe('reports export', () => {
  it('exports CSV and PDF for each permitted section', async () => {
    const admin = await as('admin');
    const rep = await admin.get('/api/reports').expect(200);
    for (const section of rep.body.sections) {
      const csv = await admin.get(`/api/reports/export?section=${section}&format=csv`).expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text.split('\n').length).toBeGreaterThan(1);
    }
    const pdf = await admin.get('/api/reports/export?section=aging&format=pdf').expect(200);
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
  });
});
