import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/http.js';

interface Bucket {
  n: number;
  reset: number;
}

/** In-process fixed-window limiter (no external store). Key defaults to the client IP. */
export function rateLimit(opts: { windowMs: number; max: number | (() => number); name: string; key?: (req: Request) => string; message?: string }) {
  const buckets = new Map<string, Bucket>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
  }, opts.windowMs);
  sweep.unref();
  const limiter = (req: Request, res: Response, next: NextFunction) => {
    const max = typeof opts.max === 'function' ? opts.max() : opts.max;
    const key = `${opts.name}:${opts.key ? opts.key(req) : req.ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset <= now) {
      b = { n: 0, reset: now + opts.windowMs };
      buckets.set(key, b);
    }
    b.n++;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - b.n)));
    res.setHeader('RateLimit-Reset', String(Math.ceil((b.reset - now) / 1000)));
    if (b.n > max) {
      res.setHeader('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      throw new HttpError(429, opts.message ?? 'Too many requests. Please slow down and try again shortly.');
    }
    next();
  };
  limiter.reset = () => buckets.clear();
  return limiter;
}
