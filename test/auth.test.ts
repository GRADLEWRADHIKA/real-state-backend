import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { app, as, login, setupDb } from './helpers.js';

beforeAll(setupDb);

const H = 'X-EstateFlow-Client';

describe('login and client claim', () => {
  it('issues an access + refresh token pair bound to the client', async () => {
    const s = await login('sales', 'app');
    expect(s.accessToken).toBeTruthy();
    expect(s.refreshToken.length).toBeGreaterThan(40);
    expect(s.user.role).toBe('sales');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${s.accessToken}`).set(H, 'app');
    expect(me.status).toBe(200);
    expect(me.body.client).toBe('app');
  });

  it('refuses customers on the dashboard with a clear message', async () => {
    const res = await request(app).post('/api/auth/login').set(H, 'dashboard').send({ email: 'customer@demo.com', password: 'Customer@123', client: 'dashboard' });
    expect(res.status).toBe(403);
    expect(res.body.details.code).toBe('customer_on_dashboard');
    expect(res.body.error).toMatch(/mobile app/i);
  });

  it('allows customers in the app', async () => {
    const s = await login('customer', 'app');
    expect(s.user.customer_id).toBeTruthy();
  });

  it('rejects a token presented by the other client', async () => {
    const s = await login('manager', 'app');
    const res = await request(app).get('/api/leads').set('Authorization', `Bearer ${s.accessToken}`).set(H, 'dashboard');
    expect(res.status).toBe(401);
    expect(res.body.details.code).toBe('wrong_client');
  });

  it('requires the client header on authenticated calls', async () => {
    const s = await login('manager');
    const res = await request(app).get('/api/leads').set('Authorization', `Bearer ${s.accessToken}`);
    expect(res.status).toBe(401);
  });

  it('rejects a mismatched header and body client at login', async () => {
    const res = await request(app).post('/api/auth/login').set(H, 'app').send({ email: 'admin@demo.com', password: 'Admin@123', client: 'dashboard' });
    expect(res.status).toBe(400);
  });

  it('uses one generic message for unknown emails and wrong passwords', async () => {
    const a = await request(app).post('/api/auth/login').set(H, 'dashboard').send({ email: 'nobody@demo.com', password: 'x', client: 'dashboard' });
    const b = await request(app).post('/api/auth/login').set(H, 'dashboard').send({ email: 'admin@demo.com', password: 'wrong', client: 'dashboard' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
    await db.run("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE email = 'admin@demo.com'");
  });

  it('every response carries a request id', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toMatch(/^[\w-]{8,}$/);
    expect(res.body.db).toBe('ok');
  });
});

describe('refresh token rotation', () => {
  it('rotates on refresh and revokes the family when an old token is replayed', async () => {
    const s = await login('accounts', 'dashboard', true);
    const r1 = await request(app).post('/api/auth/refresh').set(H, 'dashboard').send({ refreshToken: s.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);

    // Pretend the replay happens after the concurrent-refresh grace window.
    await db.run("UPDATE refresh_tokens SET revoked_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = (SELECT token_hash FROM refresh_tokens WHERE replaced_by IS NOT NULL ORDER BY id DESC LIMIT 1)");
    const replay = await request(app).post('/api/auth/refresh').set(H, 'dashboard').send({ refreshToken: s.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.details.code).toBe('refresh_reused');

    // The legitimately rotated token is now dead too.
    const r2 = await request(app).post('/api/auth/refresh').set(H, 'dashboard').send({ refreshToken: r1.body.refreshToken });
    expect(r2.status).toBe(401);
  });

  it('treats an immediate second refresh as a superseded race, not theft', async () => {
    const s = await login('accounts', 'app');
    const r1 = await request(app).post('/api/auth/refresh').set(H, 'app').send({ refreshToken: s.refreshToken });
    expect(r1.status).toBe(200);
    const race = await request(app).post('/api/auth/refresh').set(H, 'app').send({ refreshToken: s.refreshToken });
    expect(race.status).toBe(401);
    expect(race.body.details.code).toBe('refresh_superseded');
    const r2 = await request(app).post('/api/auth/refresh').set(H, 'app').send({ refreshToken: r1.body.refreshToken });
    expect(r2.status).toBe(200);
  });

  it('will not refresh a session for a different client', async () => {
    const s = await login('manager', 'app');
    const res = await request(app).post('/api/auth/refresh').set(H, 'dashboard').send({ refreshToken: s.refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.details.code).toBe('wrong_client');
  });

  it('logout revokes the refresh token', async () => {
    const s = await login('manager');
    await request(app).post('/api/auth/logout').send({ refreshToken: s.refreshToken }).expect(200);
    const res = await request(app).post('/api/auth/refresh').set(H, 'dashboard').send({ refreshToken: s.refreshToken });
    expect(res.status).toBe(401);
  });

  it('logout-all invalidates outstanding access tokens', async () => {
    const s = await as('manager');
    await s.post('/api/auth/logout-all').expect(200);
    const res = await s.get('/api/leads');
    expect(res.status).toBe(401);
    expect(res.body.details.code).toBe('revoked');
  });
});

describe('lockout', () => {
  it('locks the account after repeated failures and tells the admin', async () => {
    const email = 'arjun@demo.com';
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').set(H, 'app').send({ email, password: 'nope', client: 'app' });
    }
    const locked = await request(app).post('/api/auth/login').set(H, 'app').send({ email, password: 'Demo@1234', client: 'app' });
    expect(locked.status).toBe(423);
    expect(locked.body.details.code).toBe('locked');
    const note = await db.get("SELECT * FROM notifications WHERE title = 'Account locked' ORDER BY id DESC LIMIT 1");
    expect(note.message).toContain(email);

    const admin = await as('admin');
    const user = await db.get<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
    await admin.post(`/api/users/${user!.id}/unlock`).expect(200);
    const ok = await request(app).post('/api/auth/login').set(H, 'app').send({ email, password: 'Demo@1234', client: 'app' });
    expect(ok.status).toBe(200);
  });
});

describe('admin-issued reset codes', () => {
  it('forgot-password creates a request; the admin issues a one-time code; the code sets a new password once', async () => {
    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: 'sneha@demo.com' });
    expect(forgot.status).toBe(200);
    // Unknown emails get the same answer.
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@demo.com' });
    expect(unknown.body.message).toBe(forgot.body.message);

    const manager = await as('manager');
    const list = await manager.get('/api/users/reset-requests').expect(200);
    const reqRow = list.body.data.find((r: any) => r.email === 'sneha@demo.com' && r.status === 'Pending');
    expect(reqRow).toBeTruthy();
    const issued = await manager.post(`/api/users/reset-requests/${reqRow.id}/issue`).expect(200);
    expect(issued.body.code).toMatch(/^[A-Z2-9]{8}$/);

    const stored = await db.get('SELECT code_hash FROM password_reset_requests WHERE id = ?', [reqRow.id]);
    expect(stored.code_hash).not.toContain(issued.body.code);

    const bad = await request(app).post('/api/auth/reset-password').send({ email: 'sneha@demo.com', code: 'WRONG123', new_password: 'Fresh@2026' });
    expect(bad.status).toBe(422);
    const good = await request(app).post('/api/auth/reset-password').send({ email: 'sneha@demo.com', code: issued.body.code.toLowerCase(), new_password: 'Fresh@2026' });
    expect(good.status).toBe(200);
    const again = await request(app).post('/api/auth/reset-password').send({ email: 'sneha@demo.com', code: issued.body.code, new_password: 'Other@2026' });
    expect(again.status).toBe(422);
    const signin = await request(app).post('/api/auth/login').set(H, 'app').send({ email: 'sneha@demo.com', password: 'Fresh@2026', client: 'app' });
    expect(signin.status).toBe(200);
  });

  it('managers cannot reset administrator passwords', async () => {
    const manager = await as('manager');
    const admin = await db.get<{ id: number }>("SELECT id FROM users WHERE email = 'admin@demo.com'");
    const res = await manager.post(`/api/users/${admin!.id}/issue-reset`);
    expect(res.status).toBe(403);
  });

  it('sales executives cannot see reset requests', async () => {
    const sales = await as('sales');
    expect((await sales.get('/api/users/reset-requests')).status).toBe(403);
  });
});

describe('password change', () => {
  it('enforces the password policy and ends other sessions', async () => {
    const other = await as('sales2', 'app');
    const s = await as('sales2', 'dashboard');
    const weak = await s.put('/api/auth/password', { current_password: 'Demo@1234', new_password: 'short' });
    expect(weak.status).toBe(422);
    const ok = await s.put('/api/auth/password', { current_password: 'Demo@1234', new_password: 'Better@2026' });
    expect(ok.status).toBe(200);
    expect(ok.body.session.accessToken).toBeTruthy();
    expect((await other.get('/api/leads')).status).toBe(401);
    await db.run("UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE email = 'arjun@demo.com') WHERE email = 'priya@demo.com'");
  });
});
