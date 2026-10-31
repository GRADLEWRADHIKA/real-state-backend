import crypto from 'node:crypto';
import { Router } from 'express';
import { PROPERTY_STATUSES, PROPERTY_TYPES, publicLeadBody, zPhone } from '@estateflow/shared';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { HttpError, parse } from '../utils/http.js';
import { nowIso } from '../utils/dates.js';
import { logActivity } from '../services/activity.js';
import { nextAssignee } from '../services/assignment.js';
import { findDuplicates, insertWithCode, normalizePhone } from '../services/leads.js';
import { notifyRoles, notifyUsers } from '../services/notifications.js';
import { getSetting } from '../services/settings.js';
import { sha256 } from '../services/tokens.js';
import { checkFormToken, issueFormToken } from '../services/formToken.js';
import { withImages } from '../images/store.js';
import { log } from '../logger.js';
import { orderBy, pageMeta, paging, parseQuery } from '../utils/http.js';

/**
 * Public, unauthenticated endpoints:
 *  - the public website inside the dashboard and the app (published properties, company details,
 *    enquiry and site-visit forms), and
 *  - lead capture for other websites, authenticated by the API key from Settings → Lead capture.
 */
const r = Router();

const limiter = rateLimit({
  name: 'public-leads',
  windowMs: config.rateLimit.windowMs,
  max: () => config.rateLimit.publicLeads,
  message: 'Too many submissions. Please try again in a minute.',
});

async function checkKey(header: unknown) {
  const s = await getSetting('lead_capture');
  if (!s.enabled || !s.key_hash) throw new HttpError(403, 'Lead capture is turned off', { code: 'capture_disabled' });
  const presented = Buffer.from(sha256(String(header ?? '')), 'hex');
  const expected = Buffer.from(s.key_hash, 'hex');
  if (!header || presented.length !== expected.length || !crypto.timingSafeEqual(presented, expected)) {
    throw new HttpError(401, 'Invalid API key', { code: 'invalid_key' });
  }
  return s;
}

r.post('/leads', limiter, async (req, res) => {
  const settings = await checkKey(req.headers['x-api-key']);
  const body = parse(publicLeadBody, req.body);
  const source = body.source ?? (settings.default_source || 'Website');
  const description = [body.campaign && `Campaign: ${body.campaign}`, body.message].filter(Boolean).join('\n') || null;

  const status = await createWebsiteLead(body, source, description, body.campaign ?? null, 'website form');
  res.status(status === 'created' ? 201 : 200).json({ ok: true, status });
});

  // A repeat enquiry from a known number is added to that lead instead of creating a duplicate.
export async function createWebsiteLead(
  body: { name: string; phone: string; email?: string | null; location?: string | null; property_type?: string | null; budget?: number | null; message?: string | null; property_id?: number | null },
  source: string,
  description: string | null,
  detail: string | null,
  via: string,
  title = 'New website lead',
): Promise<'created' | 'merged'> {
  const [existing] = await findDuplicates(body.phone);
  if (existing) {
    await logActivity({ lead_id: existing.id, type: 'enquiry', title: `New enquiry via ${source}`, description });
    await db.update('leads', existing.id, { updated_at: nowIso() });
    const lead = await db.get<{ assigned_to: number | null; name: string }>('SELECT assigned_to, name FROM leads WHERE id = ?', [existing.id]);
    const n = { type: 'lead', title: 'Repeat enquiry', message: `${lead!.name} enquired again via ${source}${detail ? ` (${detail})` : ''}.`, link: `/leads/${existing.id}` };
    if (lead?.assigned_to) await notifyUsers([lead.assigned_to], n);
    else await notifyRoles(['manager'], n);
    return 'merged';
  }

  const assigned = await nextAssignee();
  const now = nowIso();
  const id = await insertWithCode('leads', {
    name: body.name,
    phone: body.phone,
    phone_norm: normalizePhone(body.phone),
    email: body.email ?? null,
    location: body.location ?? null,
    source,
    source_detail: detail,
    property_id: body.property_id ?? null,
    property_type: body.property_type ?? null,
    budget: body.budget ?? null,
    requirement: body.message ?? null,
    priority: 'Warm',
    status: 'New',
    assigned_to: assigned,
    created_by: null,
    created_at: now,
    updated_at: now,
  });
  await logActivity({ lead_id: id, type: 'created', title: 'Lead created', description: `Captured from ${source} (${via})${detail ? ` · ${detail}` : ''}` });
  if (description && description !== body.message) await logActivity({ lead_id: id, type: 'enquiry', title: `Enquiry via ${source}`, description });
  const n = { type: 'lead', title, message: `${body.name} (${source}) ${assigned ? 'has been assigned to you' : 'is waiting to be assigned'}.`, link: `/leads/${id}`, trigger: 'lead_assigned' as const };
  if (assigned) await notifyUsers([assigned], n);
  else await notifyRoles(['manager'], n);
  return 'created';
}

// ─── Public website ──────────────────────────────────────────────────────
const PUBLIC_FIELDS = `p.id, p.slug, p.name, p.project, p.type, p.location, p.city, p.unit_number, p.block, p.rate_per_sqft, p.tower, p.floor, p.bedrooms, p.bathrooms,
  p.area_sqft, p.price, p.status, p.facing, p.furnishing, p.parking, p.possession, p.construction_stage, p.rera_number, p.description, p.amenities, p.is_published`;
const optEnum = <T extends readonly [string, ...string[]]>(v: T) => z.enum(v).optional().or(z.literal('').transform(() => undefined));
const listQuery = z.object({
  type: optEnum(PROPERTY_TYPES),
  status: optEnum(PROPERTY_STATUSES),
  q: z.string().trim().max(80).optional(),
  min_price: z.coerce.number().int().min(0).optional(),
  max_price: z.coerce.number().int().min(0).optional(),
  bedrooms: z.coerce.number().int().min(0).max(12).optional(),
  project: z.string().trim().max(80).optional(),
  featured: z.enum(['0', '1']).optional(),
  sort: z.enum(['price', 'area', 'newest']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(48).optional(),
});

const toPublic = async (rows: any[]) =>
  (await withImages(rows.map((p) => ({ ...p, amenities: p.amenities ? JSON.parse(p.amenities) : [] })), { forcePublic: true })).map(({ is_published: _p, ...p }) => p);

const readLimiter = rateLimit({ name: 'public-read', windowMs: config.rateLimit.windowMs, max: () => config.rateLimit.publicRead, message: 'Too many requests. Please slow down.' });
const formLimiter = rateLimit({ name: 'public-forms', windowMs: config.rateLimit.windowMs, max: () => config.rateLimit.publicForms, message: 'Too many submissions from this network. Please try again in a minute or call us.' });

r.get('/properties', readLimiter, async (req, res) => {
  const q = parseQuery(listQuery, req);
  const p = paging({ page: q.page, limit: q.limit ?? 12 }, 12);
  let where = 'WHERE p.is_published = 1';
  const params: unknown[] = [];
  if (q.type) { where += ' AND p.type = ?'; params.push(q.type); }
  if (q.status) { where += ' AND p.status = ?'; params.push(q.status); }
  if (q.project) { where += ' AND p.project = ?'; params.push(q.project); }
  if (q.min_price !== undefined) { where += ' AND p.price >= ?'; params.push(q.min_price); }
  if (q.max_price !== undefined) { where += ' AND p.price <= ?'; params.push(q.max_price); }
  if (q.bedrooms !== undefined) { where += ' AND p.bedrooms >= ?'; params.push(q.bedrooms); }
  if (q.featured === '1') where += " AND p.status IN ('Available','Reserved')";
  if (q.q) {
    const like = `%${q.q}%`;
    where += ' AND (p.name LIKE ? OR p.project LIKE ? OR p.location LIKE ? OR p.type LIKE ?)';
    params.push(like, like, like, like);
  }
  const sorts = { price: 'p.price', area: 'p.area_sqft', newest: 'p.created_at' };
  const order = q.sort ? orderBy(sorts, q.sort, q.order, 'p.price', 'asc') : "CASE p.status WHEN 'Available' THEN 0 WHEN 'Reserved' THEN 1 ELSE 2 END, p.price DESC";
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM properties p ${where}`, params))!.n;
  const rows = await db.all(`SELECT ${PUBLIC_FIELDS} FROM properties p ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  const facets = await db.all('SELECT type, COUNT(*) AS n, MIN(price) AS min_price, MAX(price) AS max_price FROM properties WHERE is_published = 1 GROUP BY type ORDER BY type');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ data: await toPublic(rows), meta: pageMeta(total, p, { facets }) });
});

r.get('/properties/:slug', readLimiter, async (req, res) => {
  const row = await db.get(`SELECT ${PUBLIC_FIELDS} FROM properties p WHERE p.slug = ? AND p.is_published = 1`, [String(req.params.slug).slice(0, 120)]);
  if (!row) throw new HttpError(404, 'This property is not available');
  const [property] = await toPublic([row]);
  const similar = await db.all(
    `SELECT ${PUBLIC_FIELDS} FROM properties p WHERE p.is_published = 1 AND p.id != ? AND (p.type = ? OR p.project = ?)
     ORDER BY (p.type = ?) DESC, ABS(p.price - ?) LIMIT 3`,
    [row.id, row.type, row.project, row.type, row.price],
  );
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ ...property, similar: await toPublic(similar) });
});

r.get('/company', readLimiter, async (_req, res) => {
  const c = (await getSetting('company')) as Record<string, string>;
  const { gstin: _g, receipt_prefix: _r, ...pub } = c;
  // Testimonials are only ever shown from real content saved in settings; none are invented.
  const extra = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'website'");
  const website = extra ? JSON.parse(extra.value) : {};
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ ...pub, whatsapp: website.whatsapp ?? c.phone, testimonials: Array.isArray(website.testimonials) ? website.testimonials : [] });
});

// Tokens are fetched on every page with a form, so they count as reads; only submissions use the form limit.
r.get('/form-token', readLimiter, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ token: issueFormToken() });
});

const formBase = {
  name: z.string().trim().min(2, 'Please enter your name').max(80),
  phone: zPhone,
  email: z.string().trim().email('Please enter a valid email').max(120).optional().or(z.literal('').transform(() => undefined)),
  message: z.string().trim().max(1000).optional(),
  property_slug: z.string().trim().max(120).optional(),
  token: z.string().max(200),
  /** Honeypot: hidden from people, filled by bots. */
  website: z.string().max(200).optional(),
};
const enquiryBody = z.object({ ...formBase, budget: z.coerce.number().int().min(0).max(1_000_000_000).optional(), property_type: z.enum(PROPERTY_TYPES).optional() });
const visitBody = z.object({ ...formBase, preferred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'), preferred_time: z.enum(['Morning', 'Afternoon', 'Evening']).optional() });

function guard(body: { token: string; website?: string }) {
  if (body.website) throw new HttpError(422, 'Your submission could not be accepted.', { code: 'spam' });
  const err = checkFormToken(body.token);
  if (err) {
    log.info('website form rejected', { reason: err });
    throw new HttpError(422, err === 'too fast' ? 'That was quick! Please check your details and send again.' : 'This form has expired. Please reload the page and try again.', { code: 'form_token' });
  }
}

async function propertyForSlug(slug?: string) {
  if (!slug) return null;
  return (await db.get<{ id: number; name: string; project: string; unit_number: string; type: string }>('SELECT id, name, project, unit_number, type FROM properties WHERE slug = ? AND is_published = 1', [slug])) ?? null;
}

r.post('/enquiries', formLimiter, async (req, res) => {
  const body = parse(enquiryBody, req.body);
  guard(body);
  const prop = await propertyForSlug(body.property_slug);
  const about = prop ? `${prop.project} ${prop.unit_number}` : null;
  const description = [about && `Property: ${about}`, body.message].filter(Boolean).join('\n') || null;
  const status = await createWebsiteLead(
    { ...body, property_id: prop?.id ?? null, property_type: body.property_type ?? (prop?.type as any) ?? null, message: body.message ?? null },
    'Website',
    description,
    about ? `Enquiry: ${about}` : 'Website enquiry',
    'website enquiry',
  );
  res.status(status === 'created' ? 201 : 200).json({ ok: true });
});

r.post('/site-visit-requests', formLimiter, async (req, res) => {
  const body = parse(visitBody, req.body);
  guard(body);
  const prop = await propertyForSlug(body.property_slug);
  const about = prop ? `${prop.project} ${prop.unit_number}` : 'township tour';
  const when = `${body.preferred_date}${body.preferred_time ? ` (${body.preferred_time.toLowerCase()})` : ''}`;
  const description = [`Site visit requested for ${when}: ${about}`, body.message].filter(Boolean).join('\n');
  const status = await createWebsiteLead(
    { ...body, property_id: prop?.id ?? null, property_type: (prop?.type as any) ?? null, message: body.message ?? null },
    'Website',
    description,
    `Site visit request: ${when}`,
    'website site visit request',
    'Site visit requested',
  );
  res.status(status === 'created' ? 201 : 200).json({ ok: true });
});
export default r;
