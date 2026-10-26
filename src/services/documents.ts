import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { UPLOAD_ALLOWED } from '@estateflow/shared';
import { config } from '../config.js';
import { db } from '../db/index.js';
import type { AuthUser } from '../middleware/auth.js';
import { HttpError, forbidden } from '../utils/http.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED_TYPES = Object.entries(UPLOAD_ALLOWED);

/** Magic-number sniff for the binary formats we accept, so a renamed executable is refused. */
function sniff(file: string): string | null {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF') return 'image/webp';
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'zip'; // docx/xlsx
  if (buf[0] === 0xd0 && buf[1] === 0xcf) return 'ole'; // doc/xls
  return null;
}

const SNIFF_OK: Record<string, (s: string | null) => boolean> = {
  'application/pdf': (s) => s === 'application/pdf',
  'image/png': (s) => s === 'image/png',
  'image/jpeg': (s) => s === 'image/jpeg',
  'image/webp': (s) => s === 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (s) => s === 'zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (s) => s === 'zip',
  'application/msword': (s) => s === 'ole',
  'application/vnd.ms-excel': (s) => s === 'ole',
  'text/plain': (s) => s === null,
  'text/csv': (s) => s === null,
};

/** Size limit, MIME + extension allowlist, random storage names (the original name is kept only in the DB). */
export const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6)}`),
  }),
  limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok = ALLOWED_TYPES.some(([mime, exts]) => mime === file.mimetype && exts.includes(ext));
    if (ok) cb(null, true);
    else cb(new HttpError(415, 'Only PDF, JPG, PNG, WebP, Word, Excel, CSV or text files can be uploaded'));
  },
});

/** Content check after multer has written the file; deletes it and throws when the bytes do not match the type. */
export function verifyUploadedFile(file: Express.Multer.File) {
  const check = SNIFF_OK[file.mimetype];
  if (!check || !check(sniff(file.path))) {
    fs.rmSync(file.path, { force: true });
    throw new HttpError(415, 'The file content does not match its type. Upload the original PDF, image or office document.');
  }
}

export const filePath = (fileName: string) => path.join(config.uploadDir, path.basename(fileName));

export async function removeEntityDocuments(entityType: string, entityId: number) {
  const docs = await db.all<{ file_name: string }>('SELECT file_name FROM documents WHERE entity_type = ? AND entity_id = ?', [entityType, entityId]);
  await db.run('DELETE FROM documents WHERE entity_type = ? AND entity_id = ?', [entityType, entityId]);
  for (const d of docs) fs.rm(filePath(d.file_name), { force: true }, () => {});
}

/**
 * Customer documents (KYC, agreements, land and registry papers) are open only to the customer
 * themselves, administrators and accounts. Sales executives reach their own leads, deals and visits.
 */
export async function assertDocumentAccess(user: AuthUser, entityType: string, entityId: number) {
  if (user.role === 'customer') {
    if (entityType !== 'customer' || !user.customer_id || entityId !== user.customer_id) throw forbidden();
    return;
  }
  // Private papers: office files for administrators and accounts, personal files for their uploader only.
  if (entityType === 'office') {
    if (!canSeeCustomerDocuments(user)) throw forbidden();
    return;
  }
  if (entityType === 'personal') {
    if (entityId !== user.id) throw forbidden();
    return;
  }
  if (entityType === 'customer' && !canSeeCustomerDocuments(user)) throw forbidden('Customer documents are open only to administrators and accounts');
  if (user.role === 'accounts' && (entityType === 'lead' || entityType === 'site_visit')) throw forbidden();
  if (user.role !== 'sales') return;
  const own: Record<string, [string, string]> = {
    lead: ['SELECT assigned_to AS owner FROM leads WHERE id = ?', 'owner'],
    customer: ['SELECT assigned_to AS owner FROM customers WHERE id = ?', 'owner'],
    deal: ['SELECT agent_id AS owner FROM deals WHERE id = ?', 'owner'],
    site_visit: ['SELECT agent_id AS owner FROM site_visits WHERE id = ?', 'owner'],
  };
  if (entityType === 'property') return;
  const q = own[entityType];
  if (!q) throw forbidden();
  const row = await db.get(q[0], [entityId]);
  if (!row || row.owner !== user.id) throw forbidden();
}

export const ENTITY_TABLE: Record<string, string> = { lead: 'leads', customer: 'customers', property: 'properties', deal: 'deals', site_visit: 'site_visits' };

/** Staff who may open a customer's documents (the customer always sees their own through the portal). */
export const canSeeCustomerDocuments = (user: Pick<AuthUser, 'role'>) => user.role === 'admin' || user.role === 'accounts';
