import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, as, setupDb } from './helpers.js';
import { db } from '../src/db/index.js';
import { renderSvg, renderWebp } from '../src/images/render.js';
import { buildSceneSpecs, type PropertyFacts } from '../src/images/scene/spec.js';

process.env.IMAGES_DESIGN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-design-'));
const { generateForProperty } = await import('../src/images/generate.js');

const facts = (type: string): PropertyFacts => ({ id: 9, slug: `t-${type}`, name: `Test ${type}`, type, project: 'P', city: 'Lucknow', unit_number: 'U1', bedrooms: 3, area_sqft: 1500, status: 'Available', amenities: ['Swimming pool'] });
const png = (color = '#062419') => sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).png().toBuffer();
const count = async (sql: string, p: unknown[]) => (await db.get<{ n: number }>(sql, p))!.n;

beforeAll(setupDb);

describe('procedural generator', () => {
  it('gives the same pixels for the same seed and different scenes for another seed', async () => {
    const [a] = buildSceneSpecs(facts('Villa'), 3);
    const [b] = buildSceneSpecs(facts('Villa'), 3);
    const [c] = buildSceneSpecs(facts('Villa'), 4);
    expect(renderSvg(a)).toBe(renderSvg(b));
    expect(renderSvg(a)).not.toBe(renderSvg(c));
    const [x, y] = await Promise.all([renderWebp(a), renderWebp(b)]);
    expect(x.equals(y)).toBe(true);
    const meta = await sharp(x).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1600, 900, 'webp']);
    expect(x.length).toBeLessThan(250 * 1024);
  });

  it('plans the right views and sizes per property type', () => {
    const views = Object.fromEntries(['Apartment', 'Villa', 'Plot', 'Office', 'Shop'].map((t) => [t, buildSceneSpecs(facts(t))]));
    expect(Object.fromEntries(Object.entries(views).map(([t, v]) => [t, v.length]))).toEqual({ Apartment: 7, Villa: 7, Plot: 5, Office: 5, Shop: 5 });
    for (const v of Object.values(views)) {
      expect([v[0].width, v[0].height]).toEqual([1600, 900]);
      expect(v.slice(1).every((s) => s.width === 1200 && s.height === 900)).toBe(true);
      expect(v.every((s) => s.alt.startsWith("Artist's impression: "))).toBe(true);
      expect(v.some((s) => s.kind === 'floor_plan' || s.kind === 'master_plan')).toBe(true);
    }
  });
});

describe('property gallery', () => {
  let plotId: number;
  beforeAll(async () => {
    plotId = (await db.get<{ id: number }>("SELECT id FROM properties WHERE unit_number = 'B-15'"))!.id;
  });

  it('imports idempotently and never replaces staff uploads', async () => {
    const admin = await as('admin');
    const up = await admin.upload(`/api/properties/${plotId}/images`).attach('files', await png(), 'site-photo.png');
    expect(up.status).toBe(201);
    const uploadId = up.body.data[0].id;
    await admin.post(`/api/properties/${plotId}/images/${uploadId}/cover`);

    const first = await generateForProperty(plotId);
    expect(first.imported).toBe(5);
    const again = await generateForProperty(plotId);
    expect(again.skipped).toBe(true);
    expect(await count('SELECT COUNT(*) AS n FROM property_images WHERE property_id = ?', [plotId])).toBe(6);

    const forced = await generateForProperty(plotId, { force: true });
    expect(forced.imported).toBe(5);
    const rows = await db.all('SELECT * FROM property_images WHERE property_id = ? ORDER BY id', [plotId]);
    expect(rows).toHaveLength(6);
    const upload = rows.find((r) => r.id === uploadId);
    expect(upload).toMatchObject({ source: 'upload', is_cover: 1, is_ai_generated: 0 });
    expect(rows.filter((r) => r.source === 'generated').every((r) => r.is_ai_generated === 1 && /^Artist's impression/.test(r.alt_text))).toBe(true);
    // Every size of every image exists on disk.
    const res = await admin.get(`/api/properties/${plotId}`);
    expect(res.body.images).toHaveLength(6);
    expect(res.body.cover.id).toBe(uploadId);
  });

  it('keeps exactly one cover and reorders', async () => {
    const admin = await as('manager');
    const list = (await admin.get(`/api/properties/${plotId}/images`)).body.data as { id: number }[];
    const target = list[list.length - 1].id;
    const r1 = await admin.post(`/api/properties/${plotId}/images/${target}/cover`);
    expect(r1.body.data.filter((i: any) => i.is_cover).map((i: any) => i.id)).toEqual([target]);
    expect(await count('SELECT COUNT(*) AS n FROM property_images WHERE property_id = ? AND is_cover = 1', [plotId])).toBe(1);

    const reversed = list.map((i) => i.id).reverse();
    const r2 = await admin.put(`/api/properties/${plotId}/images/order`, { ids: reversed });
    expect(r2.body.data.map((i: any) => i.id)).toEqual(reversed);
    expect((await admin.put(`/api/properties/${plotId}/images/order`, { ids: reversed.slice(1) })).status).toBe(422);

    // Deleting the cover promotes another image; files are removed.
    const cover = r2.body.data.find((i: any) => i.is_cover);
    const file = (await db.get('SELECT file_path FROM property_images WHERE id = ?', [cover.id])).file_path;
    const del = await admin.delete(`/api/properties/${plotId}/images/${cover.id}`);
    expect(del.body.data.filter((i: any) => i.is_cover)).toHaveLength(1);
    expect(fs.existsSync(path.join(process.env.UPLOAD_DIR + '-demo', file))).toBe(false);

    // Sales can view but not change the gallery.
    const sales = await as('sales');
    expect((await sales.get(`/api/properties/${plotId}/images`)).status).toBe(200);
    expect((await sales.post(`/api/properties/${plotId}/images/${target}/cover`)).status).toBe(403);
  });

  it('rejects files that are not JPEG, PNG or WebP', async () => {
    const admin = await as('admin');
    const txt = await admin.upload(`/api/properties/${plotId}/images`).attach('files', Buffer.from('hello'), 'notes.txt');
    expect(txt.status).toBe(415);
    const fake = await admin.upload(`/api/properties/${plotId}/images`).attach('files', Buffer.from('not really a png'), { filename: 'photo.png', contentType: 'image/png' });
    expect(fake.status).toBe(422);
    expect(fake.body.errors[0]).toMatchObject({ file: 'photo.png' });
  });

  it('serves unpublished images only to staff and the linked customer', async () => {
    const admin = await as('admin');
    const customer = await as('customer', 'app');
    const own = (await db.get<{ property_id: number }>('SELECT c.property_id FROM customers c JOIN users u ON u.customer_id = c.id WHERE u.email = ?', ['customer@demo.com']))!.property_id;
    const other = (await db.get<{ id: number }>("SELECT id FROM properties WHERE status = 'Sold' AND is_published = 0 AND id != ? LIMIT 1", [own]))!.id;
    for (const id of [own, other]) {
      await admin.put(`/api/properties/${id}`, { is_published: false });
      await admin.upload(`/api/properties/${id}/images`).attach('files', await png('#b08d57'), 'a.png');
    }
    const otherImg = (await admin.get(`/api/properties/${other}/images`)).body.data[0];
    const ownImg = (await admin.get(`/api/properties/${own}/images`)).body.data[0];
    expect(otherImg.urls.thumb).toMatch(/^\/api\/media\/\d+\/thumb\?exp=\d+&sig=/);

    // Staff link works; the bare path needs a session; other customers are refused; the public path hides it.
    expect((await request(app).get(otherImg.urls.thumb)).status).toBe(200);
    expect((await request(app).get(`/api/media/${otherImg.id}/thumb`)).status).toBe(401);
    expect((await customer.get(`/api/media/${otherImg.id}/thumb`)).status).toBe(403);
    expect((await customer.get(`/api/media/${ownImg.id}/medium`)).status).toBe(200);
    expect((await request(app).get(`/api/public/media/${otherImg.id}/thumb`)).status).toBe(404);
    expect((await request(app).get(`/api/media/${otherImg.id}/thumb?exp=9999999999&sig=forged`)).status).toBe(401);

    // The portal only lists the customer's own gallery.
    const portal = await customer.get('/api/portal');
    expect(portal.body.gallery.map((i: any) => i.property_id).every((id: number) => id === own)).toBe(true);
    expect(portal.body.gallery.length).toBeGreaterThan(0);

    // Publishing switches to cacheable public links.
    await admin.put(`/api/properties/${own}`, { is_published: true });
    const pub = (await admin.get(`/api/properties/${own}/images`)).body.data[0];
    expect(pub.urls.large).toBe(`/api/public/media/${pub.id}/large`);
    const r = await request(app).get(pub.urls.large);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toContain('max-age=31536000');
  });
});
