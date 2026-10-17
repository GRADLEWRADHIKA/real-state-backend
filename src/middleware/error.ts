import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { log } from '../logger.js';
import { HttpError } from '../utils/http.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found`, requestId: req.requestId });
}

/** Every error body is `{ error, details?, requestId }`; the request id matches the X-Request-Id header and the log line. */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.requestId;
  const send = (status: number, error: string, details?: unknown) => res.status(status).json({ error, ...(details !== undefined ? { details } : {}), requestId });
  if (err instanceof HttpError) return send(err.status, err.message, err.details);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return send(413, `file: Files must be ${Math.round(config.uploadMaxBytes / 1048576)} MB or smaller`);
    return send(400, err.code === 'LIMIT_UNEXPECTED_FILE' ? 'file: Upload one file in the "file" field' : err.message);
  }
  if (err?.type === 'entity.parse.failed') return send(400, 'Malformed JSON body');
  if (err?.type === 'entity.too.large') return send(413, 'Request body is too large');
  if (typeof err?.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
    return send(409, String(err.message).includes('UNIQUE') ? 'A record with these details already exists' : 'This change conflicts with related records');
  }
  log.error('unhandled error', { rid: requestId, method: req.method, path: req.originalUrl, err });
  send(500, 'Something went wrong on our side. Please try again.');
}
