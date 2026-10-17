import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { as, setupDb, type Session } from './helpers.js';

let admin: Session, manager: Session, sales: Session, accounts: Session, customer: Session, adminApp: Session, salesApp: Session;
let salesId: number;
let otherLead: number, ownLead: number, otherCustomer: number, ownCustomer: number;

beforeAll(async () => {
  await setupDb();
  [admin, manager, sales, accounts, customer, adminApp, salesApp] = await Promise.all([
    as('admin'),
    as('manager'),
    as('sales'),
    as('accounts'),
    as('customer', 'app'),
    as('admin', 'app'),
    as('sales', 'app'),
  ]);
  salesId = sales.session.user.id;
  ownLead = (await db.get('SELECT id FROM leads WHERE assigned_to = ? LIMIT 1', [salesId])).id;
  otherLead = (await db.get('SELECT id FROM leads WHERE assigned_to != ? LIMIT 1', [salesId])).id;
  ownCustomer = (await db.get('SELECT id FROM customers WHERE assigned_to = ? LIMIT 1', [salesId])).id;
  otherCustomer = (await db.get('SELECT id FROM customers WHERE assigned_to != ? LIMIT 1', [salesId])).id;
});

const status = async (s: Session, method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, body?: object) =>
  (await (method === 'get' || method === 'delete' ? s[method](url) : s[method](url, body ?? {}))).status;

describe('route access matrix', () => {
  // [path, roles that may GET it]
  const MATRIX: [string, ('admin' | 'manager' | 'sales' | 'accounts' | 'customer')[]][] = [
    ['/api/dashboard', ['admin', 'manager', 'sales']],
    ['/api/dashboard/today', ['admin', 'manager', 'sales', 'accounts']],
    ['/api/leads', ['admin', 'manager', 'sales']],
    ['/api/customers', ['admin', 'manager', 'sales', 'accounts']],
    ['/api/deals', ['admin', 'manager', 'sales', 'accounts']],
    ['/api/properties', ['admin', 'manager', 'sales', 'accounts']],
    ['/api/site-visits', ['admin', 'manager', 'sales']],
    ['/api/followups', ['admin', 'manager', 'sales']],
    ['/api/tasks', ['admin', 'manager', 'sales', 'accounts']],
    ['/api/finance/summary', ['admin', 'accounts']],
    ['/api/transactions', ['admin', 'accounts']],
    ['/api/installments', ['admin', 'accounts']],
    ['/api/documents', ['admin', 'manager', 'sales', 'accounts']],
    ['/api/reports', ['admin', 'manager', 'accounts']],
    ['/api/users', ['admin']],
    ['/api/users/directory', ['admin', 'manager', 'sales', 'accounts']],
    ['/api/audit', ['admin']],
    ['/api/customer-requests', ['admin', 'manager', 'sales', 'accounts']],
    ['/api/portal', ['customer']],
    ['/api/search?q=green', ['admin', 'manager', 'sales', 'accounts']],
    ['/api/notifications', ['admin', 'manager', 'sales', 'accounts', 'customer']],
    ['/api/settings', ['admin', 'manager', 'sales', 'accounts', 'customer']],
  ];
  for (const [path, allowed] of MATRIX) {
    it(`GET ${path}`, async () => {
      const sessions = { admin, manager, sales, accounts, customer };
      for (const [role, s] of Object.entries(sessions)) {
        const code = await status(s, 'get', path);
        expect([role, code]).toEqual([role, allowed.includes(role as never) ? 200 : 403]);
      }
    });
  }
});

describe('sales executives only see their own book', () => {
  it('lead list contains only their leads', async () => {
    const res = await sales.get('/api/leads?limit=500').expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((l: any) => l.assigned_to === salesId)).toBe(true);
    expect(res.body.meta.total).toBe(res.body.data.length);
  });

  it('cannot open, edit or log against another executive’s lead', async () => {
    expect(await status(sales, 'get', `/api/leads/${otherLead}`)).toBe(403);
    expect(await status(sales, 'patch', `/api/leads/${otherLead}/status`, { status: 'Contacted' })).toBe(403);
    expect(await status(sales, 'post', `/api/leads/${otherLead}/notes`, { note: 'x' })).toBe(403);
    expect(await status(sales, 'get', `/api/leads/${ownLead}`)).toBe(200);
  });

  it('customers and deals are scoped', async () => {
    const list = await sales.get('/api/customers?limit=500').expect(200);
    expect(list.body.data.every((c: any) => c.assigned_to === salesId)).toBe(true);
    expect(await status(sales, 'get', `/api/customers/${otherCustomer}`)).toBe(403);
    expect(await status(sales, 'get', `/api/customers/${ownCustomer}`)).toBe(200);
    const deals = await sales.get('/api/deals?limit=500').expect(200);
    expect(deals.body.data.every((d: any) => d.agent_id === salesId)).toBe(true);
  });

  it('property detail does not leak other executives’ visits or leads', async () => {
    const prop = await db.get(
      'SELECT p.id FROM properties p WHERE EXISTS (SELECT 1 FROM site_visits v WHERE v.property_id = p.id AND v.agent_id != ?) LIMIT 1',
      [salesId],
    );
    const res = await sales.get(`/api/properties/${prop.id}`).expect(200);
    for (const v of res.body.visits ?? []) expect(v.agent_id).toBe(salesId);
    for (const l of res.body.leads ?? []) expect(l.assigned_to).toBe(salesId);
  });

  it('task list never names someone else’s lead', async () => {
    const res = await sales.get('/api/tasks?limit=500').expect(200);
    const own = new Set((await db.all('SELECT id FROM leads WHERE assigned_to = ?', [salesId])).map((r: any) => r.id));
    for (const t of res.body.data) if (t.lead_id) expect(own.has(t.lead_id)).toBe(true);
  });

  it('cannot attach a task to someone else’s lead', async () => {
    expect(await status(sales, 'post', '/api/tasks', { title: 'Peek', lead_id: otherLead, priority: 'Low' })).toBe(403);
  });

  it('visits and follow-ups are scoped', async () => {
    const v = await sales.get('/api/site-visits?limit=500').expect(200);
    expect(v.body.data.every((x: any) => x.agent_id === salesId)).toBe(true);
    const f = await sales.get('/api/followups?limit=500').expect(200);
    expect(f.body.data.every((x: any) => x.agent_id === salesId)).toBe(true);
  });

  it('dashboard hides the leaderboard from sales but not from managers', async () => {
    expect((await sales.get('/api/dashboard').expect(200)).body.leaderboard).toBeNull();
    expect(Array.isArray((await manager.get('/api/dashboard').expect(200)).body.leaderboard)).toBe(true);
  });

  it('search is scoped', async () => {
    const other = await db.get('SELECT name FROM leads WHERE id = ?', [otherLead]);
    const res = await sales.get(`/api/search?q=${encodeURIComponent(other.name)}`).expect(200);
    expect(res.body.leads.find((l: any) => l.id === otherLead)).toBeUndefined();
  });

  it('customer requests are limited to their customers', async () => {
    const res = await sales.get('/api/customer-requests').expect(200);
    const own = new Set((await db.all('SELECT id FROM customers WHERE assigned_to = ?', [salesId])).map((r: any) => r.id));
    expect(res.body.data.every((r: any) => own.has(r.customer_id))).toBe(true);
  });
});

describe('accounts', () => {
  it('cannot reach leads or lead documents', async () => {
    expect(await status(accounts, 'get', `/api/leads/${ownLead}`)).toBe(403);
    const leadDoc = await db.get("SELECT id FROM documents WHERE entity_type = 'lead' LIMIT 1");
    expect(await status(accounts, 'get', `/api/documents/${leadDoc.id}/download`)).toBe(403);
  });
  it('sees only payment requests from customers', async () => {
    const res = await accounts.get('/api/customer-requests').expect(200);
    expect(res.body.data.every((r: any) => r.type === 'Payment')).toBe(true);
  });
  it('report sections exclude the sales funnel', async () => {
    const res = await accounts.get('/api/reports').expect(200);
    expect(res.body.sections).toContain('aging');
    expect(res.body.sections).not.toContain('agents');
  });
});

describe('managers', () => {
  it('report sections exclude money collected', async () => {
    const res = await manager.get('/api/reports').expect(200);
    expect(res.body.sections).toContain('agents');
    expect(res.body.sections).not.toContain('revenue');
    expect((await manager.get('/api/reports/export?section=revenue')).status).toBe(404);
  });
});

describe('customers', () => {
  it('only ever see their own record', async () => {
    const res = await customer.get('/api/portal').expect(200);
    expect(res.body.customer.id).toBe(customer.session.user.customer_id);
    const otherTxn = await db.get('SELECT id FROM transactions WHERE customer_id != ? LIMIT 1', [customer.session.user.customer_id]);
    expect(await status(customer, 'get', `/api/transactions/${otherTxn.id}`)).toBe(403);
    expect(await status(customer, 'get', `/api/transactions/${otherTxn.id}/receipt.pdf`)).toBe(403);
    const otherDoc = await db.get("SELECT id FROM documents WHERE entity_type = 'customer' AND entity_id != ? LIMIT 1", [customer.session.user.customer_id]);
    expect(await status(customer, 'get', `/api/documents/${otherDoc.id}/download`)).toBe(403);
  });
  it('can download their own receipt as a PDF', async () => {
    const own = await db.get("SELECT id FROM transactions WHERE customer_id = ? AND status = 'Completed' LIMIT 1", [customer.session.user.customer_id]);
    const res = await customer.get(`/api/transactions/${own.id}/receipt.pdf`).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  });
  it('can raise a request that reaches their executive', async () => {
    const res = await customer.post('/api/portal/requests', { type: 'Query', subject: 'Registry charges', message: 'What are the registry charges?' });
    expect(res.status).toBe(201);
    const agent = await db.get('SELECT assigned_to FROM customers WHERE id = ?', [customer.session.user.customer_id]);
    const n = await db.get("SELECT * FROM notifications WHERE user_id = ? AND title LIKE 'Query request%' ORDER BY id DESC", [agent.assigned_to]);
    expect(n.message).toBe('Registry charges');
  });
});

describe('admin in the app is read-mostly', () => {
  it('can read but not write business records', async () => {
    expect(await status(adminApp, 'get', '/api/leads')).toBe(200);
    const res = await adminApp.post('/api/leads', { name: 'App Admin Lead', phone: '+91 90000 11111', source: 'Website' });
    expect(res.status).toBe(403);
    expect(res.body.details.code).toBe('dashboard_only');
  });
  it('cannot change settings or users from the app', async () => {
    expect(await status(adminApp, 'put', '/api/settings/security', { session_hours: 8, password_min_length: 8, enforce_strong_passwords: true })).toBe(403);
    expect(await status(adminApp, 'post', `/api/users/${salesId}/force-logout`)).toBe(403);
  });
  it('can still issue reset codes and read notifications', async () => {
    expect(await status(adminApp, 'post', '/api/notifications/read-all')).toBe(200);
  });
});

describe('dashboard-only operations', () => {
  it('lead export and bulk delete are refused from the app', async () => {
    const managerApp = await as('manager', 'app');
    expect(await status(managerApp, 'get', '/api/leads/export.csv')).toBe(403);
    expect(await status(managerApp, 'post', '/api/leads/bulk-delete', { ids: [otherLead] })).toBe(403);
    expect(await status(salesApp, 'get', '/api/leads')).toBe(200);
  });
});
