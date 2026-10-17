import type { Request } from 'express';
import { ZodError, type ZodType } from 'zod';
import { DEFAULT_PAGE_SIZE, type PageMeta } from '@estateflow/shared';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
export const forbidden = (msg = 'You do not have permission to perform this action') => new HttpError(403, msg);

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = issue?.path.join('.');
      throw new HttpError(422, field ? `${field}: ${issue.message}` : issue?.message || 'Invalid input', err.issues);
    }
    throw err;
  }
}

/** Validates req.query; unknown keys are ignored, bad values are a 400. */
export function parseQuery<T>(schema: ZodType<T>, req: Request): T {
  try {
    return schema.parse(req.query);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      throw new HttpError(400, `Invalid query parameter ${issue?.path.join('.') || ''}: ${issue?.message}`.trim(), err.issues);
    }
    throw err;
  }
}

export function idParam(req: Request, name = 'id'): number {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id');
  return id;
}

export interface Paging {
  page: number;
  limit: number;
  offset: number;
}

/** page/limit (or legacy pageSize) or an opaque cursor from a previous response. */
export function paging(q: { page?: number; limit?: number; pageSize?: number; cursor?: string }, defaultLimit = DEFAULT_PAGE_SIZE): Paging {
  const limit = q.limit ?? q.pageSize ?? defaultLimit;
  let page = q.page ?? 1;
  if (q.cursor) {
    const n = Number(Buffer.from(q.cursor, 'base64url').toString());
    if (Number.isInteger(n) && n > 0) page = n;
  }
  return { page, limit, offset: (page - 1) * limit };
}

export function pageMeta<M extends Record<string, unknown>>(total: number, p: Paging, extra?: M): PageMeta & M {
  const pages = Math.max(1, Math.ceil(total / p.limit));
  const hasMore = p.page < pages && total > 0;
  return {
    page: p.page,
    limit: p.limit,
    total,
    pages,
    hasMore,
    nextCursor: hasMore ? Buffer.from(String(p.page + 1)).toString('base64url') : null,
    ...(extra ?? ({} as M)),
  };
}

/** Whitelisted ORDER BY: unknown sort keys fall back to the default. */
export function orderBy(sorts: Record<string, string>, sort: string | undefined, order: 'asc' | 'desc' | undefined, fallback: string, defaultOrder: 'asc' | 'desc' = 'desc') {
  const col = (sort && sorts[sort]) || fallback;
  return `${col} ${(order ?? defaultOrder) === 'asc' ? 'ASC' : 'DESC'}`;
}

export const likeParam = (q: string) => `%${q.trim()}%`;
export const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** Sends a file download with a safe Content-Disposition. */
export function attachmentHeader(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
