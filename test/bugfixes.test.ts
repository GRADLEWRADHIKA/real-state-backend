import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayStr } from '@estateflow/shared';
import { db } from '../src/db/index.js';
import { applyDueRates } from '../src/services/pricing.js';
import { as, setupDb, type Session } from './helpers.js';

let admin: Session, manager: Session, sales: Session, sales2: Session, accounts: Session;
const T = todayStr();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

beforeAll(async () => {
  await setupDb();
  [admin, manager, sales, sales2, accounts] = await Promise.all([as('admin'), as('manager'), as('sales'), as('sales2'), as('accounts')]);
});

describe('edits change only the fields they send', () => {
  it('completing a task keeps its priority', async () => {
    const task = await admin.post('/api/tasks', { title: 'Urgent paperwork', priority: 'Urgent', due_date: T }).expect(201);
    await admin.put(`/api/tasks/${task.body.id}`, { status: 'Completed' }).expect(200);
    expect((await db.get('SELECT priority, status FROM tasks WHERE id = ?', [task.body.id]))).toMatchObject({ priority: 'Urgent', status: 'Completed' });
  });

  it('publishing a unit keeps its amenities and status, and works on booked units', async () => {
    const unit = await db.get("SELECT id, amenities FROM properties WHERE status = 'Available' AND amenities IS NOT NULL AND amenities != '[]' LIMIT 1");
    await admin.put(`/api/properties/${unit.id}`, { is_published: false }).expect(200);
    expect(await db.get('SELECT status, amenities FROM properties WHERE id = ?', [unit.id])).toMatchObject({ status: 'Available', amenities: unit.amenities });
    const booked = await db.get("SELECT id FROM properties WHERE status IN ('Booked','Sold') LIMIT 1");
    await admin.put(`/api/properties/${booked.id}`, { is_published: true }).expect(200);
  });

  it('a lead edit without priority keeps the priority', async () => {
    const lead = await db.get("SELECT id FROM leads WHERE priority = 'Hot' LIMIT 1");
    await admin.put(`/api/leads/${lead.id}`, { notes: 'Called back' }).expect(200);
    expect((await db.get('SELECT priority FROM leads WHERE id = ?', [lead.id])).priority).toBe('Hot');
  });
});

describe('cancelled bookings and money', () => {
  it('drop out of the finance overview and refuse new payments', async () => {
    const c = await db.get(
      `SELECT c.id FROM customers c WHERE c.status = 'Active'
       AND EXISTS (SELECT 1 FROM installments i WHERE i.customer_id = c.id AND i.paid_amount > 0)
       AND EXISTS (SELECT 1 FROM installments i WHERE i.customer_id = c.id AND i.paid_amount < i.amount) LIMIT 1`,
    );
    const inst = await db.get('SELECT id FROM installments WHERE customer_id = ? AND paid_amount < amount AND paid_amount > 0 LIMIT 1', [c.id])
      ?? (await db.get('SELECT id FROM installments WHERE customer_id = ? AND paid_amount > 0 LIMIT 1', [c.id]));
    // Make one of its paid instalments partly unpaid and overdue, so it would count as overdue.
    await db.run('UPDATE installments SET amount = paid_amount + 100000, due_date = ? WHERE id = ?', [addDays(T, -20), inst.id]);
    const before = (await accounts.get('/api/finance/summary').expect(200)).body;
    await admin.post(`/api/customers/${c.id}/cancel`, { reason: 'Buyer withdrew' }).expect(200);
    const after = (await accounts.get('/api/finance/summary').expect(200)).body;
    expect(after.overdue).toBe(before.overdue - 100000);
    expect(after.overdue_list.some((i: { customer_id: number }) => i.customer_id === c.id)).toBe(false);
    const pay = await accounts.post(`/api/installments/${inst.id}/payment`, { amount: 1000, method: 'Cash', payment_date: T });
    expect(pay.status).toBe(409);
    const detail = (await admin.get(`/api/customers/${c.id}`).expect(200)).body;
    expect(detail.financials).toMatchObject({ outstanding: 0, overdue: 0, next_installment: null });
  });
});

describe('lead ownership', () => {
  it('reassigning a lead moves its open follow-ups and upcoming visits', async () => {
    const lead = await sales.post('/api/leads', { name: 'Reassign Test', phone: '+91 90000 55501', source: 'Walk-in' }).expect(201);
    const fu = await sales.post('/api/followups', { lead_id: lead.body.id, due_date: addDays(T, 2), due_time: '10:00', type: 'Call' }).expect(201);
    const visit = await sales.post('/api/site-visits', { lead_id: lead.body.id, visit_date: addDays(T, 3), visit_time: '11:00' });
    await manager.put(`/api/leads/${lead.body.id}`, { assigned_to: sales2.session.user.id }).expect(200);
    expect((await db.get('SELECT agent_id FROM followups WHERE id = ?', [fu.body.id])).agent_id).toBe(sales2.session.user.id);
    if (visit.status === 201) expect((await db.get('SELECT agent_id FROM site_visits WHERE id = ?', [visit.body.id])).agent_id).toBe(sales2.session.user.id);
    expect((await sales.get(`/api/followups/${fu.body.id}`)).status).not.toBe(200);
  });

  it("another executive cannot book a unit held for someone else's lead", async () => {
    const unit = await db.get("SELECT id FROM properties WHERE status = 'Available' ORDER BY id LIMIT 1");
    const mine = await sales.post('/api/leads', { name: 'Hold Owner', phone: '+91 90000 55502', source: 'Walk-in' }).expect(201);
    await sales.post(`/api/properties/${unit.id}/hold`, { days: 2, lead_id: mine.body.id }).expect(200);
    await db.run('UPDATE properties SET hold_lead_id = ? WHERE id = ?', [mine.body.id, unit.id]);
    const theirs = await sales2.post('/api/leads', { name: 'Other Buyer', phone: '+91 90000 55503', source: 'Walk-in' }).expect(201);
    const plan = { total_value: 5_000_000, booking_amount: 500_000, booking_date: T, installments_count: 2, frequency_months: 3, first_due_date: addDays(T, 30) };
    const res = await sales2.post(`/api/leads/${theirs.body.id}/convert`, { ...plan, property_id: unit.id, record_booking_payment: false });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/on hold/);
  });

  it('a sales executive cannot attach a broker to a customer', async () => {
    const c = await db.get('SELECT id, broker_id FROM customers WHERE assigned_to = ? AND broker_id IS NULL LIMIT 1', [sales.session.user.id]);
    const broker = await db.get('SELECT id FROM brokers LIMIT 1');
    await sales.put(`/api/customers/${c.id}`, { broker_id: broker.id }).expect(200);
    expect((await db.get('SELECT broker_id FROM customers WHERE id = ?', [c.id])).broker_id).toBeNull();
  });
});

describe('dates', () => {
  it('a lead created at 02:00 IST counts on that IST day', async () => {
    const lead = await admin.post('/api/leads', { name: 'Early Bird', phone: '+91 90000 55504', source: 'Website' }).expect(201);
    // 1 Nov 2026 02:00 IST = 31 Oct 2026 20:30 UTC.
    await db.run("UPDATE leads SET created_at = '2026-10-31T20:30:00.000Z' WHERE id = ?", [lead.body.id]);
    const nov = await admin.get('/api/leads?from=2026-11-01&to=2026-11-01&limit=100').expect(200);
    expect(nov.body.data.map((l: { id: number }) => l.id)).toContain(lead.body.id);
    const oct = await admin.get('/api/leads?from=2026-10-31&to=2026-10-31&limit=100').expect(200);
    expect(oct.body.data.map((l: { id: number }) => l.id)).not.toContain(lead.body.id);
  });
});

describe('price list dates', () => {
  it('a back-dated correction does not re-price units, and a future rate applies on its date', async () => {
    const u = await db.get("SELECT project, COALESCE(block, '') AS block FROM properties WHERE status = 'Available' AND area_sqft > 0 GROUP BY project, block LIMIT 1");
    const unit = () => db.get("SELECT rate_per_sqft FROM properties WHERE project = ? AND COALESCE(block, '') = ? AND status = 'Available' LIMIT 1", [u.project, u.block]);
    await manager.post('/api/price-list', { project: u.project, block: u.block, rate_per_sqft: 2100, effective_from: T }).expect(201);
    expect((await unit()).rate_per_sqft).toBe(2100);
    await manager.post('/api/price-list', { project: u.project, block: u.block, rate_per_sqft: 1500, effective_from: addDays(T, -60) }).expect(201);
    expect((await unit()).rate_per_sqft).toBe(2100);

    const future = await manager.post('/api/price-list', { project: u.project, block: u.block, rate_per_sqft: 2600, effective_from: addDays(T, 5) }).expect(201);
    expect((await unit()).rate_per_sqft).toBe(2100);
    await db.run('UPDATE price_list SET effective_from = ? WHERE id = ?', [T, future.body.id]);
    await applyDueRates();
    expect((await unit()).rate_per_sqft).toBe(2600);
    expect((await db.get('SELECT apply_pending FROM price_list WHERE id = ?', [future.body.id])).apply_pending).toBe(0);
  });
});

describe('document downloads', () => {
  it('add the file extension when the name has none', async () => {
    const leadId = (await db.get('SELECT id FROM leads WHERE assigned_to = ? LIMIT 1', [sales.session.user.id])).id;
    const res = await sales.upload('/api/documents').field('entity_type', 'lead').field('entity_id', String(leadId)).field('doc_type', 'Requirement').field('name', 'Sale deed (scan 2 Nov 2026)').attach('file', PDF, { filename: 'scan.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    const dl = await sales.get(`/api/documents/${res.body.id}/download`).expect(200);
    expect(dl.headers['content-disposition']).toMatch(/scan 2 Nov 2026\)\.pdf/);
  });
});
