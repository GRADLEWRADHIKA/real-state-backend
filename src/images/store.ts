/**
 * Property image storage: processing (sharp), files on disk, DB rows, cover rules and URLs.
 * Uploaded and generated images go through the same pipeline.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ImageSize, PropertyImage } from '@estateflow/shared';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { log } from '../logger.js';
import { HttpError, notFound, placeholders } from '../utils/http.js';
import { nowIso } from '../utils/dates.js';
import { loadSharp } from './sharp.js';

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const IMAGE_EXT: Record<string, string[]> = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] };
const WIDTHS: Record<ImageSize, number> = { thumb: 400, medium: 900, large: 1600 };

export const imageDir = (propertyId: number) => path.join(config.uploadDir, 'property-images', String(propertyId));

/** Stored path (relative to the upload dir) → absolute, refusing anything outside it. */
export function absImagePath(rel: string) {
  const abs = path.resolve(config.uploadDir, rel);
  if (!abs.startsWith(path.resolve(config.uploadDir) + path.sep)) throw new HttpError(400, 'Invalid image path');
  return abs;
}

/** Magic-number check: JPEG, PNG or WebP only. */
export function sniffImage(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

interface Processed {
  paths: Record<ImageSize, string>;
  width: number | null;
  height: number | null;
  size: number;
  mime: string;
}

/**
 * Auto-orients, strips EXIF/GPS (sharp drops metadata unless asked to keep it) and writes WebP at
 * 400/900/1600 px. Without sharp the original bytes are stored and served for every size.
 */
export async function processImage(propertyId: number, buf: Buffer, mime: string): Promise<Processed> {
  const dir = imageDir(propertyId);
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomUUID();
  const rel = (name: string) => path.relative(config.uploadDir, path.join(dir, name)).split(path.sep).join('/');
  const sharp = await loadSharp();
  if (sharp) {
    try {
      const base = sharp(buf, { failOn: 'error' }).rotate();
      const meta = await base.clone().metadata();
      const paths = {} as Record<ImageSize, string>;
      let size = 0;
      let out = { width: meta.width ?? null, height: meta.height ?? null };
      for (const [k, w] of Object.entries(WIDTHS) as [ImageSize, number][]) {
        const r = await base.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: k === 'thumb' ? 72 : 80 }).toBuffer({ resolveWithObject: true });
        const name = `${id}-${w}.webp`;
        fs.writeFileSync(path.join(dir, name), r.data);
        paths[k] = rel(name);
        if (k === 'large') {
          size = r.data.length;
          out = { width: r.info.width, height: r.info.height };
        }
      }
      return { paths, ...out, size, mime: 'image/webp' };
    } catch (err) {
      throw new HttpError(422, `This image could not be read (${err instanceof Error ? err.message : 'unknown error'}). Upload a JPG, PNG or WebP photo.`);
    }
  }
  log.warn('sharp unavailable: storing the original image without resizing', { propertyId });
  const ext = IMAGE_EXT[mime]?.[0] ?? '.img';
  const name = `${id}${ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return { paths: { thumb: rel(name), medium: rel(name), large: rel(name) }, width: null, height: null, size: buf.length, mime };
}

export interface NewImage {
  buffer: Buffer;
  mime: string;
  alt_text: string;
  caption?: string | null;
  kind?: string;
  is_ai_generated?: boolean;
  source?: 'upload' | 'generated';
  cover?: boolean;
}

/** Processes and inserts one image; the first image of a property becomes its cover. */
export async function addImage(propertyId: number, img: NewImage) {
  const p = await processImage(propertyId, img.buffer, img.mime);
  try {
    return await db.transaction(async () => {
      const stats = (await db.get<{ n: number; covers: number; last: number | null }>(
        'SELECT COUNT(*) AS n, SUM(is_cover) AS covers, MAX(sort_order) AS last FROM property_images WHERE property_id = ?',
        [propertyId],
      ))!;
      const cover = img.cover || !stats.covers;
      if (cover) await db.run('UPDATE property_images SET is_cover = 0 WHERE property_id = ?', [propertyId]);
      return db.insert('property_images', {
        property_id: propertyId,
        file_path: p.paths.large,
        medium_path: p.paths.medium,
        thumb_path: p.paths.thumb,
        alt_text: img.alt_text.slice(0, 240),
        caption: img.caption ?? null,
        kind: img.kind ?? 'other',
        is_cover: cover,
        is_ai_generated: !!img.is_ai_generated,
        source: img.source ?? 'upload',
        sort_order: (stats.last ?? -1) + 1,
        width: p.width,
        height: p.height,
        size: p.size,
        mime: p.mime,
        created_at: nowIso(),
      });
    });
  } catch (err) {
    removeFiles([p.paths.large, p.paths.medium, p.paths.thumb]);
    throw err;
  }
}

function removeFiles(rels: string[]) {
  for (const rel of new Set(rels)) {
    try {
      fs.rmSync(absImagePath(rel), { force: true });
    } catch {
      /* already gone */
    }
  }
}

/** Ensures exactly one cover when a property has images (promotes the first by order). */
export async function ensureCover(propertyId: number) {
  const has = await db.get('SELECT id FROM property_images WHERE property_id = ? AND is_cover = 1', [propertyId]);
  if (has) return;
  const first = await db.get<{ id: number }>('SELECT id FROM property_images WHERE property_id = ? ORDER BY sort_order, id LIMIT 1', [propertyId]);
  if (first) await db.run('UPDATE property_images SET is_cover = 1 WHERE id = ?', [first.id]);
}

export async function setCover(propertyId: number, imageId: number) {
  await db.transaction(async () => {
    const img = await db.get('SELECT id FROM property_images WHERE id = ? AND property_id = ?', [imageId, propertyId]);
    if (!img) throw notFound('Image');
    await db.run('UPDATE property_images SET is_cover = 0 WHERE property_id = ?', [propertyId]);
    await db.run('UPDATE property_images SET is_cover = 1 WHERE id = ?', [imageId]);
  });
}

export async function reorderImages(propertyId: number, ids: number[]) {
  await db.transaction(async () => {
    const rows = await db.all<{ id: number }>('SELECT id FROM property_images WHERE property_id = ?', [propertyId]);
    const own = new Set(rows.map((r) => r.id));
    if (ids.length !== own.size || !ids.every((id) => own.has(id))) throw new HttpError(422, 'ids: Send every image of this property exactly once');
    for (const [i, id] of ids.entries()) await db.run('UPDATE property_images SET sort_order = ? WHERE id = ?', [i, id]);
  });
}

/** Deletes rows (and their files) matching a filter on one property, keeping one cover. */
export async function deleteImages(propertyId: number, where = '1=1', params: unknown[] = []) {
  const rows = await db.all<{ file_path: string; medium_path: string; thumb_path: string }>(
    `SELECT file_path, medium_path, thumb_path FROM property_images WHERE property_id = ? AND ${where}`,
    [propertyId, ...params],
  );
  await db.transaction(async () => {
    await db.run(`DELETE FROM property_images WHERE property_id = ? AND ${where}`, [propertyId, ...params]);
    await ensureCover(propertyId);
  });
  removeFiles(rows.flatMap((r) => [r.file_path, r.medium_path, r.thumb_path]));
  return rows.length;
}

export async function removePropertyImageFiles(propertyId: number) {
  fs.rmSync(imageDir(propertyId), { recursive: true, force: true });
}

// ─── URLs ────────────────────────────────────────────────────────────────
/** Signed links for unpublished images. Valid until the end of the next day so browsers can cache them. */
export function signMedia(id: number, now = Date.now()) {
  const exp = Math.floor(now / 86_400_000) * 86_400 + 2 * 86_400;
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(`media:${id}:${exp}`).digest('base64url').slice(0, 27);
  return { exp, sig };
}

export function verifyMediaSig(id: number, exp: unknown, sig: unknown) {
  const e = Number(exp);
  if (!e || typeof sig !== 'string' || e * 1000 < Date.now()) return false;
  const want = crypto.createHmac('sha256', config.jwtSecret).update(`media:${id}:${e}`).digest('base64url').slice(0, 27);
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

const SIZES: ImageSize[] = ['thumb', 'medium', 'large'];

export function toDto(row: any, published: boolean): PropertyImage {
  const q = published ? '' : (() => {
    const { exp, sig } = signMedia(row.id);
    return `?exp=${exp}&sig=${sig}`;
  })();
  const base = published ? `/api/public/media/${row.id}` : `/api/media/${row.id}`;
  return {
    id: row.id,
    property_id: row.property_id,
    alt_text: row.alt_text,
    caption: row.caption,
    kind: row.kind,
    is_cover: !!row.is_cover,
    is_ai_generated: !!row.is_ai_generated,
    source: row.source,
    sort_order: row.sort_order,
    width: row.width,
    height: row.height,
    size: row.size,
    urls: Object.fromEntries(SIZES.map((s) => [s, `${base}/${s}${q}`])) as Record<ImageSize, string>,
  };
}

/** Adds `cover` and `images` to property rows (one query for the whole page). */
export async function withImages<T extends { id: number; is_published?: number | boolean }>(props: T[], opts: { forcePublic?: boolean } = {}) {
  if (!props.length) return props as (T & { cover: PropertyImage | null; images: PropertyImage[] })[];
  const rows = await db.all(`SELECT * FROM property_images WHERE property_id IN (${placeholders(props.length)}) ORDER BY sort_order, id`, props.map((p) => p.id));
  const by = new Map<number, any[]>();
  for (const r of rows) by.set(r.property_id, [...(by.get(r.property_id) ?? []), r]);
  return props.map((p) => {
    const images = (by.get(p.id) ?? []).map((r) => toDto(r, opts.forcePublic || !!p.is_published));
    return { ...p, is_published: !!p.is_published, cover: images.find((i) => i.is_cover) ?? images[0] ?? null, images };
  });
}

export const SIZE_COLUMN: Record<ImageSize, 'thumb_path' | 'medium_path' | 'file_path'> = { thumb: 'thumb_path', medium: 'medium_path', large: 'file_path' };
