import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fmtTime, todayStr } from '@estateflow/shared';
import { config } from '../src/config.js';
import { db } from '../src/db/index.js';
import { runScheduledJobs } from '../src/services/scheduler.js';
import { app, as, setupDb, type Session } from './helpers.js';

let admin: Session, sales: Session, customer: Session;
beforeAll(async () => {
  await setupDb();
  [admin, sales, customer] = await Promise.all([as('admin'), as('sales', 'app'), as('customer', 'app')]);
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);

describe('upload hardening', () => {
  let leadId: number;
  beforeAll(async () => {
    leadId = (await db.get('SELECT id FROM leads WHERE assigned_to = ? LIMIT 1', [sales.session.user.id])).id;
  });

  it('accepts a real PDF and serves it back with safe headers', async () => {
    const res = await sales.upload('/api/documents').field('entity_type', 'lead').field('entity_id', String(leadId)).field('doc_type', 'Requirement').attach('file', PDF, { filename: 'brief.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    const dl = await sales.get(`/api/documents/${res.body.id}/download`).expect(200);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
    expect(dl.headers['cache-control']).toMatch(/no-store/);
    const stored = await db.get('SELECT file_name FROM documents WHERE id = ?', [res.body.id]);
    expect(stored.file_name).not.toContain('brief');
  });

  it('refuses an executable renamed to .pdf', async () => {
    const res = await sales.upload('/api/documents').field('entity_type', 'lead').field('entity_id', String(leadId)).field('doc_type', 'Requirement').attach('file', EXE, { filename: 'invoice.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(415);
  });

  it('refuses a disallowed extension', async () => {
    const res = await sales.upload('/api/documents').field('entity_type', 'lead').field('entity_id', String(leadId)).field('doc_type', 'Requirement').attach('file', EXE, { filename: 'setup.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBe(415);
  });

  it('refuses a file over the size limit', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(config.uploadMaxBytes + 10)]);
    const res = await sales.upload('/api/documents').field('entity_type', 'lead').field('entity_id', String(leadId)).field('doc_type', 'Requirement').attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(413);
  });

  it('does not let sales attach files to someone else’s lead', async () => {
    const other = (await db.get('SELECT id FROM leads WHERE assigned_to != ? LIMIT 1', [sales.session.user.id])).id;
    const res = await sales.upload('/api/documents').field('entity_type', 'lead').field('entity_id', String(other)).field('doc_type', 'Requirement').attach('file', PDF, { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(403);
  });

  it('customers upload KYC to their own record only', async () => {
    const res = await customer.upload('/api/portal/documents').field('doc_type', 'PAN').attach('file', PNG, { filename: 'pan.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    const row = await db.get('SELECT entity_type, entity_id FROM documents WHERE id = ?', [res.body.id]);
    expect(row).toEqual({ entity_type: 'customer', entity_id: customer.session.user.customer_id });
    const wrongType = await customer.upload('/api/portal/documents').field('doc_type', 'Agreement').attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(wrongType.status).toBe(422);
  });
});

describe('website lead capture', () => {
  let key: string;
  it('is off until a key is generated in Settings', async () => {
    const res = await request(app).post('/api/public/leads').set('X-Api-Key', 'efk_nope').send({ name: 'Web Visitor', phone: '+91 95550 12345' });
    expect(res.status).toBe(403);
  });

  it('generates a key once and stores only its hash', async () => {
    const res = await admin.post('/api/settings/lead_capture/key').expect(201);
    key = res.body.key;
    expect(key).toMatch(/^efk_/);
    const settings = await admin.get('/api/settings').expect(200);
    expect(settings.body.lead_capture.key_hash).toBeUndefined();
    expect(settings.body.lead_capture.key_prefix).toBe(key.slice(0, 10));
    const raw = await db.get("SELECT value FROM settings WHERE key = 'lead_capture'");
    expect(raw.value).not.toContain(key);
  });

  it('creates and round-robin assigns a lead with a valid key', async () => {
    const bad = await request(app).post('/api/public/leads').set('X-Api-Key', 'efk_wrong').send({ name: 'Web Visitor', phone: '+91 95550 12345' });
    expect(bad.status).toBe(401);
    const ok = await request(app).post('/api/public/leads').set('X-Api-Key', key).set('Origin', 'https://www.example-builder.in').send({ name: 'Web Visitor', phone: '+91 95550 12345', campaign: 'Diwali offer' });
    expect(ok.status).toBe(201);
    expect(ok.headers['access-control-allow-origin']).toBe('https://www.example-builder.in');
    const lead = await db.get("SELECT * FROM leads WHERE name = 'Web Visitor'");
    expect(lead.source).toBe('Website');
    expect(lead.source_detail).toBe('Diwali offer');
    expect(lead.assigned_to).toBeTruthy();
  });

  it('adds repeat enquiries to the existing lead instead of duplicating', async () => {
    const res = await request(app).post('/api/public/leads').set('X-Api-Key', key).send({ name: 'Web Visitor Again', phone: '95550 12345', message: 'Any villas left?' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('merged');
    expect((await db.get("SELECT COUNT(*) AS n FROM leads WHERE phone_norm = '9555012345'")).n).toBe(1);
  });

  it('revoking the key stops capture', async () => {
    await admin.delete('/api/settings/lead_capture/key').expect(200);
    const res = await request(app).post('/api/public/leads').set('X-Api-Key', key).send({ name: 'Late Visitor', phone: '+91 95550 99999' });
    expect(res.status).toBe(403);
  });
});

describe('customer request inbox and targets', () => {
  it('filters to open requests while tab counts cover every status', async () => {
    const all = await admin.get('/api/customer-requests');
    const open = await admin.get('/api/customer-requests?state=open');
    const resolved = await admin.get('/api/customer-requests?status=Resolved');
    expect(open.status).toBe(200);
    expect(open.body.data.every((r: any) => r.status === 'Open' || r.status === 'In Progress')).toBe(true);
    expect(resolved.body.data.every((r: any) => r.status === 'Resolved')).toBe(true);
    expect(resolved.body.meta.statusCounts).toEqual(all.body.meta.statusCounts);
  });

  it('stores monthly targets and shows them on the dashboard to managers but not sales', async () => {
    const saved = await admin.put('/api/settings/targets').send({ monthly_collections: 5_000_000, monthly_bookings: 20_000_000 });
    expect(saved.status).toBe(200);
    expect((await admin.get('/api/dashboard')).body.targets).toEqual({ monthly_collections: 5_000_000, monthly_bookings: 20_000_000 });
    expect((await sales.get('/api/dashboard')).body.targets).toBeNull();
    expect((await admin.put('/api/settings/targets').send({ monthly_collections: -1, monthly_bookings: 0 })).status).toBe(422);
  });
});

describe('scheduler', () => {
  it('sends each reminder once, however often it runs', async () => {
    const lead = (await db.get('SELECT id FROM leads WHERE assigned_to = ? LIMIT 1', [sales.session.user.id])).id;
    const soon = new Date(Date.now() + 30 * 60_000);
    const hhmm = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
    if (soon.toDateString() !== new Date().toDateString()) return; // too close to midnight for a same-day reminder
    const f = await db.insert('followups', { lead_id: lead, agent_id: sales.session.user.id, due_date: todayStr(), due_time: hhmm, type: 'Call', status: 'Pending', created_at: new Date().toISOString() });
    await runScheduledJobs();
    await runScheduledJobs();
    const sent = await db.all("SELECT * FROM reminder_log WHERE kind = 'followup' AND ref_id = ?", [f]);
    expect(sent).toHaveLength(1);
    // Match this follow-up's own reminder: seeded follow-ups due within the hour get reminders of their own.
    const notes = await db.all('SELECT * FROM notifications WHERE user_id = ? AND title = ? AND link = ? AND created_at > ?', [sales.session.user.id, `Call at ${fmtTime(hhmm)}`, `/leads/${lead}`, new Date(Date.now() - 60_000).toISOString()]);
    expect(notes.length).toBe(1);
  });

  it('flags overdue follow-ups once', async () => {
    const lead = (await db.get('SELECT id FROM leads WHERE assigned_to = ? LIMIT 1', [sales.session.user.id])).id;
    const f = await db.insert('followups', { lead_id: lead, agent_id: sales.session.user.id, due_date: '2020-01-01', due_time: '10:00', type: 'Call', status: 'Pending', created_at: new Date().toISOString() });
    await runScheduledJobs();
    await runScheduledJobs();
    expect((await db.get('SELECT overdue_at FROM followups WHERE id = ?', [f])).overdue_at).toBeTruthy();
    expect(await db.all("SELECT * FROM reminder_log WHERE kind = 'followup_overdue' AND ref_id = ?", [f])).toHaveLength(1);
  });
});

describe('audit log', () => {
  it('records writes with actor, IP and request id', async () => {
    const res = await admin.post('/api/tasks', { title: 'Audit me please', priority: 'Low' }).set('X-Request-Id', 'test-audit-req-1').expect(201);
    await new Promise((r) => setTimeout(r, 50));
    const log = await admin.get('/api/audit?q=task').expect(200);
    const row = log.body.data.find((a: any) => a.request_id === 'test-audit-req-1');
    expect(row).toMatchObject({ user_id: admin.session.user.id, entity_type: 'task', entity_id: res.body.id });
    expect(row.action).toBe('POST /tasks');
    const csv = await admin.get('/api/audit/export.csv').expect(200);
    expect(csv.text).toContain('test-audit-req-1');
  });
});

describe('server-sent events', () => {
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = (server.address() as any).port;
  });
  afterAll(() => server.close());

  it('pushes a change event to staff when a record changes', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { Authorization: `Bearer ${sales.session.accessToken}`, 'X-EstateFlow-Client': 'app' },
      signal: ctrl.signal,
    });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const until = async (re: RegExp) => {
      while (!re.test(buf)) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value);
      }
    };
    await until(/event: hello/);
    const manager = await as('manager');
    await manager.post('/api/tasks', { title: 'Realtime ping', priority: 'Low' }).expect(201);
    await until(/event: change[\s\S]*"tasks"/);
    expect(buf).toMatch(/"resources":\["tasks"\]/);
    ctrl.abort();
  });
});

describe('production process', () => {
  const base = { ...process.env, APP_MODE: 'production', NODE_ENV: 'production', VITEST: '', JWT_SECRET: 'x'.repeat(40), LOG_LEVEL: 'error' };

  it('refuses to start on a demo database', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', path.resolve('src/index.ts')], { env: { ...base, DATABASE_FILE: config.dbFile }, encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/contains demo data/);
  });

  it('starts empty and only allows listed CORS origins', async () => {
    const port = 7600 + Math.floor(Math.random() * 300);
    const dir = path.dirname(config.dbFile);
    const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('src/index.ts')], {
      env: { ...base, PORT: String(port), DATABASE_FILE: path.join(dir, 'prod.db'), UPLOAD_DIR: path.join(dir, 'prod-uploads'), ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'Owner@2026x', CORS_ORIGINS: 'https://crm.example.com' },
      stdio: 'ignore',
    });
    try {
      let up = false;
      for (let i = 0; i < 100 && !up; i++) {
        up = await fetch(`http://127.0.0.1:${port}/api/health`).then(
          (r) => r.ok,
          () => false,
        );
        if (!up) await new Promise((r) => setTimeout(r, 200));
      }
      expect(up).toBe(true);
      const meta = await (await fetch(`http://127.0.0.1:${port}/api/meta`)).json();
      expect(meta.mode).toBe('production');
      const evil = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Origin: 'https://evil.example' } });
      expect(evil.headers.get('access-control-allow-origin')).toBeNull();
      const good = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Origin: 'https://crm.example.com' } });
      expect(good.headers.get('access-control-allow-origin')).toBe('https://crm.example.com');
      const cap = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Origin: 'https://localhost' } });
      expect(cap.headers.get('access-control-allow-origin')).toBe('https://localhost');
      // Empty: no demo logins exist.
      const demo = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EstateFlow-Client': 'dashboard' },
        body: JSON.stringify({ email: 'admin@demo.com', password: 'Admin@123', client: 'dashboard' }),
      });
      expect(demo.status).toBe(401);
    } finally {
      child.kill('SIGTERM');
    }
  });
});
