import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error.js';
import { rateLimit } from '../src/middleware/rateLimit.js';

describe('rate limiter', () => {
  it('returns 429 with Retry-After once the window is used up', async () => {
    const app = express();
    app.use(rateLimit({ name: 't', windowMs: 60_000, max: 2 }));
    app.get('/', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    await request(app).get('/').expect(200);
    await request(app).get('/').expect(200);
    const res = await request(app).get('/');
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});
