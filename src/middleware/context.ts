import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { RealtimeResource } from '@estateflow/shared';
import { log } from '../logger.js';
import { audit } from '../services/activity.js';
import { realtime } from '../services/realtime.js';

/** Request id (honours an incoming X-Request-Id) + one structured access-log line per request. */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = String(req.headers['x-request-id'] ?? '');
  req.requestId = /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const fields = { rid: req.requestId, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms * 10) / 10, user: req.user?.id, client: req.user?.client };
    if (res.statusCode >= 500) log.error('request', fields);
    else if (req.path !== '/api/health') log.info('request', fields);
  });
  next();
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ENTITY: Record<string, string> = {
  leads: 'lead',
  customers: 'customer',
  deals: 'deal',
  properties: 'property',
  'site-visits': 'site_visit',
  followups: 'followup',
  tasks: 'task',
  transactions: 'transaction',
  installments: 'installment',
  documents: 'document',
  users: 'user',
  settings: 'setting',
  'customer-requests': 'customer_request',
  portal: 'customer_request',
  notifications: 'notification',
  public: 'lead',
};
const RESOURCES: Record<string, RealtimeResource[]> = {
  leads: ['leads', 'followups', 'site-visits', 'tasks'],
  customers: ['customers', 'finance', 'deals', 'properties', 'leads'],
  deals: ['deals', 'customers'],
  properties: ['properties'],
  'site-visits': ['site-visits', 'leads'],
  followups: ['followups', 'leads'],
  tasks: ['tasks'],
  transactions: ['finance', 'customers'],
  installments: ['finance', 'customers'],
  documents: ['documents', 'leads', 'customers', 'properties'],
  users: ['users'],
  settings: ['settings'],
  'customer-requests': ['customer-requests'],
  portal: ['customer-requests', 'documents'],
  public: ['leads'],
};
const SKIP_AUDIT = new Set(['notifications', 'auth', 'events']);

const verb = (m: string) => ({ POST: 'Created', PUT: 'Updated', PATCH: 'Updated', DELETE: 'Deleted' })[m] ?? m;

/**
 * After every successful write: one audit row (actor, action, entity, IP, request id) and one realtime
 * change event so open dashboards and apps refresh the affected lists.
 */
export function auditAndBroadcast(req: Request, res: Response, next: NextFunction) {
  if (!MUTATING.has(req.method)) return next();
  let bodyId: number | undefined;
  const json = res.json.bind(res);
  res.json = (body: any) => {
    if (body && typeof body === 'object' && Number.isInteger(body.id)) bodyId = body.id;
    return json(body);
  };
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const parts = req.originalUrl.split('?')[0].replace(/^\/api\/?/, '').split('/');
    const group = parts[0];
    const resources = RESOURCES[group];
    if (resources) realtime.change(resources, { staffOnly: true });
    if (SKIP_AUDIT.has(group) || !req.user && group !== 'public') return;
    const routePath = `${req.baseUrl}${req.route?.path ?? ''}`.replace(/^\/api/, '').replace(/(.)\/$/, '$1');
    const entity = ENTITY[group] ?? group;
    const idFromPath = Number(parts[1]);
    const entityId = Number.isInteger(idFromPath) && idFromPath > 0 ? idFromPath : bodyId;
    const sub = parts.slice(2).filter((p) => !/^\d+$/.test(p)).join(' ').replace(/-/g, ' ');
    const title = sub ? `${entity.replace(/_/g, ' ')}: ${sub}` : `${verb(req.method)} ${entity.replace(/_/g, ' ')}`;
    audit({
      user_id: req.user?.id ?? null,
      action: `${req.method} ${routePath || req.path}`,
      title: title.charAt(0).toUpperCase() + title.slice(1),
      entity_type: entity,
      entity_id: entityId ?? null,
      ip: req.ip,
      request_id: req.requestId,
    }).catch((err) => log.error('audit write failed', { err, rid: req.requestId }));
  });
  next();
}
