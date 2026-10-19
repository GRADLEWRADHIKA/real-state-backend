import fs from 'node:fs';
import { type Request, type Response, Router } from 'express';
import type { ImageSize } from '@estateflow/shared';
import { db } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { forbidden, idParam, notFound } from '../utils/http.js';
import { SIZE_COLUMN, absImagePath, verifyMediaSig } from '../images/store.js';

async function loadImage(req: Request) {
  const size = req.params.size as ImageSize;
  if (!(size in SIZE_COLUMN)) throw notFound('Image size');
  const row = await db.get<any>(
    'SELECT i.*, p.is_published FROM property_images i JOIN properties p ON p.id = i.property_id WHERE i.id = ?',
    [idParam(req)],
  );
  if (!row) throw notFound('Image');
  return { row, rel: row[SIZE_COLUMN[size]] as string };
}

function send(res: Response, rel: string, mime: string, cache: string) {
  const file = absImagePath(rel);
  if (!fs.existsSync(file)) throw notFound('Image file');
  res.setHeader('Cache-Control', cache);
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(file);
}

/**
 * Images of unpublished properties: a signed link (issued only to staff and the linked customer
 * inside API responses) or a bearer token from one of those users.
 */
export const mediaRouter = Router();
mediaRouter.get('/:id/:size', async (req, res) => {
  const { row, rel } = await loadImage(req);
  if (!verifyMediaSig(row.id, req.query.exp, req.query.sig)) {
    await new Promise<void>((resolve, reject) => authenticate(req, res, (err?: unknown) => (err ? reject(err) : resolve())).catch(reject));
    if (req.user.role === 'customer') {
      const own = req.user.customer_id && (await db.get("SELECT id FROM customers WHERE id = ? AND property_id = ? AND status != 'Cancelled'", [req.user.customer_id, row.property_id]));
      if (!own) throw forbidden();
    }
  }
  send(res, rel, row.mime, 'private, max-age=86400');
});

/** Images of published properties: public, cacheable for a year (new uploads get new ids). */
export const publicMediaRouter = Router();
publicMediaRouter.get('/:id/:size', async (req, res) => {
  const { row, rel } = await loadImage(req);
  if (!row.is_published) throw notFound('Image');
  send(res, rel, row.mime, 'public, max-age=31536000, immutable');
});
