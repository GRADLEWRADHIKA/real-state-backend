import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { addDays, todayStr } from '@estateflow/shared';
import { db } from '../src/db/index.js';
import { runScheduledJobs } from '../src/services/scheduler.js';
import { createBackup, listBackups } from '../src/services/backup.js';
import { as, setupDb, type Session } from './helpers.js';

let admin: Session, manager: Session, sales: Session, accounts: Session;
const T = todayStr();

beforeAll(async () => {
  await setupDb();
  [admin, manager, sales, accounts] = await Promise.all([as('admin'), as('manager'), as('sales'), as('accounts')]);
});

describe('plots: blocks, map and history', () => {
  it('filters by block and lists blocks', async () => {
    const res = await manager.get('/api/properties?block=A&limit=100').expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((p: { block: string }) => p.block === 'A')).toBe(true);
    expect(res.body.meta.blocks).toEqual(expect.arrayContaining(['A', 'B', 'C']));
  });

  it('returns every unit for the plot map', async () => {
    const res = await sales.get('/api/properties/map').expect(200);
    const total = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM properties'))!.n;
    expect(res.body.data).toHaveLength(total);
    expect(res.body.data[0]).toHaveProperty('status');
  });

  it('keeps rate per sq ft and shows plot history', async () => {
    const p = await db.get("SELECT p.id FROM properties p JOIN customers c ON c.property_id = p.id WHERE p.type = 'Plot' LIMIT 1");
    const res = await manager.get(`/api/properties/${p.id}`).expect(200);
    expect(res.body.rate_per_sqft).toBeGreaterThan(0);
    expect(res.body.history.length).toBeGreaterThan(0);
    expect(res.body.history[0]).toHaveProperty('booking_date');
  });
});

describe('customers: registry, nominee and broker commission', () => {
  let customerId: number;
  let brokerId: number;

  it('saves nominee and registry, and requires the date when it is fixed', async () => {
    const c = await db.get("SELECT id FROM customers WHERE status = 'Active' AND broker_id IS NULL ORDER BY id LIMIT 1");
    customerId = c.id;
    const bad = await manager.put(`/api/customers/${customerId}`, { registry_status: 'Date fixed' });
    expect(bad.status).toBe(422);
    const ok = await manager.put(`/api/customers/${customerId}`, {
      registry_status: 'Date fixed', registry_date: addDays(T, 15), nominee_name: 'Meera Devi', nominee_relation: 'Mother',
    }).expect(200);
    expect(ok.body.registry_status).toBe('Date fixed');
    expect(ok.body.nominee_name).toBe('Meera Devi');
    const list = await manager.get('/api/customers?registry=due15&limit=100').expect(200);
    expect(list.body.data.map((x: { id: number }) => x.id)).toContain(customerId);
  });

  it('reminds staff 15 days before the registry', async () => {
    await runScheduledJobs();
    const n = await db.get("SELECT COUNT(*) AS n FROM notifications WHERE title = 'Registry reminder' AND message LIKE '%in 15 days%'");
    expect(n.n).toBeGreaterThan(0);
  });

  it('works out commission automatically when a broker customer pays', async () => {
    brokerId = (await manager.post('/api/brokers', { name: 'Test Broker', phone: '+91 90000 11111', commission_pct: 2 }).expect(201)).body.id;
    await manager.put(`/api/customers/${customerId}`, { broker_id: brokerId }).expect(200);
    const inst = await db.get('SELECT id, amount - paid_amount AS balance FROM installments WHERE customer_id = ? AND paid_amount < amount ORDER BY number LIMIT 1', [customerId]);
    const pay = await accounts.post(`/api/installments/${inst.id}/payment`, { amount: 100_000, method: 'Cash', payment_date: T }).expect(201);
    const txnId = pay.body.id ?? pay.body.transaction?.id;
    const c = await db.get('SELECT * FROM broker_commissions WHERE broker_id = ? ORDER BY id DESC LIMIT 1', [brokerId]);
    expect(c.amount).toBe(2_000);
    if (txnId) expect(c.transaction_id).toBe(txnId);
    const list = await accounts.get('/api/brokers/commissions?status=Due').expect(200);
    expect(list.body.data.some((x: { id: number }) => x.id === c.id)).toBe(true);
    await accounts.post(`/api/brokers/commissions/${c.id}/pay`, { paid_on: T, method: 'UPI' }).expect(200);
    const b = await manager.get(`/api/brokers/${brokerId}`).expect(200);
    expect(b.body.commission_paid).toBeGreaterThanOrEqual(2_000);
  });

  it('hides broker money from sales executives', async () => {
    const res = await sales.get('/api/brokers').expect(200);
    expect(res.body.data[0]).not.toHaveProperty('commission_due');
    await sales.get('/api/brokers/commissions').expect(403);
  });
});

describe('expenses', () => {
  it('records site and office expenses for accounts only', async () => {
    await accounts.post('/api/expenses', { expense_date: T, category: 'Site', description: 'Cement bags', amount: 8_000, method: 'Cash' }).expect(201);
    const res = await accounts.get('/api/expenses?category=Site').expect(200);
    expect(res.body.data[0].category).toBe('Site');
    expect(res.body.meta.totals.today).toBeGreaterThanOrEqual(8_000);
    await sales.get('/api/expenses').expect(403);
    await manager.post('/api/expenses', { expense_date: T, category: 'Office', description: 'x', amount: 1, method: 'Cash' }).expect(403);
  });
});

describe('staff: salary, targets and attendance', () => {
  it('tracks salary paid and left for the month', async () => {
    const userId = sales.session.user.id;
    await accounts.put(`/api/staff/${userId}/pay`, { monthly_salary: 40_000 }).expect(200);
    const month = T.slice(0, 7);
    await accounts.post('/api/staff/salary-payments', { user_id: userId, month, amount: 15_000, paid_on: T, method: 'UPI' }).expect(201);
    const over = await accounts.post('/api/staff/salary-payments', { user_id: userId, month, amount: 30_000, paid_on: T, method: 'UPI' });
    expect(over.status).toBe(422);
    const res = await accounts.get(`/api/staff/salaries?month=${month}`).expect(200);
    const row = res.body.data.find((r: { user_id: number }) => r.user_id === userId);
    expect(row).toMatchObject({ monthly_salary: 40_000, paid: 15_000, balance: 25_000 });
    await sales.get('/api/staff/salaries').expect(403);
  });

  it('lets the manager set targets and sales see only their own', async () => {
    await manager.put(`/api/staff/${sales.session.user.id}/pay`, { monthly_target: 5_000_000 }).expect(200);
    await manager.put(`/api/staff/${sales.session.user.id}/pay`, { monthly_salary: 1 }).expect(403);
    const mine = await sales.get('/api/staff/targets').expect(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].monthly_target).toBe(5_000_000);
  });

  it('checks staff in and out and shows attendance on the overview', async () => {
    await db.run('DELETE FROM attendance WHERE user_id = ? AND date = ?', [sales.session.user.id, T]);
    await sales.post('/api/staff/attendance/check-in', { lat: 26.8, lng: 80.9 }).expect(200);
    await sales.post('/api/staff/attendance/check-in', {}).expect(409);
    const out = await sales.post('/api/staff/attendance/check-out', {}).expect(200);
    expect(out.body.check_out_at).toBeTruthy();
    await manager.post('/api/staff/attendance', { user_id: accounts.session.user.id, date: T, status: 'Leave' }).expect(200);
    const day = await manager.get(`/api/staff/attendance?date=${T}`).expect(200);
    expect(day.body.data.find((r: { user_id: number }) => r.user_id === accounts.session.user.id).status).toBe('Leave');
    const o = await admin.get('/api/dashboard/overview').expect(200);
    expect(o.body.attendance.present).toBeGreaterThan(0);
    expect(o.body.plots.total).toBeGreaterThan(0);
    expect(o.body).toHaveProperty('registry_pending');
    expect((await sales.get('/api/dashboard/overview').expect(200)).body.attendance).toBeNull();
  });
});

describe('backups', () => {
  it('writes a database copy that admins can list and download', async () => {
    const b = await createBackup(true);
    expect(fs.existsSync(b ? `${b.name}` : '') || listBackups().length > 0).toBe(true);
    const list = await admin.get('/api/backups').expect(200);
    expect(list.body.data.some((x: { name: string }) => x.name === b.name)).toBe(true);
    const file = await admin.get(`/api/backups/${b.name}`).expect(200);
    expect(Number(file.headers['content-length'] ?? file.body.length)).toBeGreaterThan(1000);
    await manager.get('/api/backups').expect(403);
    await admin.get('/api/backups/..%2F..%2F.env').expect(400);
  });
});

describe('customer documents access', () => {
  it('opens customer papers only to admin, accounts and the customer', async () => {
    const doc = await db.get("SELECT id, entity_id FROM documents WHERE entity_type = 'customer' LIMIT 1");
    const c = await db.get('SELECT assigned_to FROM customers WHERE id = ?', [doc.entity_id]);
    await admin.get(`/api/documents/${doc.id}/download`).expect(200);
    await accounts.get(`/api/documents/${doc.id}/download`).expect(200);
    await manager.get(`/api/documents/${doc.id}/download`).expect(403);
    await db.run('UPDATE customers SET assigned_to = ? WHERE id = ?', [sales.session.user.id, doc.entity_id]);
    await sales.get(`/api/documents/${doc.id}/download`).expect(403);
    const detail = await sales.get(`/api/customers/${doc.entity_id}`).expect(200);
    expect(detail.body.documents).toEqual([]);
    expect(detail.body.documents_hidden).toBe(true);
    const list = await manager.get('/api/documents?limit=50').expect(200);
    expect(list.body.data.every((d: { entity_type: string }) => d.entity_type !== 'customer')).toBe(true);
    expect((await accounts.get(`/api/customers/${doc.entity_id}`).expect(200)).body.documents.length).toBeGreaterThan(0);
    await db.run('UPDATE customers SET assigned_to = ? WHERE id = ?', [c.assigned_to, doc.entity_id]);
  });
});
