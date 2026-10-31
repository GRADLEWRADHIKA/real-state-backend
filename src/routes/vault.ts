import fs from 'node:fs';
import { Router } from 'express';
import { PRIVATE_FOLDERS, listQuery } from '@estateflow/shared';
import { z } from 'zod';
import { db } from '../db/index.js';
import { authorize, type AuthUser } from '../middleware/auth.js';
import { HttpError, likeParam, pageMeta, paging, parse, parseQuery } from '../utils/http.js';
import { nowIso } from '../utils/dates.js';
import { upload, verifyUploadedFile } from '../services/documents.js';

/**
 * The owner's and accountant's own papers (sales reports, logs, lead papers, bills; personal KYC and tax),
 * kept apart from customer files. Office documents are shared by administrators and accounts; personal
 * documents belong to the person who uploaded them. Download and delete go through /api/documents/:id.
 */
const r = Router();
r.use(authorize('admin', 'accounts'));

const folders = PRIVATE_FOLDERS.map((f) => f.key) as ['office', 'personal'];
const owner = (folder: string, user: AuthUser) => (folder === 'personal' ? user.id : 0);
const SELECT = 'SELECT d.id, d.entity_type, d.entity_id, d.name, d.doc_type, d.mime, d.size, d.uploaded_by, d.created_at, u.name AS uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by';

r.get('/', async (req, res) => {
  const q = parseQuery(listQuery.extend({ folder: z.enum(folders), q: z.string().trim().max(120).optional(), doc_type: z.string().trim().max(60).optional() }), req);
  const p = paging(q, 500);
  let where = 'WHERE d.entity_type = ? AND d.entity_id = ?';
  const params: unknown[] = [q.folder, owner(q.folder, req.user)];
  if (q.doc_type) { where += ' AND d.doc_type = ?'; params.push(q.doc_type); }
  if (q.q) { where += ' AND d.name LIKE ?'; params.push(likeParam(q.q)); }
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM documents d ${where}`, params))!.n;
  const data = await db.all(`${SELECT} ${where} ORDER BY d.created_at DESC, d.id DESC LIMIT ? OFFSET ?`, [...params, p.limit, p.offset]);
  const counts = await db.all("SELECT entity_type AS folder, COUNT(*) AS n FROM documents WHERE (entity_type = 'office' AND entity_id = 0) OR (entity_type = 'personal' AND entity_id = ?) GROUP BY entity_type", [req.user.id]);
  res.json({ data, meta: pageMeta(total, p, { counts: Object.fromEntries(counts.map((c) => [c.folder, c.n])) }) });
});

r.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(422, 'file: Choose a file to upload');
  try {
    verifyUploadedFile(req.file);
    const data = parse(z.object({ folder: z.enum(folders), doc_type: z.string().trim().min(1).max(60), name: z.string().trim().max(160).optional() }), req.body);
    const folder = PRIVATE_FOLDERS.find((f) => f.key === data.folder)!;
    if (!(folder.types as readonly string[]).includes(data.doc_type)) throw new HttpError(422, `doc_type: Choose one of ${folder.types.join(', ')}`);
    const id = await db.insert('documents', {
      entity_type: data.folder,
      entity_id: owner(data.folder, req.user),
      doc_type: data.doc_type,
      name: (data.name || req.file.originalname).slice(0, 160),
      file_name: req.file.filename,
      mime: req.file.mimetype,
      size: req.file.size,
      uploaded_by: req.user.id,
      created_at: nowIso(),
    });
    res.status(201).json(await db.get(`${SELECT} WHERE d.id = ?`, [id]));
  } catch (err) {
    fs.rm(req.file.path, { force: true }, () => {});
    throw err;
  }
});

export default r;
