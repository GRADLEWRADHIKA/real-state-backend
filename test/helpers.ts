import request from 'supertest';
import type { ClientKind } from '@estateflow/shared';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/init.js';

export const app = createApp();
let ready: Promise<void> | null = null;

/** Migrates and seeds this file's private demo database once. */
export function setupDb() {
  ready ??= (async () => {
    await migrate();
    const { seedDemoIfEmpty } = await import('../src/db/demo-seed.js');
    await seedDemoIfEmpty();
  })();
  return ready;
}

export const DEMO = {
  admin: ['admin@demo.com', 'Admin@123'],
  manager: ['manager@demo.com', 'Manager@123'],
  sales: ['sales@demo.com', 'Sales@123'],
  sales2: ['priya@demo.com', 'Demo@1234'],
  accounts: ['accounts@demo.com', 'Accounts@123'],
  customer: ['customer@demo.com', 'Customer@123'],
} as const;
export type DemoUser = keyof typeof DEMO;

export async function login(who: DemoUser, client: ClientKind = 'dashboard', remember = false) {
  const [email, password] = DEMO[who];
  const res = await request(app).post('/api/auth/login').set('X-EstateFlow-Client', client).send({ email, password, client, remember });
  if (res.status !== 200) throw new Error(`login ${who} on ${client} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { accessToken: string; refreshToken: string; user: { id: number; role: string; customer_id: number | null } };
}

/** Authenticated request helper bound to one session. */
export async function as(who: DemoUser, client: ClientKind = 'dashboard') {
  const s = await login(who, client);
  const h = (r: request.Test) => r.set('Authorization', `Bearer ${s.accessToken}`).set('X-EstateFlow-Client', client);
  return {
    session: s,
    get: (url: string) => h(request(app).get(url)),
    post: (url: string, body?: object) => h(request(app).post(url)).send(body ?? {}),
    put: (url: string, body?: object) => h(request(app).put(url)).send(body ?? {}),
    patch: (url: string, body?: object) => h(request(app).patch(url)).send(body ?? {}),
    delete: (url: string) => h(request(app).delete(url)),
    upload: (url: string) => h(request(app).post(url)),
  };
}
export type Session = Awaited<ReturnType<typeof as>>;
