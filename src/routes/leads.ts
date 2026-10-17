import { Router } from 'express';
import {
  bulkAssignBody,
  bulkIdsBody,
  convertBody,
  leadBody,
  leadImportBody,
  leadImportRow,
  leadListQuery,
  leadStatusBody,
  logContactBody,
  mergeLeadBody,
  noteBody,
  normalizePhone,
  toCsv,
  fmtDate,
} from '@estateflow/shared';
import { z } from 'zod';
import { db } from '../db/index.js';
import { adminAppReadOnly, authorize, dashboardOnly, isScoped, scope, type AuthUser } from '../middleware/auth.js';
import { HttpError, attachmentHeader, forbidden, idParam, likeParam, notFound, orderBy, pageMeta, paging, parse, parseQuery, placeholders } from '../utils/http.js';
import { nowIso, today } from '../utils/dates.js';
import { logActivity, notifyUsers } from '../services/activity.js';
import { changeLeadStatus, convertLead, findDuplicates, insertWithCode } from '../services/leads.js';
import { nextAssignee } from '../services/assignment.js';
import { getSetting } from '../services/settings.js';

const r = Router();
r.use(authorize('admin', 'manager', 'sales'), adminAppReadOnly);

const LEAD_SELECT = `
  SELECT l.*, p.name AS property_name, p.project AS property_project, p.unit_number AS property_unit, p.price AS property_price,
         u.name AS agent_name
  FROM leads l
  LEFT JOIN properties p ON p.id = l.property_id
  LEFT JOIN users u ON u.id = l.assigned_to`;

/** Sales executives reach only leads assigned to them (list, detail and every sub-resource use this). */
export async function getLeadFor(id: number, user: AuthUser) {
  const lead = await db.get(`${LEAD_SELECT} WHERE l.id = ?`, [id]);
  if (!lead) throw notFound('Lead');
  if (isScoped(user) && lead.assigned_to !== user.id) throw forbidden();
  return lead;
}

const SORTS: Record<string, string> = {
  created_at: 'l.created_at',
  updated_at: 'l.updated_at',
  name: 'l.name',
  budget: 'l.budget',
  last_contact: 'l.last_contact',
  next_followup: 'l.next_followup',
  priority: "CASE l.priority WHEN 'Hot' THEN 1 WHEN 'Warm' THEN 2 ELSE 3 END",
  status: "CASE l.status WHEN 'New' THEN 1 WHEN 'Contacted' THEN 2 WHEN 'Qualified' THEN 3 WHEN 'Site Visit' THEN 4 WHEN 'Negotiation' THEN 5 WHEN 'Booked' THEN 6 WHEN 'Closed' THEN 7 ELSE 8 END",
  code: 'l.id',
};

function leadFilters(q: z.infer<typeof leadListQuery>, user: AuthUser) {
  const s = scope(user, 'l.assigned_to');
  let where = `WHERE 1=1${s.sql}`;
  const params: unknown[] = [...s.params];
  const base = { where, params: [...params] };
  if (q.status?.length) {
    where += ` AND l.status IN (${placeholders(q.status.length)})`;
    params.push(...q.status);
  }
  if (q.source) { where += ' AND l.source = ?'; params.push(q.source); }
  if (q.priority) { where += ' AND l.priority = ?'; params.push(q.priority); }
  if (q.agent === 'unassigned') where += ' AND l.assigned_to IS NULL';
  else if (q.agent === 'me') { where += ' AND l.assigned_to = ?'; params.push(user.id); }
  else if (typeof q.agent === 'number') { where += ' AND l.assigned_to = ?'; params.push(q.agent); }
  if (q.property) { where += ' AND l.property_id = ?'; params.push(q.property); }
  if (q.project) { where += ' AND p.project = ?'; params.push(q.project); }
  if (q.budget_min !== undefined) { where += ' AND l.budget >= ?'; params.push(q.budget_min); }
  if (q.budget_max !== undefined) { where += ' AND l.budget <= ?'; params.push(q.budget_max); }
  if (q.from) { where += ' AND substr(l.created_at, 1, 10) >= ?'; params.push(q.from); }
  if (q.to) { where += ' AND substr(l.created_at, 1, 10) <= ?'; params.push(q.to); }
  if (q.followup === 'overdue') { where += " AND l.next_followup < ? AND l.status NOT IN ('Closed','Lost','Booked')"; params.push(today()); }
  if (q.followup === 'today') { where += ' AND substr(l.next_followup, 1, 10) = ?'; params.push(today()); }
  if (q.followup === 'none') where += " AND l.next_followup IS NULL AND l.status NOT IN ('Closed','Lost','Booked')";
  if (q.q) {
    const like = likeParam(q.q);
    where += ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.code LIKE ? OR p.project LIKE ? OR l.phone_norm LIKE ?)';
    params.push(like, like, like, like, like, likeParam(normalizePhone(q.q) || q.q));
  }
  return { where, params, base };
}

r.get('/', async (req, res) => {
  const q = parseQuery(leadListQuery, req);
  const p = paging(q);
  const { where, params, base } = leadFilters(q, req.user);
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM leads l LEFT JOIN properties p ON p.id = l.property_id ${where}`, params))!.n;
  const data = await db.all(`${LEAD_SELECT} ${where} ORDER BY ${orderBy(SORTS, q.sort, q.order, 'l.created_at')} NULLS LAST, l.id DESC LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  const counts = await db.all(`SELECT l.status, COUNT(*) AS n FROM leads l ${base.where} GROUP BY l.status`, base.params);
  res.json({ data, meta: pageMeta(total, p, { statusCounts: Object.fromEntries(counts.map((c) => [c.status, c.n])) }) });
});

r.get('/export.csv', authorize('admin', 'manager'), dashboardOnly, async (req, res) => {
  const q = parseQuery(leadListQuery, req);
  const { where, params } = leadFilters(q, req.user);
  const rows = await db.all(`${LEAD_SELECT} ${where} ORDER BY ${orderBy(SORTS, q.sort, q.order, 'l.created_at')}, l.id DESC LIMIT 20000`, params);
  const csv = toCsv(rows, [
    { key: 'code', label: 'Lead ID' },
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'location', label: 'Location' },
    { key: 'source', label: 'Source' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'budget', label: 'Budget (INR)' },
    { key: 'property_type', label: 'Property type' },
    { key: 'property', label: 'Interested unit', value: (l) => (l.property_project ? `${l.property_project} ${l.property_unit}` : '') },
    { key: 'agent_name', label: 'Assigned to' },
    { key: 'next_followup', label: 'Next follow-up' },
    { key: 'last_contact', label: 'Last contact', value: (l) => (l.last_contact ? fmtDate(l.last_contact) : '') },
    { key: 'created_at', label: 'Created', value: (l) => l.created_at.slice(0, 10) },
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', attachmentHeader(`leads-${today()}.csv`));
  res.send(csv);
});

r.get('/board', async (req, res) => {
  const s = scope(req.user, 'l.assigned_to');
  const rows = await db.all(
    `SELECT l.id, l.code, l.name, l.phone, l.status, l.priority, l.budget, l.next_followup, l.last_contact, l.source, l.customer_id,
            l.assigned_to, u.name AS agent_name, p.project AS property_project, p.unit_number AS property_unit, p.name AS property_name,
            (SELECT a.title FROM activities a WHERE a.lead_id = l.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS last_activity,
            (SELECT a.created_at FROM activities a WHERE a.lead_id = l.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS last_activity_at
     FROM leads l LEFT JOIN properties p ON p.id = l.property_id LEFT JOIN users u ON u.id = l.assigned_to
     WHERE 1=1${s.sql}
     ORDER BY CASE l.priority WHEN 'Hot' THEN 1 WHEN 'Warm' THEN 2 ELSE 3 END, l.updated_at DESC`,
    s.params,
  );
  res.json({ data: rows });
});

/** Duplicate-phone check used while typing a new lead. Other executives' leads are reported without contact details. */
r.get('/duplicates', async (req, res) => {
  const { phone, exclude } = parse(z.object({ phone: z.string().min(4).max(30), exclude: z.coerce.number().int().positive().optional() }), req.query);
  const rows = await findDuplicates(phone, exclude);
  res.json({
    data: rows.map((d: any) => {
      const mine = !isScoped(req.user) || d.assigned_to === req.user.id;
      return mine ? { ...d, accessible: true } : { id: d.id, code: d.code, status: d.status, agent_name: d.agent_name, accessible: false };
    }),
  });
});

async function duplicateError(phone: string, user: AuthUser, excludeId?: number) {
  const [dupe] = await findDuplicates(phone, excludeId);
  if (!dupe) return;
  const accessible = !isScoped(user) || dupe.assigned_to === user.id;
  throw new HttpError(
    409,
    accessible
      ? `A lead with this phone number already exists (${dupe.code} · ${dupe.name})`
      : `This phone number already belongs to lead ${dupe.code}${dupe.agent_name ? `, handled by ${dupe.agent_name}` : ''}.`,
    { code: 'duplicate_phone', duplicate: { id: dupe.id, code: dupe.code, name: accessible ? dupe.name : undefined, agent_name: dupe.agent_name, accessible } },
  );
}

async function assertAssignable(userId: number) {
  const agent = await db.get("SELECT id, name FROM users WHERE id = ? AND status = 'Active' AND role IN ('sales','manager','admin')", [userId]);
  if (!agent) throw new HttpError(422, 'assigned_to: Select an active sales team member');
  return agent as { id: number; name: string };
}

r.post('/', async (req, res) => {
  const body = parse(leadBody, req.body);
  await duplicateError(body.phone, req.user);
  if (body.property_id && !(await db.get('SELECT id FROM properties WHERE id = ?', [body.property_id]))) throw new HttpError(422, 'property_id: Unknown property');
  let assigned = req.user.role === 'sales' ? req.user.id : (body.assigned_to ?? null);
  if (assigned && req.user.role !== 'sales') await assertAssignable(assigned);
  if (!assigned && req.user.role !== 'sales' && body.assigned_to === undefined) assigned = await nextAssignee();
  const now = nowIso();
  const { notes, ...data } = body;
  const id = await insertWithCode('leads', {
    ...data,
    phone_norm: normalizePhone(body.phone),
    status: body.status && !['Booked', 'Closed'].includes(body.status) ? body.status : 'New',
    assigned_to: assigned,
    created_by: req.user.id,
    created_at: now,
    updated_at: now,
  });
  await logActivity({ lead_id: id, type: 'created', title: 'Lead created', description: `Captured from ${body.source}${body.source_detail ? ` · ${body.source_detail}` : ''}`, user_id: req.user.id });
  if (notes) await logActivity({ lead_id: id, type: 'note', title: 'Note added', description: notes, user_id: req.user.id });
  if (assigned && assigned !== req.user.id) {
    await notifyUsers([assigned], { type: 'lead', title: 'New lead assigned', message: `${body.name} (${body.source}) has been assigned to you.`, link: `/leads/${id}`, trigger: 'lead_assigned' });
  }
  res.status(201).json(await getLeadFor(id, req.user));
});

r.post('/bulk-assign', authorize('admin', 'manager'), async (req, res) => {
  const { ids, agent_id } = parse(bulkAssignBody, req.body);
  const agent = await assertAssignable(agent_id);
  let updated = 0;
  await db.transaction(async () => {
    for (const id of ids) {
      const lead = await db.get<{ assigned_to: number | null }>('SELECT assigned_to FROM leads WHERE id = ?', [id]);
      if (!lead || lead.assigned_to === agent_id) continue;
      await db.update('leads', id, { assigned_to: agent_id, updated_at: nowIso() });
      await logActivity({ lead_id: id, type: 'assigned', title: `Assigned to ${agent.name}`, user_id: req.user.id });
      updated++;
    }
  });
  if (updated) {
    await notifyUsers([agent_id], { type: 'lead', title: 'Leads assigned', message: `${updated} lead${updated > 1 ? 's have' : ' has'} been assigned to you by ${req.user.name}.`, link: '/leads', trigger: 'lead_assigned' }, req.user.id);
  }
  res.json({ updated });
});

r.post('/bulk-delete', authorize('admin', 'manager'), dashboardOnly, async (req, res) => {
  const { ids } = parse(bulkIdsBody, req.body);
  const converted = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM leads WHERE customer_id IS NOT NULL AND id IN (${placeholders(ids.length)})`, ids);
  if (converted!.n) throw new HttpError(409, 'Converted leads cannot be deleted. Deselect leads that are already customers.');
  const { changes } = await db.run(`DELETE FROM leads WHERE id IN (${placeholders(ids.length)})`, ids);
  res.json({ deleted: changes });
});

/** CSV import: `dryRun` validates and previews every row; a second call with dryRun=false creates them. */
r.post('/import', authorize('admin', 'manager'), dashboardOnly, async (req, res) => {
  const body = parse(leadImportBody, req.body);
  const assignment = await getSetting('assignment');
  const agents = await db.all<{ id: number; email: string }>("SELECT id, email FROM users WHERE status = 'Active' AND role IN ('sales','manager','admin')");
  const byEmail = new Map(agents.map((a) => [a.email.toLowerCase(), a.id]));
  const seen = new Set<string>();
  const results: { row: number; status: 'ok' | 'error' | 'duplicate'; errors: string[]; data?: Record<string, unknown>; duplicate_of?: string; id?: number }[] = [];
  for (const [i, raw] of body.rows.entries()) {
    const parsed = leadImportRow.safeParse(raw);
    if (!parsed.success) {
      results.push({ row: i + 1, status: 'error', errors: parsed.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`) });
      continue;
    }
    const d = parsed.data;
    const errors: string[] = [];
    let agentId: number | null = null;
    if (d.assigned_email) {
      agentId = byEmail.get(d.assigned_email) ?? null;
      if (!agentId) errors.push(`assigned_email: no active team member with email ${d.assigned_email}`);
    }
    if (errors.length) {
      results.push({ row: i + 1, status: 'error', errors, data: d });
      continue;
    }
    const norm = normalizePhone(d.phone);
    const [dupe] = await findDuplicates(d.phone);
    if (dupe || seen.has(norm)) {
      results.push({ row: i + 1, status: 'duplicate', errors: [dupe ? `phone already used by ${dupe.code}` : 'phone repeated earlier in this file'], data: d, duplicate_of: dupe?.code });
      continue;
    }
    seen.add(norm);
    results.push({ row: i + 1, status: 'ok', errors: [], data: { ...d, assigned_to: agentId } });
  }
  const summary = {
    total: results.length,
    valid: results.filter((x) => x.status === 'ok').length,
    invalid: results.filter((x) => x.status === 'error').length,
    duplicates: results.filter((x) => x.status === 'duplicate').length,
    created: 0,
  };
  if (!body.dryRun) {
    if (summary.invalid) throw new HttpError(422, `Fix the ${summary.invalid} row(s) with errors before importing`, { summary, rows: results });
    if (summary.duplicates && !body.skipDuplicates) throw new HttpError(409, `${summary.duplicates} row(s) duplicate existing leads`, { summary, rows: results });
    const perAgent = new Map<number, number>();
    await db.transaction(async () => {
      const now = nowIso();
      for (const row of results) {
        if (row.status !== 'ok' || !row.data) continue;
        const { assigned_email: _e, assigned_to, ...d } = row.data as any;
        const agent = assigned_to ?? (assignment.apply_to_imports ? await nextAssignee() : null);
        row.id = await insertWithCode('leads', { ...d, phone_norm: normalizePhone(d.phone), status: 'New', assigned_to: agent, created_by: req.user.id, created_at: now, updated_at: now });
        await logActivity({ lead_id: row.id, type: 'created', title: 'Lead imported', description: `Imported from CSV (row ${row.row}) · ${d.source}`, user_id: req.user.id });
        if (agent) perAgent.set(agent, (perAgent.get(agent) ?? 0) + 1);
        summary.created++;
      }
    });
    for (const [agent, n] of perAgent) {
      await notifyUsers([agent], { type: 'lead', title: 'Leads assigned', message: `${n} imported lead${n > 1 ? 's have' : ' has'} been assigned to you.`, link: '/leads', trigger: 'lead_assigned' }, req.user.id);
    }
  }
  res.status(body.dryRun ? 200 : 201).json({ summary, rows: results });
});

r.get('/:id', async (req, res) => {
  const lead = await getLeadFor(idParam(req), req.user);
  const [activities, followups, siteVisits, documents, tasks, property, customer, duplicates] = await Promise.all([
    db.all("SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.lead_id = ? AND a.type != 'audit' ORDER BY a.created_at DESC, a.id DESC", [lead.id]),
    db.all('SELECT f.*, u.name AS agent_name FROM followups f LEFT JOIN users u ON u.id = f.agent_id WHERE f.lead_id = ? ORDER BY f.due_date DESC, f.due_time DESC', [lead.id]),
    db.all(
      `SELECT v.*, u.name AS agent_name, p.project AS property_project, p.unit_number AS property_unit, p.name AS property_name,
         (SELECT COUNT(*) FROM documents d WHERE d.entity_type = 'site_visit' AND d.entity_id = v.id) AS photos
       FROM site_visits v LEFT JOIN users u ON u.id = v.agent_id LEFT JOIN properties p ON p.id = v.property_id
       WHERE v.lead_id = ? ORDER BY v.visit_date DESC, v.visit_time DESC`,
      [lead.id],
    ),
    db.all(
      `SELECT d.*, u.name AS uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE (d.entity_type = 'lead' AND d.entity_id = ?) OR (d.entity_type = 'site_visit' AND d.entity_id IN (SELECT id FROM site_visits WHERE lead_id = ?))
       ORDER BY d.created_at DESC`,
      [lead.id, lead.id],
    ),
    db.all('SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.lead_id = ? ORDER BY t.status, t.due_date', [lead.id]),
    lead.property_id ? db.get('SELECT * FROM properties WHERE id = ?', [lead.property_id]) : null,
    lead.customer_id ? db.get('SELECT id, code, name FROM customers WHERE id = ?', [lead.customer_id]) : null,
    isScoped(req.user) ? [] : findDuplicates(lead.phone, lead.id),
  ]);
  if (property?.amenities) property.amenities = JSON.parse(property.amenities);
  res.json({ ...lead, activities, followups, siteVisits, documents, tasks, property, customer, duplicates });
});

r.put('/:id', async (req, res) => {
  const lead = await getLeadFor(idParam(req), req.user);
  const body = parse(leadBody.partial({ source: true, name: true, phone: true, priority: true }), req.body);
  const { notes, status, ...data } = body;
  if (req.user.role === 'sales') delete data.assigned_to;
  if (data.phone) {
    await duplicateError(data.phone, req.user, lead.id);
    (data as any).phone_norm = normalizePhone(data.phone);
  }
  if (data.assigned_to) await assertAssignable(data.assigned_to);
  await db.update('leads', lead.id, { ...data, updated_at: nowIso() });
  if (data.assigned_to && data.assigned_to !== lead.assigned_to) {
    const agent = await db.get('SELECT name FROM users WHERE id = ?', [data.assigned_to]);
    await logActivity({ lead_id: lead.id, type: 'assigned', title: `Assigned to ${agent?.name ?? 'team member'}`, user_id: req.user.id });
    await notifyUsers([data.assigned_to], { type: 'lead', title: 'Lead assigned to you', message: `${lead.name} has been assigned to you by ${req.user.name}.`, link: `/leads/${lead.id}`, trigger: 'lead_assigned' }, req.user.id);
  }
  if (status && status !== lead.status) {
    if ((status === 'Booked' || status === 'Closed') && !lead.customer_id) throw new HttpError(422, 'Convert this lead to a customer to mark it as Booked');
    await changeLeadStatus(lead.id, status, req.user);
  }
  if (notes) await logActivity({ lead_id: lead.id, type: 'note', title: 'Note added', description: notes, user_id: req.user.id });
  res.json(await db.get(`${LEAD_SELECT} WHERE l.id = ?`, [lead.id]));
});

r.patch('/:id/status', async (req, res) => {
  const lead = await getLeadFor(idParam(req), req.user);
  const { status, reason } = parse(leadStatusBody, req.body);
  if ((status === 'Booked' || status === 'Closed') && !lead.customer_id) {
    throw new HttpError(422, 'Convert this lead to a customer to mark it as Booked');
  }
  if (lead.customer_id && !['Booked', 'Closed'].includes(status)) throw new HttpError(422, 'A converted lead stays Booked or Closed. Cancel the booking from the customer instead.');
  await changeLeadStatus(lead.id, status, req.user, reason);
  res.json(await getLeadFor(lead.id, req.user));
});

r.post('/:id/notes', async (req, res) => {
  const lead = await getLeadFor(idParam(req), req.user);
  const { note } = parse(noteBody, req.body);
  const id = await logActivity({ lead_id: lead.id, customer_id: lead.customer_id, type: 'note', title: 'Note added', description: note, user_id: req.user.id });
  await db.update('leads', lead.id, { updated_at: nowIso() });
  res.status(201).json(await db.get('SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?', [id]));
});

/** Click-to-call / WhatsApp / SMS from either front-end is logged here (the OS app does the actual contact). */
r.post('/:id/log-contact', async (req, res) => {
  const lead = await getLeadFor(idParam(req), req.user);
  const { channel, summary, at } = parse(logContactBody, req.body);
  const first = req.user.name.split(' ')[0];
  const verb = { Call: `Called by ${first}`, WhatsApp: `WhatsApp message sent by ${first}`, SMS: `SMS sent by ${first}`, Email: `Email sent by ${first}` }[channel];
  const when = at && at < nowIso() ? at : nowIso();
  await logActivity({ lead_id: lead.id, customer_id: lead.customer_id, type: channel.toLowerCase(), title: verb, description: summary, user_id: req.user.id, created_at: when });
  await db.update('leads', lead.id, { last_contact: when, updated_at: nowIso() });
  if (lead.status === 'New') await changeLeadStatus(lead.id, 'Contacted', req.user);
  res.json(await getLeadFor(lead.id, req.user));
});

r.post('/:id/convert', async (req, res) => {
  const lead = await getLeadFor(idParam(req), req.user);
  const body = parse(convertBody, req.body);
  if (body.first_due_date <= body.booking_date) throw new HttpError(422, 'first_due_date: First installment must be due after the booking date');
  const customerId = await convertLead(lead.id, body, req.user);
  res.status(201).json({ id: customerId, customer_id: customerId });
});

/** Merges `source_id` into this lead: history, follow-ups, visits, tasks and documents move; the source is deleted. */
r.post('/:id/merge', authorize('admin', 'manager'), async (req, res) => {
  const target = await getLeadFor(idParam(req), req.user);
  const { source_id } = parse(mergeLeadBody, req.body);
  if (source_id === target.id) throw new HttpError(422, 'Choose a different lead to merge');
  const source = await getLeadFor(source_id, req.user);
  if (source.customer_id) throw new HttpError(409, `${source.code} has been converted to a customer and cannot be merged away. Merge the other lead into it instead.`);
  await db.transaction(async () => {
    for (const table of ['followups', 'site_visits', 'tasks', 'activities']) await db.run(`UPDATE ${table} SET lead_id = ? WHERE lead_id = ?`, [target.id, source.id]);
    await db.run("UPDATE documents SET entity_id = ? WHERE entity_type = 'lead' AND entity_id = ?", [target.id, source.id]);
    const fill: Record<string, unknown> = {};
    for (const k of ['email', 'location', 'property_id', 'property_type', 'budget', 'requirement', 'assigned_to', 'last_contact', 'source_detail']) {
      if ((target[k] === null || target[k] === undefined || target[k] === '') && source[k] !== null && source[k] !== undefined) fill[k] = source[k];
    }
    await db.update('leads', target.id, { ...fill, updated_at: nowIso() });
    await db.run('DELETE FROM leads WHERE id = ?', [source.id]);
    await logActivity({ lead_id: target.id, type: 'merged', title: `Merged ${source.code} into this lead`, description: `${source.name} · ${source.phone} · ${source.source}`, user_id: req.user.id });
  });
  const { refreshLeadFollowup } = await import('../services/leads.js');
  await refreshLeadFollowup(target.id);
  res.json(await getLeadFor(target.id, req.user));
});

r.delete('/:id', authorize('admin', 'manager'), async (req, res) => {
  const lead = await getLeadFor(idParam(req), req.user);
  if (lead.customer_id) throw new HttpError(409, 'This lead has been converted to a customer and cannot be deleted');
  await db.run('DELETE FROM leads WHERE id = ?', [lead.id]);
  res.json({ ok: true, id: lead.id });
});

export default r;
