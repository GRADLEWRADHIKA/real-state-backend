import fs from 'node:fs';
import { Router } from 'express';
import { documentListQuery, documentUploadFields } from '@estateflow/shared';
import { db } from '../db/index.js';
import { adminAppReadOnly, authorize } from '../middleware/auth.js';
import { HttpError, attachmentHeader, forbidden, idParam, likeParam, notFound, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { nowIso } from '../utils/dates.js';
import { logActivity } from '../services/activity.js';
import { ENTITY_TABLE, assertDocumentAccess, filePath, upload, verifyUploadedFile } from '../services/documents.js';

const r = Router();

const SELECT = `
  SELECT d.id, d.entity_type, d.entity_id, d.name, d.doc_type, d.mime, d.size, d.uploaded_by, d.created_at, u.name AS uploaded_by_name,
    CASE d.entity_type
      WHEN 'lead' THEN (SELECT name FROM leads WHERE id = d.entity_id)
      WHEN 'customer' THEN (SELECT name FROM customers WHERE id = d.entity_id)
      WHEN 'property' THEN (SELECT project || ' · ' || unit_number FROM properties WHERE id = d.entity_id)
      WHEN 'deal' THEN (SELECT code FROM deals WHERE id = d.entity_id)
      WHEN 'site_visit' THEN (SELECT 'Visit · ' || l.name FROM site_visits v JOIN leads l ON l.id = v.lead_id WHERE v.id = d.entity_id)
    END AS entity_name
  FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by`;

r.get('/', authorize('admin', 'manager', 'sales', 'accounts'), async (req, res) => {
  const q = parseQuery(documentListQuery, req);
  const p = paging(q, 50);
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (q.entity_type) { where += ' AND d.entity_type = ?'; params.push(q.entity_type); }
  if (q.entity_id) { where += ' AND d.entity_id = ?'; params.push(q.entity_id); }
  if (q.doc_type) { where += ' AND d.doc_type = ?'; params.push(q.doc_type); }
  if (q.q) { where += ' AND d.name LIKE ?'; params.push(likeParam(q.q)); }
  if (req.user.role === 'sales') {
    where += ` AND ((d.entity_type = 'lead' AND d.entity_id IN (SELECT id FROM leads WHERE assigned_to = ?))
      OR (d.entity_type = 'customer' AND d.entity_id IN (SELECT id FROM customers WHERE assigned_to = ?))
      OR d.entity_type = 'property'
      OR (d.entity_type = 'deal' AND d.entity_id IN (SELECT id FROM deals WHERE agent_id = ?))
      OR (d.entity_type = 'site_visit' AND d.entity_id IN (SELECT id FROM site_visits WHERE agent_id = ?)))`;
    params.push(req.user.id, req.user.id, req.user.id, req.user.id);
  }
  if (req.user.role === 'accounts') where += " AND d.entity_type IN ('customer','property','deal')";
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM documents d ${where}`, params))!.n;
  const types = await db.all(`SELECT d.doc_type, COUNT(*) AS n FROM documents d ${where} GROUP BY d.doc_type`, params);
  const data = await db.all(`${SELECT} ${where} ORDER BY d.created_at DESC, d.id DESC LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  res.json({ data, meta: pageMeta(total, p, { types }) });
});

r.post('/', authorize('admin', 'manager', 'sales', 'accounts'), adminAppReadOnly, upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(422, 'file: Choose a file to upload');
  try {
    verifyUploadedFile(req.file);
    const data = parse(documentUploadFields, req.body);
    await assertDocumentAccess(req.user, data.entity_type, data.entity_id);
    if (data.entity_type === 'property' && !['admin', 'manager'].includes(req.user.role)) throw forbidden('Only managers can add property documents');
    const linked = await db.get(`SELECT * FROM ${ENTITY_TABLE[data.entity_type]} WHERE id = ?`, [data.entity_id]);
    if (!linked) throw notFound('Linked record');
    const id = await db.insert('documents', {
      entity_type: data.entity_type,
      entity_id: data.entity_id,
      doc_type: data.doc_type,
      name: (data.name || req.file.originalname).slice(0, 160),
      file_name: req.file.filename,
      mime: req.file.mimetype,
      size: req.file.size,
      uploaded_by: req.user.id,
      created_at: nowIso(),
    });
    const timeline =
      data.entity_type === 'lead' ? { lead_id: data.entity_id } : data.entity_type === 'customer' ? { customer_id: data.entity_id, lead_id: linked.lead_id } : data.entity_type === 'site_visit' ? { lead_id: linked.lead_id } : null;
    if (timeline) {
      await logActivity({ ...timeline, type: 'document', title: data.entity_type === 'site_visit' ? 'Site visit photo added' : `${data.doc_type} uploaded`, description: data.name || req.file.originalname, user_id: req.user.id });
    }
    res.status(201).json(await db.get(`${SELECT} WHERE d.id = ?`, [id]));
  } catch (err) {
    fs.rm(req.file.path, { force: true }, () => {});
    throw err;
  }
});

/** Download (or `?inline=1` preview). Authorisation is checked against the linked record on every request. */
r.get('/:id/download', async (req, res) => {
  const doc = await db.get('SELECT * FROM documents WHERE id = ?', [idParam(req)]);
  if (!doc) throw notFound('Document');
  await assertDocumentAccess(req.user, doc.entity_type, doc.entity_id);
  const file = filePath(doc.file_name);
  if (!fs.existsSync(file)) throw new HttpError(410, 'The file for this document is no longer available');
  const inline = req.query.inline === '1' && /^(application\/pdf|image\/)/.test(doc.mime ?? '');
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', inline ? `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}` : attachmentHeader(doc.name));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(file).pipe(res);
});

r.delete('/:id', authorize('admin', 'manager', 'sales', 'accounts'), adminAppReadOnly, async (req, res) => {
  const doc = await db.get('SELECT * FROM documents WHERE id = ?', [idParam(req)]);
  if (!doc) throw notFound('Document');
  await assertDocumentAccess(req.user, doc.entity_type, doc.entity_id);
  if ((req.user.role === 'sales' || req.user.role === 'accounts') && doc.uploaded_by !== req.user.id) throw forbidden('You can only delete documents you uploaded');
  await db.run('DELETE FROM documents WHERE id = ?', [doc.id]);
  fs.rm(filePath(doc.file_name), { force: true }, () => {});
  res.json({ ok: true, id: doc.id });
});

export default r;
