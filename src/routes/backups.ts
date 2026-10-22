import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { authorize, dashboardOnly } from '../middleware/auth.js';
import { HttpError, attachmentHeader, notFound } from '../utils/http.js';
import { BACKUP_NAME, backupDir, createBackup, listBackups } from '../services/backup.js';

/** Administrators see the automatic daily backups, take one now and download any of them. */
const r = Router();
r.use(authorize('admin'), dashboardOnly);

r.get('/', (_req, res) => {
  res.json({ data: listBackups(), meta: { folder: backupDir() } });
});

r.post('/', async (_req, res) => {
  res.status(201).json(await createBackup(true));
});

r.get('/:name', (req, res) => {
  const name = String(req.params.name);
  if (!BACKUP_NAME.test(name)) throw new HttpError(400, 'Invalid backup name');
  const file = path.join(backupDir(), name);
  if (!fs.existsSync(file)) throw notFound('Backup');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', attachmentHeader(name));
  fs.createReadStream(file).pipe(res);
});

export default r;
