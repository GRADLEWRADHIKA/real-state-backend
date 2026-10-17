import { db } from '../db/index.js';
import { nowIso } from '../utils/dates.js';

export { notifyRoles, notifyUsers } from './notifications.js';

export interface ActivityInput {
  lead_id?: number | null;
  customer_id?: number | null;
  property_id?: number | null;
  type: string;
  title: string;
  description?: string | null;
  user_id?: number | null;
  created_at?: string;
}

/** Timeline entry on a lead/customer (also part of the audit trail). */
export async function logActivity(a: ActivityInput) {
  return db.insert('activities', { ...a, created_at: a.created_at ?? nowIso() });
}

export interface AuditInput {
  user_id: number | null;
  action: string;
  title: string;
  entity_type?: string | null;
  entity_id?: number | null;
  description?: string | null;
  ip?: string | null;
  request_id?: string | null;
}

/** Audit-only entry (type 'audit'); never shown on lead/customer timelines. */
export async function audit(a: AuditInput) {
  return db.insert('activities', {
    type: 'audit',
    title: a.title,
    description: a.description ?? null,
    action: a.action,
    entity_type: a.entity_type ?? null,
    entity_id: a.entity_id ?? null,
    user_id: a.user_id,
    ip: a.ip ?? null,
    request_id: a.request_id ?? null,
    created_at: nowIso(),
  });
}
