import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, leadHeat, todayStr } from '@estateflow/shared';
import { db } from '../src/db/index.js';
import { runScheduledJobs } from '../src/services/scheduler.js';
import { as, setupDb, type Session } from './helpers.js';

let manager: Session, sales: Session, accounts: Session, customer: Session;
const T = todayStr();

beforeAll(async () => {
  await setupDb();
  [manager, sales, accounts] = await Promise.all([as('manager'), as('sales'), as('accounts')]);
  customer = await as('customer', 'app');
});

describe('lead ageing and scores', () => {
  it('scores the same way everywhere and flags leads with no contact for a week', () => {
    const fresh = leadHeat({ status: 'Negotiation', priority: 'Hot', budget: 5_000_000, last_contact: T, created_at: T }, T);
    const old = leadHeat({ status: 'New', priority: 'Cold', created_at: addDays(T, -20) }, T);
    expect(fresh.score).toBeGreaterThan(80);
    expect(fresh.stuck).toBe(false);
    expect(old.stuck).toBe(true);
    expect(old.idle_days).toBe(20);
    expect(leadHeat({ status: 'Booked', created_at: addDays(T, -40) }, T).score).toBe(0);
  });

  it('lists stuck and hot leads, scoped for sales', async () => {
    const lead = await db.get("SELECT id FROM leads WHERE status = 'New' LIMIT 1");
    await db.run('UPDATE leads SET last_contact = ?, created_at = ? WHERE id = ?', [`${addDays(T, -12)}T10:00:00.000Z`, `${addDays(T, -30)}T10:00:00.000Z`, lead.id]);
    const res = await manager.get('/api/leads/insights?days=7').expect(200);
    expect(res.body.stuck.some((l: { id: number }) => l.id === lead.id)).toBe(true);
    expect(res.body.stuck[0].idle_days).toBeGreaterThanOrEqual(res.body.stuck.at(-1).idle_days);
    expect(res.body.hot.length).toBeGreaterThan(0);
    const mine = await sales.get('/api/leads/insights').expect(200);
    expect([...mine.body.stuck, ...mine.body.hot].every((l: { assigned_to: number }) => l.assigned_to === sales.session.user.id)).toBe(true);
    const list = await manager.get('/api/leads?limit=5').expect(200);
    expect(list.body.data[0]).toHaveProperty('score');
  });
});

describe('plot holds', () => {
  it('holds a plot, refuses another executive, and the scheduler releases it when it runs out', async () => {
    const unit = await db.get("SELECT id FROM properties WHERE status = 'Available' ORDER BY id DESC LIMIT 1");
    const held = await sales.post(`/api/properties/${unit.id}/hold`, { days: 3, note: 'Family deciding' }).expect(200);
    expect(held.body.status).toBe('Reserved');
    expect(held.body.hold_by_name).toBeTruthy();
    const other = await as('sales2');
    expect((await other.post(`/api/properties/${unit.id}/hold`, { days: 2 })).status).toBe(409);
    expect((await sales.post(`/api/properties/${unit.id}/hold`, { days: 30 })).status).toBe(422);

    await db.run('UPDATE properties SET hold_until = ? WHERE id = ?', [new Date(Date.now() - 60_000).toISOString(), unit.id]);
    await runScheduledJobs();
    const after = await db.get('SELECT status, hold_until FROM properties WHERE id = ?', [unit.id]);
    expect(after).toMatchObject({ status: 'Available', hold_until: null });
  });

  it('lets the manager release a hold', async () => {
    const unit = await db.get("SELECT id FROM properties WHERE status = 'Available' ORDER BY id DESC LIMIT 1");
    await sales.post(`/api/properties/${unit.id}/hold`, { days: 2 }).expect(200);
    const r = await manager.post(`/api/properties/${unit.id}/release`).expect(200);
    expect(r.body.status).toBe('Available');
  });
});

describe('price list', () => {
  it('records a new rate per block, re-prices unsold units and keeps the history', async () => {
    const u = await db.get("SELECT project, block, area_sqft FROM properties WHERE block IS NOT NULL AND status = 'Available' AND type = 'Plot' LIMIT 1");
    const res = await manager.post('/api/price-list', { project: u.project, block: u.block, rate_per_sqft: 1900, effective_from: T, note: 'Diwali revision' }).expect(201);
    expect(res.body.units_updated).toBeGreaterThan(0);
    const repriced = await db.get("SELECT price, rate_per_sqft FROM properties WHERE project = ? AND block = ? AND status = 'Available' AND area_sqft = ? LIMIT 1", [u.project, u.block, u.area_sqft]);
    expect(repriced).toMatchObject({ rate_per_sqft: 1900, price: 1900 * u.area_sqft });
    const list = await sales.get(`/api/price-list?project=${encodeURIComponent(u.project)}&block=${u.block}`).expect(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
    expect(list.body.meta.current.find((c: { block: string }) => c.block === u.block).rate_per_sqft).toBe(1900);
    await sales.post('/api/price-list', { project: u.project, block: u.block, rate_per_sqft: 1, effective_from: T }).expect(403);
  });
});

describe('refunds', () => {
  it('refunds a cancelled booking with a deduction and a refund receipt', async () => {
    const c = await db.get("SELECT c.id FROM customers c WHERE c.status = 'Cancelled' AND EXISTS (SELECT 1 FROM transactions t WHERE t.customer_id = c.id AND t.status = 'Completed') LIMIT 1");
    const before = await accounts.get(`/api/refunds/customer/${c.id}`).expect(200);
    const open = before.body.meta.open;
    expect(open).toBeGreaterThan(0);
    expect((await accounts.post(`/api/refunds/customer/${c.id}`, { deduction: 50_000, method: 'Bank Transfer', refund_date: T })).status).toBe(422);
    const res = await accounts.post(`/api/refunds/customer/${c.id}`, { deduction: 50_000, deduction_reason: 'Cancellation charges as per agreement', method: 'Bank Transfer', reference: 'NEFT-881', refund_date: T }).expect(201);
    expect(res.body.refund_amount).toBe(open - 50_000);
    expect(res.body.receipt_number).toMatch(/^RF\/\d{4}-\d{2}\/0001$/);
    const pdf = await accounts.get(`/api/refunds/${res.body.id}/receipt.pdf`).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await accounts.post(`/api/refunds/customer/${c.id}`, { method: 'Cash', refund_date: T })).status).toBe(409);
    const active = await db.get("SELECT id FROM customers WHERE status = 'Active' LIMIT 1");
    expect((await accounts.post(`/api/refunds/customer/${active.id}`, { method: 'Cash', refund_date: T })).status).toBe(409);
    await sales.get('/api/refunds').expect(403);
  });
});

describe('feedback and referrals', () => {
  it('records visit ratings, customer ratings, and shows them to the manager only', async () => {
    const v = await db.get(
      "SELECT id FROM site_visits WHERE agent_id = ? AND status = 'Completed' AND id NOT IN (SELECT site_visit_id FROM feedback WHERE site_visit_id IS NOT NULL) LIMIT 1",
      [sales.session.user.id],
    );
    if (v) await sales.post('/api/feedback/site-visit', { site_visit_id: v.id, rating: 2, comment: 'Waited too long' }).expect(201);
    await customer.post('/api/portal/feedback', { kind: 'general', rating: 5, comment: 'Very helpful team' }).expect(201);
    await customer.post('/api/portal/feedback', { kind: 'possession', rating: 4 }).expect(201);
    expect((await customer.post('/api/portal/feedback', { kind: 'possession', rating: 4 })).status).toBe(409);
    expect((await customer.post('/api/portal/feedback', { kind: 'general', rating: 7 })).status).toBe(422);
    const list = await manager.get('/api/feedback').expect(200);
    expect(list.body.meta.summary.length).toBeGreaterThan(0);
    await sales.get('/api/feedback').expect(403);
    const low = await db.get("SELECT COUNT(*) AS n FROM notifications WHERE title LIKE 'Low%rating'");
    expect(low.n).toBeGreaterThan(0);
  });

  it('turns a referral into a lead tagged to the customer and their manager', async () => {
    const res = await customer.post('/api/portal/referrals', { name: 'Deepak Rawat', phone: '+91 90056 11223', note: 'Wants a 1500 sq ft plot' }).expect(201);
    const lead = await db.get('SELECT * FROM leads WHERE id = ?', [res.body.id]);
    const c = await db.get('SELECT assigned_to FROM customers WHERE id = ?', [customer.session.user.customer_id]);
    expect(lead).toMatchObject({ source: 'Referral', referred_by_customer_id: customer.session.user.customer_id, assigned_to: c.assigned_to });
    expect((await customer.post('/api/portal/referrals', { name: 'Again', phone: '+91 90056 11223' })).status).toBe(409);
    const mine = await customer.get('/api/portal/referrals').expect(200);
    expect(mine.body.data.some((l: { id: number }) => l.id === res.body.id)).toBe(true);
    const detail = await manager.get(`/api/leads/${res.body.id}`).expect(200);
    expect(detail.body.referred_by_name).toBeTruthy();
  });
});
