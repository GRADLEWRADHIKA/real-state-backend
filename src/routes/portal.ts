import fs from 'node:fs';
import { Router } from 'express';
import { customerRequestBody, normalizePhone, portalFeedbackBody, portalUploadFields, referralBody } from '@estateflow/shared';
import { db } from '../db/index.js';
import { authorize } from '../middleware/auth.js';
import { HttpError, parse } from '../utils/http.js';
import { nowIso } from '../utils/dates.js';
import { logActivity } from '../services/activity.js';
import { notifyRoles, notifyUsers } from '../services/notifications.js';
import { customerFinancials, syncInstallmentStatuses } from '../services/payments.js';
import { getSettings } from '../services/settings.js';
import { upload, verifyUploadedFile } from '../services/documents.js';
import { realtime } from '../services/realtime.js';
import { findDuplicates, insertWithCode } from '../services/leads.js';
import { nextAssignee } from '../services/assignment.js';
import { withImages } from '../images/store.js';

/** The customer's own view: everything is keyed on the customer record linked to the login. */
const r = Router();
r.use(authorize('customer'));

function customerId(req: { user: { customer_id: number | null } }) {
  const cid = req.user.customer_id;
  if (!cid) throw new HttpError(404, 'No customer record is linked to this login. Please contact the sales office.');
  return cid;
}

const REQUEST_SELECT = `
  SELECT r.*, h.name AS handled_by_name FROM customer_requests r LEFT JOIN users h ON h.id = r.handled_by`;

r.get('/', async (req, res) => {
  const cid = customerId(req);
  await syncInstallmentStatuses();
  const customer = await db.get(
    `SELECT c.*, u.name AS agent_name, u.phone AS agent_phone, u.email AS agent_email
     FROM customers c LEFT JOIN users u ON u.id = c.assigned_to WHERE c.id = ?`,
    [cid],
  );
  if (!customer) throw new HttpError(404, 'Customer record not found');
  const [property, deal, installments, transactions, documents, financials, settings, requests] = await Promise.all([
    customer.property_id ? db.get('SELECT * FROM properties WHERE id = ?', [customer.property_id]) : null,
    db.get('SELECT code, stage, booking_date, value, booking_amount FROM deals WHERE customer_id = ? ORDER BY id DESC LIMIT 1', [cid]),
    db.all('SELECT id, number, label, due_date, amount, paid_amount, amount - paid_amount AS balance, status, payment_date FROM installments WHERE customer_id = ? ORDER BY number', [cid]),
    db.all(
      `SELECT t.id, t.code, t.receipt_number, t.type, t.amount, t.method, t.payment_date, t.reference, t.status, i.label AS installment_label
       FROM transactions t LEFT JOIN installments i ON i.id = t.installment_id
       WHERE t.customer_id = ? AND t.status != 'Failed' ORDER BY t.payment_date DESC, t.id DESC`,
      [cid],
    ),
    db.all(
      `SELECT d.id, d.name, d.doc_type, d.size, d.mime, d.created_at, d.uploaded_by = ? AS mine
       FROM documents d WHERE d.entity_type = 'customer' AND d.entity_id = ? ORDER BY d.created_at DESC`,
      [req.user.id, cid],
    ),
    customerFinancials(cid),
    getSettings(),
    db.all(`${REQUEST_SELECT} WHERE r.customer_id = ? ORDER BY r.created_at DESC LIMIT 50`, [cid]),
  ]);
  if (property?.amenities) property.amenities = JSON.parse(property.amenities);
  // Only the customer's own property: its gallery, with links signed for this customer.
  const withGallery = property ? (await withImages([property]))[0] : null;
  res.json({
    customer,
    property: withGallery,
    gallery: withGallery?.images ?? [],
    deal: deal ?? null,
    installments,
    transactions,
    documents: documents.map((d) => ({ ...d, mine: !!d.mine })),
    financials,
    company: settings.company,
    requests,
  });
});

// ─── Requests (visit, query, document, payment, complaint) ───────────────
r.get('/requests', async (req, res) => {
  const cid = customerId(req);
  res.json({ data: await db.all(`${REQUEST_SELECT} WHERE r.customer_id = ? ORDER BY r.created_at DESC`, [cid]) });
});

// ─── Feedback ─────────────────────────────────────────────────────────────
r.get('/feedback', async (req, res) => {
  const cid = customerId(req);
  res.json({ data: await db.all("SELECT id, kind, rating, comment, created_at FROM feedback WHERE customer_id = ? AND kind != 'site_visit' ORDER BY created_at DESC", [cid]) });
});

/** The buyer rates possession (once) or the service in general (any time). */
r.post('/feedback', async (req, res) => {
  const cid = customerId(req);
  const body = parse(portalFeedbackBody, req.body);
  const customer = await db.get('SELECT id, name, assigned_to, lead_id FROM customers WHERE id = ?', [cid]);
  if (body.kind === 'possession' && (await db.get("SELECT id FROM feedback WHERE customer_id = ? AND kind = 'possession'", [cid]))) {
    throw new HttpError(409, 'You have already rated your possession. Thank you!');
  }
  const id = await db.insert('feedback', {
    kind: body.kind,
    rating: body.rating,
    comment: body.comment ?? null,
    customer_id: cid,
    lead_id: customer.lead_id,
    agent_id: customer.assigned_to,
    given_by: 'customer',
    created_by: req.user.id,
    created_at: nowIso(),
  });
  await logActivity({ customer_id: cid, lead_id: customer.lead_id, type: 'feedback', title: `${body.kind === 'possession' ? 'Possession' : 'Service'} rated ${body.rating}/5`, description: body.comment ?? null, user_id: req.user.id });
  await notifyRoles(['admin', 'manager'], {
    type: body.rating <= 2 ? 'alert' : 'info',
    title: body.rating <= 2 ? 'Low customer rating' : 'New customer feedback',
    message: `${customer.name} rated ${body.kind === 'possession' ? 'possession' : 'our service'} ${body.rating}/5${body.comment ? `: ${body.comment}` : ''}.`,
    link: '/feedback',
  });
  res.status(201).json(await db.get('SELECT id, kind, rating, comment, created_at FROM feedback WHERE id = ?', [id]));
});

// ─── Referrals ────────────────────────────────────────────────────────────
r.get('/referrals', async (req, res) => {
  const cid = customerId(req);
  res.json({ data: await db.all('SELECT id, code, name, phone, status, created_at FROM leads WHERE referred_by_customer_id = ? ORDER BY created_at DESC', [cid]) });
});

/** A buyer refers a friend: the friend becomes a lead tagged to them, with their relationship manager. */
r.post('/referrals', async (req, res) => {
  const cid = customerId(req);
  const body = parse(referralBody, req.body);
  const customer = await db.get('SELECT id, code, name, assigned_to, lead_id FROM customers WHERE id = ?', [cid]);
  if ((await findDuplicates(body.phone)).length) throw new HttpError(409, 'phone: This number is already with our sales team. Thank you for the referral!');
  const agent = (customer.assigned_to && (await db.get("SELECT id FROM users WHERE id = ? AND status = 'Active'", [customer.assigned_to]))?.id) || (await nextAssignee());
  const now = nowIso();
  const id = await insertWithCode('leads', {
    name: body.name,
    phone: body.phone,
    phone_norm: normalizePhone(body.phone),
    source: 'Referral',
    source_detail: `Referred by ${customer.name} (${customer.code})`,
    requirement: body.note ?? null,
    status: 'New',
    priority: 'Warm',
    assigned_to: agent ?? null,
    referred_by_customer_id: cid,
    created_at: now,
    updated_at: now,
  });
  await logActivity({ lead_id: id, type: 'created', title: 'Lead created', description: `Referred by customer ${customer.name} (${customer.code})${body.note ? ` · ${body.note}` : ''}`, user_id: req.user.id });
  await logActivity({ customer_id: cid, lead_id: customer.lead_id, type: 'referral', title: `Referred ${body.name}`, user_id: req.user.id });
  const n = { type: 'lead', title: 'New referral', message: `${customer.name} referred ${body.name} (${body.phone}).`, link: `/leads/${id}`, trigger: 'lead_assigned' as const };
  if (agent) await notifyUsers([agent], n);
  await notifyRoles(['manager'], n);
  res.status(201).json(await db.get('SELECT id, code, name, phone, status, created_at FROM leads WHERE id = ?', [id]));
});

r.post('/requests', async (req, res) => {
  const cid = customerId(req);
  const body = parse(customerRequestBody, req.body);
  const customer = await db.get('SELECT id, name, assigned_to, lead_id FROM customers WHERE id = ?', [cid]);
  const id = await db.insert('customer_requests', {
    customer_id: cid,
    user_id: req.user.id,
    type: body.type,
    subject: body.subject,
    message: body.message ?? null,
    preferred_date: body.preferred_date ?? null,
    status: 'Open',
    created_at: nowIso(),
  });
  await logActivity({ customer_id: cid, lead_id: customer.lead_id, type: 'request', title: `${body.type} request: ${body.subject}`, description: body.message ?? null, user_id: req.user.id });
  const n = { type: 'request', title: `${body.type} request from ${customer.name}`, message: body.subject, link: `/customers/${cid}?tab=requests`, trigger: 'customer_request' as const };
  if (customer.assigned_to) await notifyUsers([customer.assigned_to], n);
  else await notifyRoles(['manager'], n);
  if (body.type === 'Payment') await notifyRoles(['accounts'], n);
  res.status(201).json(await db.get(`${REQUEST_SELECT} WHERE r.id = ?`, [id]));
});

// ─── Own document uploads (KYC and requirements) ─────────────────────────
r.post('/documents', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(422, 'file: Choose a file to upload');
  try {
    const cid = customerId(req);
    verifyUploadedFile(req.file);
    const data = parse(portalUploadFields, req.body);
    const id = await db.insert('documents', {
      entity_type: 'customer',
      entity_id: cid,
      doc_type: data.doc_type,
      name: (data.name || req.file.originalname).slice(0, 160),
      file_name: req.file.filename,
      mime: req.file.mimetype,
      size: req.file.size,
      uploaded_by: req.user.id,
      created_at: nowIso(),
    });
    const customer = await db.get('SELECT name, assigned_to, lead_id FROM customers WHERE id = ?', [cid]);
    await logActivity({ customer_id: cid, lead_id: customer.lead_id, type: 'document', title: `${data.doc_type} uploaded by customer`, description: data.name || req.file.originalname, user_id: req.user.id });
    await notifyUsers([customer.assigned_to], { type: 'document', title: 'Customer uploaded a document', message: `${customer.name} uploaded ${data.doc_type}.`, link: `/customers/${cid}?tab=documents` });
    realtime.change(['portal', 'documents'], { userIds: [req.user.id] });
    res.status(201).json(await db.get('SELECT id, name, doc_type, size, mime, created_at FROM documents WHERE id = ?', [id]));
  } catch (err) {
    fs.rm(req.file.path, { force: true }, () => {});
    throw err;
  }
});

export default r;
