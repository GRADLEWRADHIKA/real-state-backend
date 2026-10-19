import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, as, setupDb } from './helpers.js';
import { db } from '../src/db/index.js';

process.env.FORM_MIN_FILL_MS = '0';
// The website is part of the dashboard, so it calls the public API from the dashboard's origin.
const ORIGIN = 'http://localhost:7340';
beforeAll(setupDb);

const token = async () => (await request(app).get('/api/public/form-token').set('Origin', ORIGIN)).body.token as string;

describe('public website API', () => {
  it('lists only published properties and allows only the CRM origins', async () => {
    const res = await request(app).get('/api/public/properties?limit=48').set('Origin', ORIGIN);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    const unpublished = (await db.all<{ slug: string }>('SELECT slug FROM properties WHERE is_published = 0')).map((r) => r.slug);
    expect(unpublished.length).toBeGreaterThan(0);
    expect(res.body.data.some((p: any) => unpublished.includes(p.slug))).toBe(false);
    expect(res.body.data[0]).not.toHaveProperty('agent_name');
    // Other origins get exactly what the rest of the API gives them (CORS_ORIGINS; demo mode is open).
    const evil = await request(app).get('/api/public/properties').set('Origin', 'https://evil.example');
    const evilApi = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBe(evilApi.headers['access-control-allow-origin']);
    expect((await request(app).get(`/api/public/properties/${unpublished[0]}`)).status).toBe(404);
  });

  it('turns an enquiry into a website lead visible to staff, and rejects the honeypot', async () => {
    const slug = (await db.get<{ slug: string }>("SELECT slug FROM properties WHERE is_published = 1 AND type = 'Villa' LIMIT 1"))!.slug;
    const ok = await request(app).post('/api/public/enquiries').set('Origin', ORIGIN).send({ name: 'Website Visitor', phone: '+91 90000 11122', message: 'Is the villa east facing?', property_slug: slug, token: await token(), website: '' });
    expect(ok.status).toBe(201);
    const manager = await as('manager');
    const leads = await manager.get('/api/leads?q=Website Visitor');
    expect(leads.body.data[0]).toMatchObject({ name: 'Website Visitor', source: 'Website' });

    // Same phone again: merged into the existing lead, not duplicated.
    const again = await request(app).post('/api/public/site-visit-requests').set('Origin', ORIGIN).send({ name: 'Website Visitor', phone: '9000011122', preferred_date: '2026-12-01', token: await token() });
    expect(again.status).toBe(200);
    expect((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM leads WHERE name = 'Website Visitor'"))!.n).toBe(1);

    const bot = await request(app).post('/api/public/enquiries').set('Origin', ORIGIN).send({ name: 'Bot', phone: '+91 90000 99999', token: await token(), website: 'http://spam.example' });
    expect(bot.status).toBe(422);
    const reused = await token();
    await request(app).post('/api/public/enquiries').send({ name: 'Once Only', phone: '+91 90000 55555', token: reused });
    expect((await request(app).post('/api/public/enquiries').send({ name: 'Twice', phone: '+91 90000 55556', token: reused })).status).toBe(422);
    expect((await request(app).post('/api/public/enquiries').send({ name: 'No token', phone: '+91 90000 55557' })).status).toBe(422);
    expect((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM leads WHERE name IN ('Bot', 'Twice', 'No token')"))!.n).toBe(0);
  });
});
