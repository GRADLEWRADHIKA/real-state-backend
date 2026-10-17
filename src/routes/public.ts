import crypto from 'node:crypto';
import { Router } from 'express';
import { publicLeadBody } from '@estateflow/shared';
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

/**
 * Website / landing-page lead capture. Authenticated by the API key generated in
 * Settings → Lead capture (sent as `X-Api-Key`); no user session is involved.
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

  // A repeat enquiry from a known number is added to that lead instead of creating a duplicate.
  const [existing] = await findDuplicates(body.phone);
  if (existing) {
    await logActivity({ lead_id: existing.id, type: 'enquiry', title: `New enquiry via ${source}`, description });
    await db.update('leads', existing.id, { updated_at: nowIso() });
    const lead = await db.get<{ assigned_to: number | null; name: string }>('SELECT assigned_to, name FROM leads WHERE id = ?', [existing.id]);
    const n = { type: 'lead', title: 'Repeat enquiry', message: `${lead!.name} enquired again via ${source}.`, link: `/leads/${existing.id}` };
    if (lead?.assigned_to) await notifyUsers([lead.assigned_to], n);
    else await notifyRoles(['manager'], n);
    return res.status(200).json({ ok: true, status: 'merged' });
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
    source_detail: body.campaign ?? null,
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
  await logActivity({ lead_id: id, type: 'created', title: 'Lead created', description: `Captured from ${source} (website form)${body.campaign ? ` · ${body.campaign}` : ''}` });
  const n = { type: 'lead', title: 'New website lead', message: `${body.name} (${source}) ${assigned ? 'has been assigned to you' : 'is waiting to be assigned'}.`, link: `/leads/${id}`, trigger: 'lead_assigned' as const };
  if (assigned) await notifyUsers([assigned], n);
  else await notifyRoles(['manager'], n);
  res.status(201).json({ ok: true, status: 'created' });
});

export default r;
