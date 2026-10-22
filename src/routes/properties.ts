import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { generateImagesBody, propertyBody, propertyImageOrder, propertyImageUpdate, propertyListQuery } from '@estateflow/shared';
import { config } from '../config.js';
import { log } from '../logger.js';
import { generateInBackground, generateForProperty, isGenerating } from '../images/generate.js';
import { uniqueSlug } from '../images/slug.js';
import { IMAGE_EXT, addImage, deleteImages, removePropertyImageFiles, reorderImages, setCover, sniffImage, toDto, withImages } from '../images/store.js';
import { db } from '../db/index.js';
import { adminAppReadOnly, authorize } from '../middleware/auth.js';
import { HttpError, idParam, likeParam, notFound, orderBy, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { nowIso } from '../utils/dates.js';
import { insertWithCode } from '../services/leads.js';
import { portalUserFor, notifyUsers } from '../services/notifications.js';
import { realtime } from '../services/realtime.js';

const r = Router();
r.use(authorize('admin', 'manager', 'sales', 'accounts'), adminAppReadOnly);

const SELECT = `
  SELECT p.*, u.name AS agent_name,
    (SELECT COUNT(*) FROM leads l WHERE l.property_id = p.id AND l.status NOT IN ('Lost')) AS interested_count,
    (SELECT c.name FROM customers c WHERE c.property_id = p.id AND c.status != 'Cancelled' ORDER BY c.id DESC LIMIT 1) AS customer_name,
    (SELECT d.id FROM documents d WHERE d.entity_type = 'property' AND d.entity_id = p.id AND d.mime LIKE 'image/%' ORDER BY d.created_at LIMIT 1) AS cover_document_id
  FROM properties p LEFT JOIN users u ON u.id = p.assigned_to`;

const out = (p: any) => (p ? { ...p, amenities: p.amenities ? JSON.parse(p.amenities) : [], is_published: !!p.is_published } : p);
const withGallery = async (p: any) => (p ? (await withImages([out(p)]))[0] : p);

async function slugFor(base: string, exceptId = 0) {
  const taken = new Set((await db.all<{ slug: string }>('SELECT slug FROM properties WHERE slug IS NOT NULL AND id != ?', [exceptId])).map((r) => r.slug));
  return uniqueSlug(base, taken);
}

/** Gallery uploads: memory storage, size limit and a JPEG/PNG/WebP allowlist (content is sniffed again later). */
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadMaxBytes, files: 20, fields: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (IMAGE_EXT[file.mimetype]?.includes(ext)) cb(null, true);
    else cb(new HttpError(415, `${file.originalname}: only JPG, PNG or WebP images can be added to the gallery`));
  },
});
const realtimeProps = () => realtime.change(['properties'], { staffOnly: true });
const TYPE_ORDER = "CASE p.type WHEN 'Villa' THEN 1 WHEN 'Plot' THEN 2 WHEN 'Apartment' THEN 3 ELSE 4 END, p.project, p.unit_number";

r.get('/', async (req, res) => {
  const q = parseQuery(propertyListQuery, req);
  const p = paging(q, 100);
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (q.status) { where += ' AND p.status = ?'; params.push(q.status); }
  if (q.type) { where += ' AND p.type = ?'; params.push(q.type); }
  if (q.project) { where += ' AND p.project = ?'; params.push(q.project); }
  if (q.block) { where += ' AND p.block = ?'; params.push(q.block); }
  if (q.price_min !== undefined) { where += ' AND p.price >= ?'; params.push(q.price_min); }
  if (q.price_max !== undefined) { where += ' AND p.price <= ?'; params.push(q.price_max); }
  if (q.bedrooms !== undefined) { where += ' AND p.bedrooms >= ?'; params.push(q.bedrooms); }
  if (q.available === '1') where += " AND p.status IN ('Available','Reserved')";
  if (q.q) {
    const like = likeParam(q.q);
    where += ' AND (p.name LIKE ? OR p.project LIKE ? OR p.unit_number LIKE ? OR p.location LIKE ? OR p.code LIKE ?)';
    params.push(like, like, like, like, like);
  }
  const sorts: Record<string, string> = { price: 'p.price', area: 'p.area_sqft', created_at: 'p.created_at', project: 'p.project, p.unit_number', unit: 'p.unit_number' };
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM properties p ${where}`, params))!.n;
  const rows = await db.all(`${SELECT} ${where} ORDER BY ${q.sort ? orderBy(sorts, q.sort, q.order, 'p.price', 'asc') : TYPE_ORDER} LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  const summary = await db.all('SELECT status, COUNT(*) AS n, SUM(price) AS value FROM properties GROUP BY status');
  const projects = await db.all(
    `SELECT project, MIN(location) AS location, MIN(type) AS type, COUNT(*) AS units,
       SUM(CASE WHEN status IN ('Available','Reserved') THEN 1 ELSE 0 END) AS available,
       MIN(price) AS min_price, MAX(price) AS max_price
     FROM properties GROUP BY project ORDER BY project`,
  );
  const blocks = (await db.all<{ block: string }>("SELECT DISTINCT block FROM properties WHERE block IS NOT NULL AND block != '' ORDER BY block")).map((b) => b.block);
  res.json({ data: await withImages(rows.map(out)), meta: pageMeta(total, p, { summary, projects, blocks }) });
});

/** Plot map: every unit with its status, for the colour-coded layout grouped by project and block. */
r.get('/map', async (_req, res) => {
  const data = await db.all(
    `SELECT p.id, p.project, p.block, p.unit_number, p.type, p.status, p.area_sqft, p.price,
       (SELECT c.name FROM customers c WHERE c.property_id = p.id AND c.status != 'Cancelled' ORDER BY c.id DESC LIMIT 1) AS customer_name
     FROM properties p ORDER BY p.project, COALESCE(p.block, ''), length(p.unit_number), p.unit_number`,
  );
  res.json({ data });
});

r.get('/:id', async (req, res) => {
  const p = await withGallery(await db.get(`${SELECT} WHERE p.id = ?`, [idParam(req)]));
  if (!p) throw notFound('Property');
  const sales = req.user.role === 'sales';
  const scoped = (col: string) => (sales ? ` AND ${col} = ?` : '');
  const sp = sales ? [req.user.id] : [];
  const [leads, customer, visits, documents] = await Promise.all([
    req.user.role === 'accounts'
      ? []
      : db.all(
          `SELECT l.id, l.code, l.name, l.phone, l.status, l.priority, l.budget, l.next_followup, u.name AS agent_name
           FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.property_id = ?${scoped('l.assigned_to')} ORDER BY l.updated_at DESC`,
          [p.id, ...sp],
        ),
    db.get(
      `SELECT c.id, c.code, c.name, c.phone, c.booking_date, c.total_value, c.status, c.assigned_to,
         (SELECT COALESCE(SUM(paid_amount), 0) FROM installments i WHERE i.customer_id = c.id) AS paid,
         d.code AS deal_code, d.stage AS deal_stage, u.name AS agent_name
       FROM customers c LEFT JOIN deals d ON d.customer_id = c.id LEFT JOIN users u ON u.id = c.assigned_to
       WHERE c.property_id = ? AND c.status != 'Cancelled' ORDER BY c.id DESC LIMIT 1`,
      [p.id],
    ),
    req.user.role === 'accounts'
      ? []
      : db.all(
          `SELECT v.*, l.name AS lead_name, u.name AS agent_name FROM site_visits v JOIN leads l ON l.id = v.lead_id
           LEFT JOIN users u ON u.id = v.agent_id WHERE v.property_id = ?${scoped('v.agent_id')} ORDER BY v.visit_date DESC LIMIT 10`,
          [p.id, ...sp],
        ),
    db.all("SELECT d.*, u.name AS uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.entity_type = 'property' AND d.entity_id = ? ORDER BY d.created_at DESC", [p.id]),
  ]);
  // Plot history: every booking ever made on this unit, cancelled ones included, newest first.
  const history = await db.all(
    `SELECT c.id AS customer_id, c.code AS customer_code, c.name AS customer_name, c.booking_date, c.total_value, c.status,
       c.cancelled_at, c.cancel_reason, c.registry_status, c.registry_date, c.assigned_to, u.name AS agent_name
     FROM customers c LEFT JOIN users u ON u.id = c.assigned_to WHERE c.property_id = ? ORDER BY c.booking_date DESC, c.id DESC`,
    [p.id],
  );
  const visibleHistory = history.map(({ assigned_to, ...h }) => (sales && assigned_to !== req.user.id ? { ...h, customer_name: 'Another customer', customer_code: '' } : h));
  // A sales executive sees that a unit is booked, but only their own customer's details.
  const owner = customer && sales && customer.assigned_to !== req.user.id ? { status: customer.status, booking_date: customer.booking_date, deal_stage: customer.deal_stage } : customer;
  res.json({ ...p, leads, customer: owner, visits, documents, history: visibleHistory, gallery: documents.filter((d: any) => String(d.mime).startsWith('image/')), generating: isGenerating(p.id) });
});

r.post('/', authorize('admin', 'manager'), async (req, res) => {
  const { generate_images, ...data } = parse(propertyBody, req.body);
  const dupe = await db.get('SELECT id FROM properties WHERE project = ? AND unit_number = ?', [data.project, data.unit_number]);
  if (dupe) throw new HttpError(409, `Unit ${data.unit_number} already exists in ${data.project}`);
  if (data.slug && (await db.get('SELECT id FROM properties WHERE slug = ?', [data.slug]))) throw new HttpError(409, `The web address ${data.slug} is already used by another property`);
  const slug = data.slug || (await slugFor(`${data.project} ${data.unit_number}`));
  const id = await insertWithCode('properties', { ...data, slug, created_at: nowIso(), updated_at: nowIso() });
  if (generate_images) generateInBackground([id], { log: (m) => log.info(m), onDone: realtimeProps });
  res.status(201).json(await withGallery(await db.get(`${SELECT} WHERE p.id = ?`, [id])));
});

r.put('/:id', authorize('admin', 'manager'), async (req, res) => {
  const id = idParam(req);
  const existing = await db.get('SELECT * FROM properties WHERE id = ?', [id]);
  if (!existing) throw notFound('Property');
  const { generate_images: _ignored, ...data } = parse(propertyBody.partial(), req.body);
  if (data.slug && data.slug !== existing.slug && (await db.get('SELECT id FROM properties WHERE slug = ? AND id != ?', [data.slug, id]))) {
    throw new HttpError(409, `The web address ${data.slug} is already used by another property`);
  }
  if (data.slug === null) delete data.slug;
  if (data.status && ['Available', 'Reserved'].includes(data.status)) {
    const owner = await db.get("SELECT name FROM customers WHERE property_id = ? AND status != 'Cancelled'", [id]);
    if (owner) throw new HttpError(409, `This unit is booked by ${owner.name}. Cancel the booking before marking it ${data.status.toLowerCase()}.`);
  }
  if (data.project || data.unit_number) {
    const dupe = await db.get('SELECT id FROM properties WHERE project = ? AND unit_number = ? AND id != ?', [data.project ?? existing.project, data.unit_number ?? existing.unit_number, id]);
    if (dupe) throw new HttpError(409, `Unit ${data.unit_number ?? existing.unit_number} already exists in ${data.project ?? existing.project}`);
  }
  await db.update('properties', id, { ...data, updated_at: nowIso() });
  // Customers see construction progress on their portal.
  if (data.construction_stage && data.construction_stage !== existing.construction_stage) {
    const owner = await db.get<{ id: number }>("SELECT id FROM customers WHERE property_id = ? AND status != 'Cancelled'", [id]);
    const portal = owner ? await portalUserFor(owner.id) : undefined;
    if (portal) {
      await notifyUsers([portal.id], { type: 'property', title: 'Construction update', message: `${existing.project} ${existing.unit_number}: ${data.construction_stage}.`, link: '/property' });
      realtime.change(['portal'], { userIds: [portal.id] });
    }
  }
  res.json(await withGallery(await db.get(`${SELECT} WHERE p.id = ?`, [id])));
});

r.delete('/:id', authorize('admin'), async (req, res) => {
  const id = idParam(req);
  const owner = await db.get("SELECT id FROM customers WHERE property_id = ? AND status != 'Cancelled'", [id]);
  if (owner) throw new HttpError(409, 'Booked or sold units cannot be deleted');
  if (!(await db.run('DELETE FROM properties WHERE id = ?', [id])).changes) throw notFound('Property');
  await removePropertyImageFiles(id);
  res.json({ ok: true, id });
});

// ─── Gallery ─────────────────────────────────────────────────────────────
async function requireProperty(id: number) {
  const p = await db.get<{ id: number; name: string; type: string; city: string; is_published: number }>('SELECT id, name, type, city, is_published FROM properties WHERE id = ?', [id]);
  if (!p) throw notFound('Property');
  return p;
}
const gallery = async (id: number, published: number) =>
  (await db.all('SELECT * FROM property_images WHERE property_id = ? ORDER BY sort_order, id', [id])).map((row) => toDto(row, !!published));

r.get('/:id/images', async (req, res) => {
  const p = await requireProperty(idParam(req));
  res.json({ data: await gallery(p.id, p.is_published), generating: isGenerating(p.id) });
});

/** Multi-file upload: each file succeeds or fails on its own; the response lists both. */
r.post('/:id/images', authorize('admin', 'manager'), imageUpload.array('files', 20), async (req, res) => {
  const p = await requireProperty(idParam(req));
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw new HttpError(422, 'files: Choose at least one image');
  const created: number[] = [];
  const errors: { file: string; error: string }[] = [];
  for (const f of files) {
    try {
      const sniffed = sniffImage(f.buffer);
      if (!sniffed || sniffed !== f.mimetype) throw new HttpError(415, 'The file content is not a JPG, PNG or WebP image');
      const title = path.basename(f.originalname, path.extname(f.originalname)).replace(/[-_]+/g, ' ').trim();
      created.push(await addImage(p.id, { buffer: f.buffer, mime: sniffed, alt_text: `${p.name} in ${p.city}${title ? `: ${title}` : ''}`.slice(0, 240), kind: 'other', source: 'upload' }));
    } catch (err) {
      errors.push({ file: f.originalname, error: err instanceof Error ? err.message : 'Upload failed' });
    }
  }
  realtimeProps();
  res.status(created.length ? 201 : 422).json({ created: created.length, errors, data: await gallery(p.id, p.is_published) });
});

r.patch('/:id/images/:imageId', authorize('admin', 'manager'), async (req, res) => {
  const p = await requireProperty(idParam(req));
  const imageId = idParam(req, 'imageId');
  const data = parse(propertyImageUpdate, req.body);
  if (!(await db.update('property_images', imageId, data)) && Object.keys(data).length) throw notFound('Image');
  const row = await db.get('SELECT * FROM property_images WHERE id = ? AND property_id = ?', [imageId, p.id]);
  if (!row) throw notFound('Image');
  realtimeProps();
  res.json(toDto(row, !!p.is_published));
});

r.put('/:id/images/order', authorize('admin', 'manager'), async (req, res) => {
  const p = await requireProperty(idParam(req));
  await reorderImages(p.id, parse(propertyImageOrder, req.body).ids);
  realtimeProps();
  res.json({ data: await gallery(p.id, p.is_published) });
});

r.post('/:id/images/:imageId/cover', authorize('admin', 'manager'), async (req, res) => {
  const p = await requireProperty(idParam(req));
  await setCover(p.id, idParam(req, 'imageId'));
  realtimeProps();
  res.json({ data: await gallery(p.id, p.is_published) });
});

r.delete('/:id/images/:imageId', authorize('admin', 'manager'), async (req, res) => {
  const p = await requireProperty(idParam(req));
  if (!(await deleteImages(p.id, 'id = ?', [idParam(req, 'imageId')]))) throw notFound('Image');
  realtimeProps();
  res.json({ data: await gallery(p.id, p.is_published) });
});

/** Renders illustrated images for this property. Runs in the background unless ?wait=1. */
r.post('/:id/generate-images', authorize('admin', 'manager'), async (req, res) => {
  const p = await requireProperty(idParam(req));
  const body = parse(generateImagesBody, req.body ?? {});
  const opts = { force: body.force ?? true, seed: body.seed, log: (m: string) => log.info(m) };
  if (req.query.wait === '1') {
    const result = await generateForProperty(p.id, opts);
    realtimeProps();
    return res.json({ ...result, data: await gallery(p.id, p.is_published) });
  }
  void generateInBackground([p.id], { ...opts, onDone: realtimeProps });
  res.status(202).json({ status: 'started' });
});

export default r;
