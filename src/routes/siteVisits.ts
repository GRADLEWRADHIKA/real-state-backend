import { Router } from 'express';
import { checkInBody, checkOutBody, humanDate, visitBody, visitListQuery } from '@estateflow/shared';
import { db } from '../db/index.js';
import { adminAppReadOnly, authorize, isScoped, scope, type AuthUser } from '../middleware/auth.js';
import { HttpError, forbidden, idParam, likeParam, notFound, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { addDays, nowIso, today } from '../utils/dates.js';
import { logActivity, notifyUsers } from '../services/activity.js';
import { advanceLead, touchLeadContact } from '../services/leads.js';
import { getLeadFor } from './leads.js';
import { removeEntityDocuments } from '../services/documents.js';

const r = Router();
r.use(authorize('admin', 'manager', 'sales'), adminAppReadOnly);

const SELECT = `
  SELECT v.*, l.name AS lead_name, l.phone AS lead_phone, l.code AS lead_code, u.name AS agent_name,
         p.project AS property_project, p.unit_number AS property_unit, p.name AS property_name, p.location AS property_location,
         (SELECT COUNT(*) FROM documents d WHERE d.entity_type = 'site_visit' AND d.entity_id = v.id) AS photos
  FROM site_visits v
  JOIN leads l ON l.id = v.lead_id
  LEFT JOIN users u ON u.id = v.agent_id
  LEFT JOIN properties p ON p.id = v.property_id`;

export async function getVisitFor(id: number, user: AuthUser) {
  const visit = await db.get(`${SELECT} WHERE v.id = ?`, [id]);
  if (!visit) throw notFound('Site visit');
  if (isScoped(user) && visit.agent_id !== user.id) throw forbidden();
  return visit;
}

r.get('/', async (req, res) => {
  const q = parseQuery(visitListQuery, req);
  const p = paging(q, 100);
  const s = scope(req.user, 'v.agent_id');
  let where = `WHERE 1=1${s.sql}`;
  const params: unknown[] = [...s.params];
  const t = today();
  if (q.status) { where += ' AND v.status = ?'; params.push(q.status); }
  if (q.agent) { where += ' AND v.agent_id = ?'; params.push(q.agent); }
  if (q.lead) { where += ' AND v.lead_id = ?'; params.push(q.lead); }
  if (q.property) { where += ' AND v.property_id = ?'; params.push(q.property); }
  if (q.range === 'today') { where += ' AND v.visit_date = ?'; params.push(t); }
  if (q.range === 'upcoming') { where += ' AND v.visit_date >= ?'; params.push(t); }
  if (q.range === 'week') { where += ' AND v.visit_date BETWEEN ? AND ?'; params.push(t, addDays(t, 7)); }
  if (q.range === 'past') { where += ' AND v.visit_date < ?'; params.push(t); }
  if (q.from) { where += ' AND v.visit_date >= ?'; params.push(q.from); }
  if (q.to) { where += ' AND v.visit_date <= ?'; params.push(q.to); }
  if (q.q) { const like = likeParam(q.q); where += ' AND (l.name LIKE ? OR p.project LIKE ? OR p.unit_number LIKE ?)'; params.push(like, like, like); }
  const order = q.range === 'past' || q.order === 'desc' ? 'DESC' : 'ASC';
  const from = 'FROM site_visits v JOIN leads l ON l.id = v.lead_id LEFT JOIN properties p ON p.id = v.property_id';
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n ${from} ${where}`, params))!.n;
  const data = await db.all(`${SELECT} ${where} ORDER BY v.visit_date ${order}, v.visit_time ${order} LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  const summary = await db.get(
    `SELECT SUM(CASE WHEN visit_date = ? AND status IN ('Scheduled','Rescheduled') THEN 1 ELSE 0 END) AS today,
            SUM(CASE WHEN visit_date > ? AND status IN ('Scheduled','Rescheduled') THEN 1 ELSE 0 END) AS upcoming,
            SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN visit_date < ? AND status IN ('Scheduled','Rescheduled') THEN 1 ELSE 0 END) AS missed
     FROM site_visits v WHERE 1=1${s.sql}`,
    [t, t, t, ...s.params],
  );
  res.json({ data, meta: pageMeta(total, p, { summary: { today: summary?.today ?? 0, upcoming: summary?.upcoming ?? 0, completed: summary?.completed ?? 0, missed: summary?.missed ?? 0 } }) });
});

r.get('/:id', async (req, res) => {
  const v = await getVisitFor(idParam(req), req.user);
  const photos = await db.all("SELECT id, name, doc_type, mime, size, created_at FROM documents WHERE entity_type = 'site_visit' AND entity_id = ? ORDER BY created_at", [v.id]);
  res.json({ ...v, photo_documents: photos });
});

r.post('/', async (req, res) => {
  const data = parse(visitBody, req.body);
  const lead = await getLeadFor(data.lead_id, req.user);
  const agent = req.user.role === 'sales' ? req.user.id : (data.agent_id ?? lead.assigned_to ?? req.user.id);
  if (data.property_id && !(await db.get('SELECT id FROM properties WHERE id = ?', [data.property_id]))) throw new HttpError(422, 'property_id: Unknown property');
  const id = await db.insert('site_visits', {
    ...data,
    property_id: data.property_id ?? lead.property_id,
    agent_id: agent,
    created_by: req.user.id,
    created_at: nowIso(),
  });
  // A visit to a specific unit makes it the lead's interested property if none was chosen yet.
  if (data.property_id && !lead.property_id) await db.update('leads', lead.id, { property_id: data.property_id, updated_at: nowIso() });
  const v = await db.get(`${SELECT} WHERE v.id = ?`, [id]);
  await logActivity({
    lead_id: lead.id,
    property_id: v.property_id,
    type: 'site_visit',
    title: 'Site visit scheduled',
    description: `${v.property_project ? `${v.property_project} · ${v.property_unit}` : 'Township tour'} on ${humanDate(data.visit_date, data.visit_time)}`,
    user_id: req.user.id,
  });
  await advanceLead(lead.id, 'Site Visit', req.user);
  await notifyUsers([agent], { type: 'site_visit', title: 'Site visit scheduled', message: `${lead.name} · ${v.property_project ?? 'Township tour'} on ${humanDate(data.visit_date, data.visit_time)}.`, link: `/leads/${lead.id}`, trigger: 'site_visit_reminder' }, req.user.id);
  res.status(201).json(v);
});

r.put('/:id', async (req, res) => {
  const visit = await getVisitFor(idParam(req), req.user);
  const data = parse(visitBody.partial(), req.body);
  if (req.user.role === 'sales') delete data.agent_id;
  delete data.lead_id;
  const rescheduled = (data.visit_date && data.visit_date !== visit.visit_date) || (data.visit_time && data.visit_time !== visit.visit_time);
  if (rescheduled && !data.status) data.status = 'Rescheduled';
  await db.update('site_visits', visit.id, data);
  const v = await db.get(`${SELECT} WHERE v.id = ?`, [visit.id]);
  if (data.status && data.status !== visit.status) {
    const titles: Record<string, string> = { Completed: 'Site visit completed', Cancelled: 'Site visit cancelled', Rescheduled: 'Site visit rescheduled', Scheduled: 'Site visit scheduled' };
    await logActivity({
      lead_id: visit.lead_id,
      property_id: v.property_id,
      type: 'site_visit',
      title: titles[data.status],
      description: data.status === 'Completed' ? [data.outcome, data.feedback].filter(Boolean).join(' — ') || `Visited ${v.property_project ?? 'property'}` : humanDate(v.visit_date, v.visit_time),
      user_id: req.user.id,
    });
    if (data.status === 'Completed') await touchLeadContact(visit.lead_id);
  }
  if (data.agent_id && data.agent_id !== visit.agent_id) {
    await notifyUsers([data.agent_id], { type: 'site_visit', title: 'Site visit assigned to you', message: `${v.lead_name} on ${humanDate(v.visit_date, v.visit_time)}.`, link: `/leads/${v.lead_id}`, trigger: 'site_visit_reminder' }, req.user.id);
  }
  res.json(v);
});

const coords = (lat?: number | null, lng?: number | null) => (lat !== undefined && lat !== null && lng !== undefined && lng !== null ? ` (${lat.toFixed(5)}, ${lng.toFixed(5)})` : '');

/** Field check-in on arrival at the site, with optional device location. */
r.post('/:id/check-in', async (req, res) => {
  const visit = await getVisitFor(idParam(req), req.user);
  const body = parse(checkInBody, req.body);
  if (visit.status === 'Cancelled' || visit.status === 'Completed') throw new HttpError(409, `This visit is already ${visit.status.toLowerCase()}`);
  if (visit.checked_in_at) throw new HttpError(409, 'You have already checked in to this visit');
  const at = body.at && body.at <= nowIso() ? body.at : nowIso();
  await db.update('site_visits', visit.id, { checked_in_at: at, checkin_lat: body.lat ?? null, checkin_lng: body.lng ?? null });
  await logActivity({ lead_id: visit.lead_id, property_id: visit.property_id, type: 'site_visit', title: 'Checked in at site', description: `${visit.property_project ?? 'Site'}${coords(body.lat, body.lng)}`, user_id: req.user.id, created_at: at });
  res.json(await getVisitFor(visit.id, req.user));
});

/** Check-out completes the visit with its outcome and notes. */
r.post('/:id/check-out', async (req, res) => {
  const visit = await getVisitFor(idParam(req), req.user);
  const body = parse(checkOutBody, req.body);
  if (visit.status === 'Cancelled') throw new HttpError(409, 'This visit was cancelled');
  if (visit.checked_out_at) throw new HttpError(409, 'You have already checked out of this visit');
  const at = body.at && body.at <= nowIso() ? body.at : nowIso();
  await db.update('site_visits', visit.id, {
    checked_in_at: visit.checked_in_at ?? at,
    checked_out_at: at,
    checkout_lat: body.lat ?? null,
    checkout_lng: body.lng ?? null,
    outcome: body.outcome,
    feedback: body.feedback ?? visit.feedback,
    next_action: body.next_action ?? visit.next_action,
    status: 'Completed',
  });
  const mins = visit.checked_in_at ? Math.round((new Date(at).getTime() - new Date(visit.checked_in_at).getTime()) / 60000) : null;
  await logActivity({
    lead_id: visit.lead_id,
    property_id: visit.property_id,
    type: 'site_visit',
    title: `Site visit completed · ${body.outcome}`,
    description: [body.feedback, body.next_action ? `Next: ${body.next_action}` : null, mins !== null ? `On site ${mins} min${coords(body.lat, body.lng)}` : null].filter(Boolean).join(' — '),
    user_id: req.user.id,
    created_at: at,
  });
  await touchLeadContact(visit.lead_id);
  if (body.outcome !== 'Not interested') await advanceLead(visit.lead_id, 'Site Visit', req.user);
  res.json(await getVisitFor(visit.id, req.user));
});

r.delete('/:id', async (req, res) => {
  const visit = await getVisitFor(idParam(req), req.user);
  await db.run('DELETE FROM site_visits WHERE id = ?', [visit.id]);
  await removeEntityDocuments('site_visit', visit.id);
  res.json({ ok: true, id: visit.id });
});

export default r;
