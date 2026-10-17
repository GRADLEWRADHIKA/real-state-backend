import { Router } from 'express';
import { propertyBody, propertyListQuery } from '@estateflow/shared';
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

const out = (p: any) => (p ? { ...p, amenities: p.amenities ? JSON.parse(p.amenities) : [] } : p);
const TYPE_ORDER = "CASE p.type WHEN 'Villa' THEN 1 WHEN 'Plot' THEN 2 WHEN 'Apartment' THEN 3 ELSE 4 END, p.project, p.unit_number";

r.get('/', async (req, res) => {
  const q = parseQuery(propertyListQuery, req);
  const p = paging(q, 100);
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (q.status) { where += ' AND p.status = ?'; params.push(q.status); }
  if (q.type) { where += ' AND p.type = ?'; params.push(q.type); }
  if (q.project) { where += ' AND p.project = ?'; params.push(q.project); }
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
    `SELECT project, MIN(location) AS location, COUNT(*) AS units,
       SUM(CASE WHEN status IN ('Available','Reserved') THEN 1 ELSE 0 END) AS available,
       MIN(price) AS min_price, MAX(price) AS max_price
     FROM properties GROUP BY project ORDER BY project`,
  );
  res.json({ data: rows.map(out), meta: pageMeta(total, p, { summary, projects }) });
});

r.get('/:id', async (req, res) => {
  const p = out(await db.get(`${SELECT} WHERE p.id = ?`, [idParam(req)]));
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
  // A sales executive sees that a unit is booked, but only their own customer's details.
  const owner = customer && sales && customer.assigned_to !== req.user.id ? { status: customer.status, booking_date: customer.booking_date, deal_stage: customer.deal_stage } : customer;
  res.json({ ...p, leads, customer: owner, visits, documents, gallery: documents.filter((d: any) => String(d.mime).startsWith('image/')) });
});

r.post('/', authorize('admin', 'manager'), async (req, res) => {
  const data = parse(propertyBody, req.body);
  const dupe = await db.get('SELECT id FROM properties WHERE project = ? AND unit_number = ?', [data.project, data.unit_number]);
  if (dupe) throw new HttpError(409, `Unit ${data.unit_number} already exists in ${data.project}`);
  const id = await insertWithCode('properties', { ...data, created_at: nowIso(), updated_at: nowIso() });
  res.status(201).json(out(await db.get(`${SELECT} WHERE p.id = ?`, [id])));
});

r.put('/:id', authorize('admin', 'manager'), async (req, res) => {
  const id = idParam(req);
  const existing = await db.get('SELECT * FROM properties WHERE id = ?', [id]);
  if (!existing) throw notFound('Property');
  const data = parse(propertyBody.partial(), req.body);
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
  res.json(out(await db.get(`${SELECT} WHERE p.id = ?`, [id])));
});

r.delete('/:id', authorize('admin'), async (req, res) => {
  const id = idParam(req);
  const owner = await db.get("SELECT id FROM customers WHERE property_id = ? AND status != 'Cancelled'", [id]);
  if (owner) throw new HttpError(409, 'Booked or sold units cannot be deleted');
  if (!(await db.run('DELETE FROM properties WHERE id = ?', [id])).changes) throw notFound('Property');
  res.json({ ok: true, id });
});

export default r;
